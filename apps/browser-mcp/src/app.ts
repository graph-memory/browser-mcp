import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { config } from "./config.js";
import { safeStringEq, hostIsLoopback } from "./lib/auth.js";
import { BrowserManager, validateProfileName } from "./browser.js";
import { openSchema, makeOpenHandler } from "./tools/open.js";
import { readSchema, makeReadHandler } from "./tools/read.js";
import {
  tabsListSchema, makeTabsListHandler,
  tabSwitchSchema, makeTabSwitchHandler,
  tabCloseSchema, makeTabCloseHandler,
} from "./tools/tabs.js";
import {
  clickSchema, makeClickHandler,
  typeSchema, makeTypeHandler,
  scrollSchema, makeScrollHandler,
  backSchema, makeBackHandler,
  forwardSchema, makeForwardHandler,
  reloadSchema, makeReloadHandler,
  findSchema, makeFindHandler,
  waitSchema, makeWaitHandler,
  evaluateSchema, makeEvaluateHandler,
} from "./tools/interact.js";
import {
  openVisibleSchema, makeOpenVisibleHandler,
  screenshotSchema, makeScreenshotHandler,
} from "./tools/visual.js";
import { configureSchema, makeConfigureHandler } from "./tools/configure.js";
import { snapshotSchema, makeSnapshotHandler } from "./tools/snapshot.js";
import { expectSchema, makeExpectHandler } from "./tools/expect.js";
import { permissionsSchema, makePermissionsHandler } from "./tools/permissions.js";
import { saveSchema, makeSaveHandler } from "./tools/save.js";
import { uploadSchema, makeUploadHandler } from "./tools/upload.js";
import { downloadSchema, makeDownloadHandler } from "./tools/download.js";
import { cookiesSchema, makeCookiesHandler } from "./tools/cookies.js";
import { networkSchema, makeNetworkHandler } from "./tools/network.js";
import { logInfo, logError } from "./log.js";

type ToolResult = {
  isError?: boolean;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
};

/**
 * Shape-preserving arg redaction for log lines. Tool args are JSON-stringified
 * by logInfo and can carry passwords (browser_type.text), session cookies
 * (browser_cookies.cookies[].value), full JS expressions, and absolute
 * filesystem paths. Keep the shape (so "what was called" stays debuggable)
 * but blank out the values.
 *
 * Exported for tests.
 */
export function redactToolArgs(name: string, args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const a = args as Record<string, unknown>;
  switch (name) {
    case "browser_type":
      return "text" in a ? { ...a, text: "«redacted»" } : a;
    case "browser_cookies":
      if (Array.isArray(a.cookies)) {
        return {
          ...a,
          cookies: a.cookies.map((c) =>
            c && typeof c === "object" ? { ...(c as Record<string, unknown>), value: "«redacted»" } : c,
          ),
        };
      }
      return a;
    case "browser_evaluate":
      return "expression" in a ? { ...a, expression: `«redacted ${String(a.expression).length}ch»` } : a;
    case "browser_save":
      return "path" in a ? { ...a, path: "«redacted»" } : a;
    case "browser_upload":
      return Array.isArray(a.files) ? { ...a, files: `«${a.files.length} files»` } : a;
    case "browser_download_wait":
      return "save_to" in a ? { ...a, save_to: "«redacted»" } : a;
    default:
      return a;
  }
}

