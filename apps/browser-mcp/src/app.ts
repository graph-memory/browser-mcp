import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { config } from "./config.js";
import { safeStringEq, hostIsLoopback } from "./lib/auth.js";
import { BrowserManager, validateProfileName, type BrowserApi } from "./browser.js";
import { BrowserSession } from "./browser-session.js";
import { withLog, type ToolResult } from "./tool-runtime.js";
import { TOOLS } from "./registry.js";
import { runTool, toolsDiscovery, parseApiRoute } from "./rest.js";
import { logInfo, logError } from "./log.js";

// redactToolArgs moved to tool-runtime.ts; re-exported here for the existing
// test (test/unit/log-redaction.test.ts imports it from "./app.js").
export { redactToolArgs } from "./tool-runtime.js";

export function buildServer(browser: BrowserApi): McpServer {
  const server = new McpServer({ name: "browser-mcp", version: "0.2.0" });

  // Single source of truth: register every tool from the shared registry.
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      withLog(tool.name, tool.makeHandler(browser)),
    );
  }

  return server;
}

// --- Session & profile management ---

/** Fields common to every live session, regardless of transport. */
type BaseSession = {
  browser: BrowserManager;          // shared per-profile manager (lifecycle)
  view: BrowserSession;             // per-session view (own active tab + snapshots)
  profileName: string;
  lastUsed: number;
};
/** An MCP session: owns an McpServer + StreamableHTTP transport to close. */
type McpSession = BaseSession & {
  kind: "mcp";
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};
/**
 * A REST "profile holder": an in-memory entry (not a connection) that keeps the
 * shared browser alive for stateless REST callers and caches the per-tool
 * handlers bound to its view. No transport/server to tear down. Constructed by
 * the REST router (Phase 4); declared here so the lifecycle handles both kinds.
 */
type RestSession = BaseSession & {
  kind: "rest";
  handlers: Map<string, (args: unknown) => Promise<ToolResult>>;
};
type Session = McpSession | RestSession;

const MAX_BODY_BYTES = config.maxRequestBytes;
/**
 * Wall-clock cap on how long `readJsonBody` waits for the full request body.
 * Overridable via env for testing the slow-loris branch.
 */
function readBodyTimeoutMs(): number {
  const v = Number(process.env.BROWSER_MCP_READ_BODY_TIMEOUT_MS ?? "10000");
  return Number.isFinite(v) && v > 0 ? v : 10_000;
}

export type AppOptions = {
  /** Inject a BrowserManager factory (for tests). Defaults to `new BrowserManager(profile)`. */
  browserFactory?: (profileName: string) => BrowserManager;
};

/**
 * Insecure-config guard: refuse to start if bound to a non-loopback host with
 * no API key and no --allow-insecure opt-in. Returns a string explaining the
 * failure, or null when the config is safe. Separated from the rest of the
 * app so tests can drive it without relying on process exit.
 */
export function insecureStartupProblem(): string | null {
  if (hostIsLoopback(config.host)) return null;
  if (config.apiKey) return null;
  if (config.allowInsecure) return null;
  return (
    `host is bound to '${config.host}' (not loopback) and no API key is set.\n` +
    `  /mcp and /api drive a real browser — exposing them without auth is an RCE-by-proxy risk.\n` +
    "  Fix one of:\n" +
    "    1. set BROWSER_MCP_API_KEY to a random string (recommended)\n" +
    "    2. bind to 127.0.0.1 (BROWSER_MCP_HOST=127.0.0.1)\n" +
    "    3. pass --allow-insecure to accept the risk explicitly"
  );
}

