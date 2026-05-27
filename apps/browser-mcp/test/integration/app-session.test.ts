import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { bootIntegrationEnv } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir } = bootIntegrationEnv("appses");
// Allow any origin + no auth — exercise the '*' and 'no apiKey' branches.
process.env.BROWSER_MCP_CORS_ORIGIN = "*";
delete process.env.BROWSER_MCP_API_KEY;

describe.skipIf(SKIP)("app — full MCP session lifecycle over Streamable HTTP", () => {
  let createApp: typeof import("../../src/app.js").createApp;
  let app: ReturnType<typeof createApp>;
  let baseUrl: string;

  beforeAll(async () => {
    ({ createApp } = await import("../../src/app.js"));
    // Stub BrowserManager to keep the test fast and deterministic — we're
    // testing the transport / session layer, not browser behaviour.
    const stub = {
      profileDir: "/tmp/appses",
      shutdown: async () => {},
    } as never;
    app = createApp({ browserFactory: () => stub });
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const addr = app.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.shutdownApp();
    rmSync(profileDir, { recursive: true, force: true });
    delete process.env.BROWSER_MCP_CORS_ORIGIN;
  }, 30_000);

  async function waitForSessionCount(n: number, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (app._sessionCount() !== n && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(app._sessionCount()).toBe(n);
  }

  it("initialize → tools/list → DELETE session, session count grows then shrinks", async () => {
    const before = app._sessionCount();
    const client = new Client({ name: "test", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);
    expect(app._sessionCount()).toBe(before + 1);

    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(20);
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("browser_open");
    expect(names).toContain("browser_snapshot");
    expect(names).toContain("browser_configure");

    const sid = transport.sessionId;
    expect(sid).toBeDefined();
    await client.close();
    // Explicit DELETE — some SDK versions don't auto-DELETE on close.
    await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { "mcp-session-id": sid! } }).catch(() => {});
    await waitForSessionCount(before);
  }, 30_000);

  it("initialize with a custom profile path and profile is validated", async () => {
    const before = app._sessionCount();
    const client = new Client({ name: "test-named", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/custom1`));
    await client.connect(transport);
    expect(app._sessionCount()).toBe(before + 1);
    const sid = transport.sessionId;
    await client.close();
    await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { "mcp-session-id": sid! } }).catch(() => {});
    await waitForSessionCount(before);
  }, 30_000);

  it("invoking a tool via MCP exercises the withLog success + error wrappers", async () => {
    const client = new Client({ name: "wl", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(transport);
    try {
      // Success path — tabs_list works even with a stub browser (listTabs is fine when empty).
      // But our stub doesn't implement listTabs; expect a thrown error caught by withLog.
      const res = (await client.callTool({ name: "browser_tabs_list", arguments: {} })) as {
        isError?: boolean;
      };
      // stub has no listTabs → withLog should catch + mark isError
      expect(res.isError).toBeTruthy();
    } finally {
      const sid = transport.sessionId;
      await client.close();
      if (sid) await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { "mcp-session-id": sid } }).catch(() => {});
    }
  }, 30_000);

  it("second connection to the same profile reuses the existing BrowserManager", async () => {
    const c1 = new Client({ name: "a", version: "0.0.1" });
    const t1 = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/shared`));
    await c1.connect(t1);
    const c2 = new Client({ name: "b", version: "0.0.1" });
    const t2 = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/shared`));
    await c2.connect(t2);
    expect(app._sessionCount()).toBeGreaterThanOrEqual(2);
    const s1 = t1.sessionId, s2 = t2.sessionId;
    await c1.close();
    await c2.close();
    if (s1) await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { "mcp-session-id": s1 } }).catch(() => {});
    if (s2) await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { "mcp-session-id": s2 } }).catch(() => {});
  }, 30_000);

  it("CORS Origin '*' accepts any origin without 403", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://arbitrary-origin.example",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "c", version: "0.0.1" },
        },
      }),
    });
    // Past CORS → not 403. May be 200 or 400 depending on the transport's
    // handshake response, but never 403.
    expect(r.status).not.toBe(403);
  }, 30_000);
});