function withLog<A>(name: string, fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    logInfo(`→ ${name}`, redactToolArgs(name, args));
    const t0 = Date.now();
    try {
      const out = await fn(args);
      logInfo(`✓ ${name} (${Date.now() - t0}ms)`);
      return out;
    } catch (e) {
      logError(`${name} (${Date.now() - t0}ms)`, e);
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error in ${name}: ${msg}` }],
      };
    }
  };
}

export function buildServer(browser: BrowserManager): McpServer {
  const server = new McpServer({ name: "browser-mcp", version: "0.2.0" });

  server.registerTool("browser_open", {
    description:
      "Open a URL in a new tab, or navigate an existing tab if tab_id is given. Waits for DOMContentLoaded plus a short request-idle settle. Does NOT return page content — call browser_read afterwards. Returns HTTP status, final URL, title, and tab_id.",
    inputSchema: openSchema,
  }, withLog("browser_open", makeOpenHandler(browser)));

  server.registerTool("browser_read", {
    description:
      "Read the current (or specified) tab. mode=markdown (default) extracts the main article via Readability and returns Markdown; mode=text returns body innerText; mode=html returns raw HTML. Use selector to narrow to an element. Output is capped at max_chars (default 50000, overridable globally via BROWSER_MCP_MAX_CHARS).",
    inputSchema: readSchema,
  }, withLog("browser_read", makeReadHandler(browser)));

  server.registerTool("browser_tabs_list", {
    description: "List all open tabs with their tab_id, title, and URL. The active tab is marked with →.",
    inputSchema: tabsListSchema,
  }, withLog("browser_tabs_list", makeTabsListHandler(browser)));

  server.registerTool("browser_tab_switch", {
    description: "Make the given tab the active one for subsequent tool calls.",
    inputSchema: tabSwitchSchema,
  }, withLog("browser_tab_switch", makeTabSwitchHandler(browser)));

  server.registerTool("browser_tab_close", {
    description: "Close a tab by tab_id.",
    inputSchema: tabCloseSchema,
  }, withLog("browser_tab_close", makeTabCloseHandler(browser)));

  server.registerTool("browser_click", {
    description:
      "Click an element. target_type picks the locator strategy (most reliable first): " +
      "`role` (e.g. target=\"Sign in\" + role=\"button\"), `label` (form fields by <label>), " +
      "`text` (visible text, default), `placeholder`, `testid`, `selector` (CSS escape hatch). " +
      "Playwright auto-waits for the element to be visible/enabled/stable; we also wait for " +
      "network idle after the click.",
    inputSchema: clickSchema,
  }, withLog("browser_click", makeClickHandler(browser)));

  server.registerTool("browser_type", {
    description:
      "Fill an input/textarea/contenteditable with text. target_type picks the locator strategy; " +
      "default is `selector` (CSS) for compatibility, but `label` is usually more robust for forms " +
      "(e.g. target=\"Email\"). If submit=true, presses Enter after typing. Auto-waits for the " +
      "field to be actionable before filling.",
    inputSchema: typeSchema,
  }, withLog("browser_type", makeTypeHandler(browser)));

  server.registerTool("browser_scroll", {
    description:
      "Scroll the current tab: direction=up|down scrolls by `amount` pixels (default 800); top/bottom jump to the page edges.",
    inputSchema: scrollSchema,
  }, withLog("browser_scroll", makeScrollHandler(browser)));

  server.registerTool("browser_back", {
    description: "Navigate back in the tab's history.",
    inputSchema: backSchema,
  }, withLog("browser_back", makeBackHandler(browser)));

  server.registerTool("browser_forward", {
    description: "Navigate forward in the tab's history.",
    inputSchema: forwardSchema,
  }, withLog("browser_forward", makeForwardHandler(browser)));

  server.registerTool("browser_reload", {
    description: "Reload the current page.",
    inputSchema: reloadSchema,
  }, withLog("browser_reload", makeReloadHandler(browser)));

  server.registerTool("browser_find", {
    description:
      "Find text occurrences on the current page. Returns up to `limit` snippets (default 10), each with surrounding context and a stable CSS selector suitable for browser_click/browser_type.",
    inputSchema: findSchema,
  }, withLog("browser_find", makeFindHandler(browser)));

  server.registerTool("browser_wait", {
    description:
      "Wait for an element to reach a given state. Useful for SPAs that load content asynchronously. Returns when the element matches the state or the timeout expires.",
    inputSchema: waitSchema,
  }, withLog("browser_wait", makeWaitHandler(browser)));

  server.registerTool("browser_evaluate", {
    description:
      "Execute a JavaScript expression in the page context and return the JSON-serialized result. Useful for reading localStorage, cookies, window variables, or extracting data not visible in the DOM.",
    inputSchema: evaluateSchema,
  }, withLog("browser_evaluate", makeEvaluateHandler(browser)));

  server.registerTool("browser_open_visible", {
    description:
      "Open a URL in a VISIBLE (non-headless) Chrome window for manual interaction: signing in, solving a CAPTCHA, or inspecting a page yourself. Cookies/localStorage are saved to the persistent profile. Returns immediately — the user closes the window when done, and subsequent tools return to the default (headless) mode.",
    inputSchema: openVisibleSchema,
  }, withLog("browser_open_visible", makeOpenVisibleHandler(browser)));

  server.registerTool("browser_screenshot", {
    description:
      "Take a PNG screenshot of the current tab. Default: viewport. full_page=true captures the entire scrollable page.",
    inputSchema: screenshotSchema,
  }, withLog("browser_screenshot", makeScreenshotHandler(browser)));

  server.registerTool("browser_snapshot", {
    description:
      "Return an accessibility snapshot of the page — a compact tree of semantic elements " +
      "(role, name, value, state) based on the platform a11y API. More reliable than Markdown " +
      "for interacting with SPAs, form-heavy pages, or custom components without stable selectors. " +
      "Pair with browser_click using target_type=\"role\" or target_type=\"label\" for robust " +
      "interaction. Supports `selector` to scope to a subtree, `max_depth` to cut tokens, and " +
      "`format` ('yaml' compact by default, 'json' raw).",
    inputSchema: snapshotSchema,
  }, withLog("browser_snapshot", makeSnapshotHandler(browser)));

  server.registerTool("browser_expect", {
    description:
      "Assert a condition on the current page. Retries up to `timeout_ms` before failing, " +
      "so you don't need a separate browser_wait for flaky conditions. Supports element " +
      "state (visible/hidden/enabled/disabled), text (text_equals / text_contains / text_matches), " +
      "form input (value_equals), element count, page URL / title. Returns PASS or FAIL with " +
      "both expected and actual values in the error body.",
    inputSchema: expectSchema,
  }, withLog("browser_expect", makeExpectHandler(browser)));

  server.registerTool("browser_permissions", {
    description:
      "Grant (or clear) browser permissions like camera, microphone, geolocation, notifications, " +
      "clipboard read/write. Use before navigating to a site that will prompt the user. " +
      "`grant: \"all\"` grants every supported permission; `\"none\"` clears all grants; " +
      "an array picks specific ones. Applies to the current tab's origin by default.",
    inputSchema: permissionsSchema,
  }, withLog("browser_permissions", makePermissionsHandler(browser)));

  server.registerTool("browser_save", {
    description:
      "Save the current page to disk. Formats: 'pdf' (Chromium's print-to-PDF, headless only), " +
      "'mhtml' (single-file archive with all resources inlined — excellent for offline analysis), " +
      "or 'html' (raw page HTML). Parent directories are created automatically.",
    inputSchema: saveSchema,
  }, withLog("browser_save", makeSaveHandler(browser)));

  server.registerTool("browser_upload", {
    description:
      "Upload one or more files to an <input type=\"file\"> element. Paths are validated to " +
      "exist before the call is made. For <input multiple>, pass several files; otherwise one. " +
      "Locator strategies: selector (CSS), label (<label>-associated), testid (data-testid).",
    inputSchema: uploadSchema,
  }, withLog("browser_upload", makeUploadHandler(browser)));

  server.registerTool("browser_download_wait", {
    description:
      "Trigger a download and capture the resulting file. action='click' clicks a button/link; " +
      "action='navigate' sends the tab to a direct download URL. The file is saved to `save_to`; " +
      "if that ends with '/' or is an existing directory, the server-suggested filename is used.",
    inputSchema: downloadSchema,
  }, withLog("browser_download_wait", makeDownloadHandler(browser)));

  server.registerTool("browser_cookies", {
    description:
      "Read, write, or clear cookies in the current browser profile. action='get' returns a list " +
      "(optionally scoped to URLs). action='set' adds/updates cookies from the `cookies` array — " +
      "each entry needs either (domain+path) or a single url. action='clear' wipes all cookies.",
    inputSchema: cookiesSchema,
  }, withLog("browser_cookies", makeCookiesHandler(browser)));

  server.registerTool("browser_network_log", {
    description:
      "Inspect recent network requests (ring buffer of last 500 across all tabs in the profile). " +
      "Filter by tab_id, URL regex, HTTP method, min_status (e.g. 400 for errors only), or " +
      "failed_only. Each entry shows time, status, method, URL, resource type, and duration. " +
      "Useful to debug SPA behaviour: what API calls fired, what failed, what returned 4xx/5xx.",
    inputSchema: networkSchema,
  }, withLog("browser_network_log", makeNetworkHandler(browser)));

  server.registerTool("browser_configure", {
    description:
      "Change browser settings at runtime. All parameters are optional — pass only what you want to change. Viewport and color_scheme apply to the current (or specified) tab. User-agent and locale apply to the whole browser context (all tabs).",
    inputSchema: configureSchema,
  }, withLog("browser_configure", makeConfigureHandler(browser)));

  return server;
}