export function createApp(opts: AppOptions = {}): {
  httpServer: Server;
  shutdownApp: () => Promise<void>;
  /** Test-only: count live sessions. */
  _sessionCount: () => number;
} {
  const sessions = new Map<string, Session>();
  const SESSION_TTL_MS = config.sessionTtlSec * 1000;

  function profileSessionCount(profileName: string): number {
    let count = 0;
    for (const s of sessions.values()) {
      if (s.profileName === profileName) count++;
    }
    return count;
  }

  async function cleanupSession(sid: string, skipTransportClose = false): Promise<void> {
    const session = sessions.get(sid);
    if (!session) return;
    sessions.delete(sid);
    // Only MCP sessions own a transport/server; REST holders are pure in-memory.
    if (session.kind === "mcp") {
      if (!skipTransportClose) await session.transport.close().catch(() => {});
      await session.server.close().catch(() => {});
    }
    if (profileSessionCount(session.profileName) === 0) {
      logInfo(`Shutting down browser for profile "${session.profileName}" (no remaining sessions)`);
      await session.browser.shutdown();
    }
  }

  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions) {
      if (now - session.lastUsed > SESSION_TTL_MS) {
        logInfo(`Session ${sid} expired (profile: ${session.profileName})`);
        cleanupSession(sid).catch(() => {});
      }
    }
  }, 60_000);
  reaper.unref?.();

  async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      // Slow-loris guard: close the socket if the full body doesn't arrive
      // within READ_BODY_TIMEOUT_MS. Without this, a 1 B/s trickle could
      // tie up a session slot indefinitely.
      const timeout = setTimeout(() => {
        req.destroy();
        reject(Object.assign(new Error("Request body timeout"), { statusCode: 408 }));
      }, readBodyTimeoutMs());
      const cleanup = () => clearTimeout(timeout);

      req.on("data", (c: Buffer) => {
        bytes += c.length;
        if (bytes > MAX_BODY_BYTES) {
          cleanup();
          req.destroy();
          reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        cleanup();
        if (chunks.length === 0) return resolve(undefined);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", (e) => { cleanup(); reject(e); });
    });
  }

  function isInitializeRequest(body: unknown): boolean {
    const check = (m: unknown) =>
      typeof m === "object" && m !== null && (m as { method?: unknown }).method === "initialize";
    return Array.isArray(body) ? body.some(check) : check(body);
  }

  function parseProfileFromUrl(url: string): { profileName: string | undefined; valid: boolean; error?: string } {
    const match = url.match(/^\/mcp(?:\/([^/?#]*))?/);
    if (!match) return { profileName: undefined, valid: false, error: "Not found" };
    const raw = match[1];
    if (!raw || raw === "") return { profileName: undefined, valid: true };
    try {
      validateProfileName(raw);
      return { profileName: raw, valid: true };
    } catch (e) {
      return { profileName: undefined, valid: false, error: (e as Error).message };
    }
  }

  function getBrowserForProfile(profileName: string): BrowserManager {
    for (const s of sessions.values()) {
      if (s.profileName === profileName) return s.browser;
    }
    if (opts.browserFactory) return opts.browserFactory(profileName);
    return new BrowserManager(profileName || undefined);
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse) {
    const parsed = parseProfileFromUrl(req.url ?? "");
    if (!parsed.valid) {
      writeJsonError(res, 400, parsed.error ?? "Invalid request");
      return;
    }

    const profileName = parsed.profileName ?? "default";
    const sid = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    const body = req.method === "POST" ? await readJsonBody(req) : undefined;

    const existing = sid ? sessions.get(sid) : undefined;
    // Only MCP sessions are addressable via mcp-session-id; never treat a REST
    // profile-holder entry as an MCP session.
    let session: McpSession | undefined = existing && existing.kind === "mcp" ? existing : undefined;

    if (!session) {
      if (req.method !== "POST" || !isInitializeRequest(body)) {
        writeJsonError(res, 400, "No valid session. Send initialize first.");
        return;
      }

      if (sessions.size >= config.maxSessions) {
        writeJsonError(res, 503, `session cap reached (${config.maxSessions})`);
        return;
      }

      const browser = getBrowserForProfile(profileName);
      // Per-session view: shares the profile's BrowserContext (cookies/login)
      // but keeps its own active tab + snapshot store, so concurrent clients
      // on the same profile don't clobber each other.
      const view = new BrowserSession(browser);
      const server = buildServer(view);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          const newSession: McpSession = {
            kind: "mcp",
            server,
            transport,
            browser,
            view,
            profileName,
            lastUsed: Date.now(),
          };
          sessions.set(id, newSession);
          logInfo(`New session ${id} (profile: ${profileName}, dir: ${browser.profileDir})`);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          cleanupSession(transport.sessionId, true).catch(() => {});
        }
      };
      await server.connect(transport);
      session = { kind: "mcp", server, transport, browser, view, profileName, lastUsed: Date.now() };
    }

    session.lastUsed = Date.now();
    await session.transport.handleRequest(req, res, body);
  }

  /**
   * Stateless REST surface (/api/v1). The client holds no session; the server
   * keeps one "profile holder" (an in-memory RestSession) per profile that
   * caches the shared browser + per-tool handlers across requests, reaped by
   * the same idle-TTL machinery as MCP sessions.
   */
  async function handleRest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "", "http://localhost");
    const route = parseApiRoute(req.method ?? "GET", url.pathname);

    if (route === null) { writeError(res, 404, "Not found", true); return; }
    if (route.kind === "method_not_allowed") { writeError(res, 405, "Method not allowed", true); return; }
    if (route.kind === "tools") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(toolsDiscovery()));
      return;
    }
    if (route.kind === "release") {
      try { validateProfileName(route.profile); }
      catch (e) { writeError(res, 400, (e as Error).message, true); return; }
      const key = `rest:${route.profile}`;
      const existed = sessions.has(key);
      if (existed) await cleanupSession(key); // drops the holder; shuts the browser iff no MCP session holds it
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, released: existed }));
      return;
    }

    // route.kind === "tool": resolve the profile (default "default").
    const profileRaw = url.searchParams.get("profile") ?? "";
    let profileName = "default";
    if (profileRaw) {
      try { validateProfileName(profileRaw); profileName = profileRaw; }
      catch (e) { writeError(res, 400, (e as Error).message, true); return; }
    }

    const body = await readJsonBody(req);

    // Get-or-create the per-profile holder SYNCHRONOUSLY — no await between the
    // get and the set — so two concurrent first-touch calls to the same profile
    // can't each spin up a BrowserManager on one profile dir (SingletonLock race).
    const key = `rest:${profileName}`;
    let holder = sessions.get(key);
    if (holder && holder.kind !== "rest") holder = undefined;
    if (!holder) {
      if (sessions.size >= config.maxSessions) {
        writeError(res, 503, `session cap reached (${config.maxSessions})`, true);
        return;
      }
      const browser = getBrowserForProfile(profileName);
      const view = new BrowserSession(browser);
      const handlers: RestSession["handlers"] = new Map(
        TOOLS.map((t) => [t.name, withLog(t.name, t.makeHandler(view))] as const),
      );
      holder = { kind: "rest", browser, view, handlers, profileName, lastUsed: Date.now() };
      sessions.set(key, holder);
      logInfo(`New REST holder for profile "${profileName}" (dir: ${browser.profileDir})`);
    }
    holder.lastUsed = Date.now();

    const { status, body: envelope } = await runTool(route.name, body, holder.handlers);
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(envelope));
  }

  function writeJsonError(res: ServerResponse, status: number, message: string) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: status === 401 ? -32000 : status === 503 ? -32001 : -32000, message },
      id: null,
    }));
  }

  /**
   * Write a transport-layer error. REST (/api) gets the plain
   * `{ ok:false, error:{ message } }` envelope; MCP (/mcp) gets the JSON-RPC
   * error shape. Keeps both surfaces' error bodies idiomatic.
   */
  function writeError(res: ServerResponse, status: number, message: string, isApi: boolean) {
    if (!isApi) { writeJsonError(res, status, message); return; }
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: { message } }));
  }

  /** Bearer-token check. True when auth is disabled or the token matches (constant-time). */
  function authOk(req: IncomingMessage): boolean {
    if (!config.apiKey) return true;
    const auth = String(req.headers["authorization"] ?? "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    return Boolean(token && safeStringEq(token, config.apiKey));
  }

  function checkOrigin(req: IncomingMessage): { ok: true } | { ok: false; reason: string } {
    // No Origin header = native client (curl, MCP SDK, Node fetch without
    // explicit origin). Always allowed — CSRF requires a browser, and
    // browsers always send Origin on cross-origin fetch.
    const raw = req.headers["origin"];
    if (raw === undefined) return { ok: true };
    const origin = String(raw);
    if (config.corsOrigin === "*") return { ok: true };
    // Treat the literal string "null" in the allowlist as an intentional
    // opt-in — sandboxed iframes / file:// pages serialize Origin: null,
    // which otherwise would be a CSRF bypass on loopback without auth.
    const allowed = config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.includes(origin)) return { ok: true };
    return { ok: false, reason: `origin '${origin}' not allowed` };
  }

  function checkContentType(req: IncomingMessage): { ok: true } | { ok: false; reason: string } {
    if (req.method !== "POST") return { ok: true };
    const ct = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!ct.startsWith("application/json")) {
      return { ok: false, reason: `content-type must be application/json, got '${ct || "<missing>"}'` };
    }
    return { ok: true };
  }

  const startedAt = Date.now();

  function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
    const profiles = new Set<string>();
    for (const s of sessions.values()) profiles.add(s.profileName);
    const body = {
      status: "ok",
      uptime_ms: Date.now() - startedAt,
      sessions: sessions.size,
      profiles: profiles.size,
      config: {
        host: config.host,
        port: config.port,
        headless: config.headless,
        stealth: config.stealth,
        auth: config.apiKey ? "on" : "off",
      },
    };
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  }

  const httpServer = createServer((req, res) => {
    if (req.url === "/health" && (req.method === "GET" || req.method === "HEAD")) {
      handleHealth(req, res);
      return;
    }
    const isApi = req.url?.startsWith("/api/") ?? false;
    const isMcp = req.url?.startsWith("/mcp") ?? false;
    if (!isApi && !isMcp) {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain");
      res.end("Not found\n");
      return;
    }

    // Shared guard gate — /mcp and /api both pass origin → content-type → auth.
    const origin = checkOrigin(req);
    if (!origin.ok) { writeError(res, 403, origin.reason, isApi); return; }

    const ct = checkContentType(req);
    if (!ct.ok) { writeError(res, 415, ct.reason, isApi); return; }

    if (!authOk(req)) {
      logInfo(`auth failed from ${req.socket.remoteAddress ?? "?"}`);
      writeError(res, 401, "Unauthorized — invalid or missing API key", isApi);
      return;
    }

    const handle = isApi ? handleRest : handleMcp;
    handle(req, res).catch((err) => {
      logError(isApi ? "REST handler" : "MCP handler", err);
      if (!res.headersSent) {
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        writeError(res, status, String((err as Error)?.message ?? err), isApi);
      }
    });
  });

  async function shutdownApp(): Promise<void> {
    clearInterval(reaper);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    const browsers = new Set<BrowserManager>();
    for (const session of sessions.values()) {
      browsers.add(session.browser);
      if (session.kind === "mcp") {
        await session.transport.close().catch(() => {});
        await session.server.close().catch(() => {});
      }
    }
    sessions.clear();
    for (const browser of browsers) {
      await browser.shutdown();
    }
  }

  return { httpServer, shutdownApp, _sessionCount: () => sessions.size };
}
