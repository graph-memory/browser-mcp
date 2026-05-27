import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { bootIntegrationEnv } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir } = bootIntegrationEnv("cap");
process.env.BROWSER_MCP_MAX_SESSIONS = "1";
delete process.env.BROWSER_MCP_API_KEY;

describe.skipIf(SKIP)("app — session cap + empty body + tool error branch", () => {
  let createApp: typeof import("../../src/app.js").createApp;
  let app: ReturnType<typeof createApp>;
  let baseUrl: string;

  beforeAll(async () => {
    ({ createApp } = await import("../../src/app.js"));
    const stub = { profileDir: "/tmp/cap", shutdown: async () => {} } as never;
    app = createApp({ browserFactory: () => stub });
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const addr = app.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.shutdownApp();
    rmSync(profileDir, { recursive: true, force: true });
    delete process.env.BROWSER_MCP_MAX_SESSIONS;
  }, 30_000);

  it("second concurrent session is rejected with 503", async () => {
    const c1 = new Client({ name: "one", version: "0.0.1" });
    const t1 = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await c1.connect(t1);

    // Fire a raw initialize for the second client — SDK client would retry,
    // so we hand-roll it to observe the 503 directly.
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "two", version: "0.0.1" },
        },
      }),
    });
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error.message).toContain("session cap reached");

    const sid = t1.sessionId;
    await c1.close();
    if (sid) await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { "mcp-session-id": sid } }).catch(() => {});
  }, 30_000);

  it("POST with empty body is treated as no body → 400 (not an initialize)", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(r.status).toBe(400);
  });
});