// --- Session & profile management ---

type Session = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  browser: BrowserManager;
  profileName: string;
  lastUsed: number;
};

const MAX_BODY_BYTES = 1_048_576;
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
    `  /mcp drives a real browser — exposing it without auth is an RCE-by-proxy risk.\n` +
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
    if (!skipTransportClose) await session.transport.close().catch(() => {});
    await session.server.close().catch(() => {});
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

    let session: Session | undefined = sid ? sessions.get(sid) : undefined;

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
      const server = buildServer(browser);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          const newSession: Session = {
            server,
            transport,
            browser,
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
      session = { server, transport, browser, profileName, lastUsed: Date.now() };
    }

    session.lastUsed = Date.now();
    await session.transport.handleRequest(req, res, body);
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

  function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
    if (!config.apiKey) return true;
    const auth = String(req.headers["authorization"] ?? "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token && safeStringEq(token, config.apiKey)) return true;
    logInfo(`auth failed from ${req.socket.remoteAddress ?? "?"}`);
    writeJsonError(res, 401, "Unauthorized — invalid or missing API key");
    return false;
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
    if (!req.url?.startsWith("/mcp")) {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain");
      res.end("Not found\n");
      return;
    }

    const origin = checkOrigin(req);
    if (!origin.ok) { writeJsonError(res, 403, origin.reason); return; }

    const ct = checkContentType(req);
    if (!ct.ok) { writeJsonError(res, 415, ct.reason); return; }

    if (!checkAuth(req, res)) return;

    handleMcp(req, res).catch((err) => {
      logError("MCP handler", err);
      if (!res.headersSent) {
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        writeJsonError(res, status, String((err as Error)?.message ?? err));
      }
    });
  });

  async function shutdownApp(): Promise<void> {
    clearInterval(reaper);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    const browsers = new Set<BrowserManager>();
    for (const session of sessions.values()) {
      browsers.add(session.browser);
      await session.transport.close().catch(() => {});
      await session.server.close().catch(() => {});
    }
    sessions.clear();
    for (const browser of browsers) {
      await browser.shutdown();
    }
  }

  return { httpServer, shutdownApp, _sessionCount: () => sessions.size };
}
