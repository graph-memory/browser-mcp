#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.js";
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
import { logInfo, logError } from "./log.js";

type ToolResult = {
  isError?: boolean;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
};

function withLog<A>(name: string, fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    logInfo(`→ ${name}`, args);
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

function buildServer(browser: BrowserManager): McpServer {
  const server = new McpServer({ name: "browser-mcp", version: "0.1.0" });

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
      "Click an element. By default matches visible text (target_type=\"text\", preferred). Set target_type=\"selector\" to use a CSS selector. Waits for navigation/request-idle after the click.",
    inputSchema: clickSchema,
  }, withLog("browser_click", makeClickHandler(browser)));

  server.registerTool("browser_type", {
    description:
      "Fill a CSS-selected input/textarea with text. If submit=true, presses Enter after typing (e.g. to submit a form).",
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
      "Take a PNG screenshot of the current tab. Default: viewport (1280x900). full_page=true captures the entire scrollable page.",
    inputSchema: screenshotSchema,
  }, withLog("browser_screenshot", makeScreenshotHandler(browser)));

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

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = config.sessionTtlSec * 1000;
const MAX_BODY_BYTES = 1_048_576;

/** Track how many active sessions reference each profile. */
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

  // Shutdown browser if no other session uses this profile
  if (profileSessionCount(session.profileName) === 0) {
    logInfo(`Shutting down browser for profile "${session.profileName}" (no remaining sessions)`);
    await session.browser.shutdown();
  }
}

// Periodic session reaper
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.lastUsed > SESSION_TTL_MS) {
      logInfo(`Session ${sid} expired (profile: ${session.profileName})`);
      cleanupSession(sid).catch(() => {});
    }
  }
}, 60_000).unref?.();

// --- HTTP layer ---

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function isInitializeRequest(body: unknown): boolean {
  const check = (m: unknown) =>
    typeof m === "object" && m !== null && (m as { method?: unknown }).method === "initialize";
  return Array.isArray(body) ? body.some(check) : check(body);
}

/** Parse profile name from URL: /mcp/profileName or /mcp (default). */
function parseProfileFromUrl(url: string): { profileName: string | undefined; valid: boolean; error?: string } {
  // Expected: /mcp or /mcp/ or /mcp/someProfile
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

/** Get or create a BrowserManager for a profile. Reuses if another session already has one running. */
function getBrowserForProfile(profileName: string): BrowserManager {
  for (const s of sessions.values()) {
    if (s.profileName === profileName) return s.browser;
  }
  return new BrowserManager(profileName || undefined);
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  const parsed = parseProfileFromUrl(req.url ?? "");
  if (!parsed.valid) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: parsed.error ?? "Invalid request" },
      id: null,
    }));
    return;
  }

  const profileName = parsed.profileName ?? "default";
  const sid = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
  const body = req.method === "POST" ? await readJsonBody(req) : undefined;

  let session: Session | undefined = sid ? sessions.get(sid) : undefined;

  if (!session) {
    if (req.method !== "POST" || !isInitializeRequest(body)) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "No valid session. Send initialize first." },
        id: null,
      }));
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

const httpServer = createServer((req, res) => {
  if (!req.url?.startsWith("/mcp")) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  handleMcp(req, res).catch((err) => {
    console.error("MCP handler error:", err);
    if (!res.headersSent) {
      res.statusCode = (err as { statusCode?: number }).statusCode ?? 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: String(err?.message ?? err) },
        id: null,
      }));
    }
  });
});

async function shutdown() {
  httpServer.close();
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
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(config.port, config.host, () => {
  console.error(`browser-mcp listening on http://${config.host}:${config.port}/mcp`);
  console.error(`  /mcp         → default profile`);
  console.error(`  /mcp/<name>  → named profile (e.g. /mcp/test1)`);
});
