#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { browser } from "./browser.js";
import { openSchema, openHandler } from "./tools/open.js";
import { readSchema, readHandler } from "./tools/read.js";
import {
  tabsListSchema,
  tabsListHandler,
  tabSwitchSchema,
  tabSwitchHandler,
  tabCloseSchema,
  tabCloseHandler,
} from "./tools/tabs.js";
import {
  clickSchema,
  clickHandler,
  typeSchema,
  typeHandler,
  scrollSchema,
  scrollHandler,
  backSchema,
  backHandler,
  forwardSchema,
  forwardHandler,
  reloadSchema,
  reloadHandler,
  findSchema,
  findHandler,
  waitSchema,
  waitHandler,
  evaluateSchema,
  evaluateHandler,
} from "./tools/interact.js";
import {
  openVisibleSchema,
  openVisibleHandler,
  screenshotSchema,
  screenshotHandler,
} from "./tools/login.js";
import { logInfo, logError } from "./log.js";

const PORT = Number(process.env.BROWSER_MCP_PORT ?? 7777);
const HOST = process.env.BROWSER_MCP_HOST ?? "127.0.0.1";

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

function buildServer(): McpServer {
  const server = new McpServer({ name: "browser-mcp", version: "0.1.0" });

  server.registerTool(
    "browser_open",
    {
      description:
        "Open a URL in a new tab, or navigate an existing tab if tab_id is given. Waits for DOMContentLoaded plus a short request-idle settle. Does NOT return page content — call browser_read afterwards. Returns HTTP status, final URL, title, and tab_id.",
      inputSchema: openSchema,
    },
    withLog("browser_open", openHandler),
  );
  server.registerTool(
    "browser_read",
    {
      description:
        "Read the current (or specified) tab. mode=markdown (default) extracts the main article via Readability and returns Markdown; mode=text returns body innerText; mode=html returns raw HTML. Use selector to narrow to an element. Output is capped at max_chars (default 50000, overridable globally via BROWSER_MCP_MAX_CHARS).",
      inputSchema: readSchema,
    },
    withLog("browser_read", readHandler),
  );
  server.registerTool(
    "browser_tabs_list",
    {
      description: "List all open tabs with their tab_id, title, and URL. The active tab is marked with →.",
      inputSchema: tabsListSchema,
    },
    withLog("browser_tabs_list", tabsListHandler),
  );
  server.registerTool(
    "browser_tab_switch",
    {
      description: "Make the given tab the active one for subsequent tool calls.",
      inputSchema: tabSwitchSchema,
    },
    withLog("browser_tab_switch", tabSwitchHandler),
  );
  server.registerTool(
    "browser_tab_close",
    { description: "Close a tab by tab_id.", inputSchema: tabCloseSchema },
    withLog("browser_tab_close", tabCloseHandler),
  );

  server.registerTool(
    "browser_click",
    {
      description:
        "Click an element. By default matches visible text (target_type=\"text\", preferred). Set target_type=\"selector\" to use a CSS selector. Waits for navigation/request-idle after the click.",
      inputSchema: clickSchema,
    },
    withLog("browser_click", clickHandler),
  );
  server.registerTool(
    "browser_type",
    {
      description:
        "Fill a CSS-selected input/textarea with text. If submit=true, presses Enter after typing (e.g. to submit a form).",
      inputSchema: typeSchema,
    },
    withLog("browser_type", typeHandler),
  );
  server.registerTool(
    "browser_scroll",
    {
      description:
        "Scroll the current tab: direction=up|down scrolls by `amount` pixels (default 800); top/bottom jump to the page edges.",
      inputSchema: scrollSchema,
    },
    withLog("browser_scroll", scrollHandler),
  );
  server.registerTool(
    "browser_back",
    { description: "Navigate back in the tab's history.", inputSchema: backSchema },
    withLog("browser_back", backHandler),
  );
  server.registerTool(
    "browser_forward",
    { description: "Navigate forward in the tab's history.", inputSchema: forwardSchema },
    withLog("browser_forward", forwardHandler),
  );
  server.registerTool(
    "browser_reload",
    { description: "Reload the current page.", inputSchema: reloadSchema },
    withLog("browser_reload", reloadHandler),
  );
  server.registerTool(
    "browser_find",
    {
      description:
        "Find text occurrences on the current page. Returns up to `limit` snippets (default 10), each with surrounding context and a stable CSS selector suitable for browser_click/browser_type.",
      inputSchema: findSchema,
    },
    withLog("browser_find", findHandler),
  );
  server.registerTool(
    "browser_wait",
    {
      description:
        "Wait for an element to reach a given state. Useful for SPAs that load content asynchronously. Returns when the element matches the state or the timeout expires.",
      inputSchema: waitSchema,
    },
    withLog("browser_wait", waitHandler),
  );
  server.registerTool(
    "browser_evaluate",
    {
      description:
        "Execute a JavaScript expression in the page context and return the JSON-serialized result. Useful for reading localStorage, cookies, window variables, or extracting data not visible in the DOM.",
      inputSchema: evaluateSchema,
    },
    withLog("browser_evaluate", evaluateHandler),
  );

  server.registerTool(
    "browser_open_visible",
    {
      description:
        "Open a URL in a VISIBLE (non-headless) Chrome window for manual interaction: signing in, solving a CAPTCHA, or inspecting a page yourself. Cookies/localStorage are saved to the persistent profile. Returns immediately — the user closes the window when done, and subsequent tools return to the default (headless) mode.",
      inputSchema: openVisibleSchema,
    },
    withLog("browser_open_visible", openVisibleHandler),
  );
  server.registerTool(
    "browser_screenshot",
    {
      description:
        "Take a PNG screenshot of the current tab. Default: viewport (1280x900). full_page=true captures the entire scrollable page.",
      inputSchema: screenshotSchema,
    },
    withLog("browser_screenshot", screenshotHandler),
  );

  return server;
}

type Session = { server: McpServer; transport: StreamableHTTPServerTransport };
const sessions = new Map<string, Session>();
const sessionLastUsed = new Map<string, number>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

const MAX_BODY_BYTES = 1_048_576; // 1 MB

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

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  const sid = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
  const body = req.method === "POST" ? await readJsonBody(req) : undefined;

  let session: Session | undefined = sid ? sessions.get(sid) : undefined;

  if (!session) {
    if (req.method !== "POST" || !isInitializeRequest(body)) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid session. Send initialize first." },
          id: null,
        }),
      );
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
        sessionLastUsed.set(id, Date.now());
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        sessionLastUsed.delete(transport.sessionId);
      }
    };
    const server = buildServer();
    await server.connect(transport);
    session = { server, transport };
  }

  const activeSid = session.transport.sessionId;
  if (activeSid) sessionLastUsed.set(activeSid, Date.now());
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
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: String(err?.message ?? err) },
          id: null,
        }),
      );
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [sid, ts] of sessionLastUsed) {
    if (now - ts > SESSION_TTL_MS) {
      const s = sessions.get(sid);
      if (s) {
        s.transport.close().catch(() => {});
        s.server.close().catch(() => {});
      }
      sessions.delete(sid);
      sessionLastUsed.delete(sid);
    }
  }
}, 60_000).unref?.();

async function shutdown() {
  httpServer.close();
  for (const { transport, server } of sessions.values()) {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
  sessions.clear();
  sessionLastUsed.clear();
  await browser.shutdown();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(PORT, HOST, () => {
  console.error(`browser-mcp listening on http://${HOST}:${PORT}/mcp`);
});
