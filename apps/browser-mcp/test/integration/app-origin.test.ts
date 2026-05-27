import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { rmSync } from "node:fs";
import { bootIntegrationEnv } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir } = bootIntegrationEnv("origin");

// Explicitly default (empty) CORS origin — tighter than the old "null" default.
process.env.BROWSER_MCP_CORS_ORIGIN = "";
delete process.env.BROWSER_MCP_API_KEY;

describe.skipIf(SKIP)("app — default CORS policy rejects Origin: null", () => {
  let createApp: typeof import("../../src/app.js").createApp;
  let app: ReturnType<typeof createApp>;
  let baseUrl: string;

  beforeAll(async () => {
    ({ createApp } = await import("../../src/app.js"));
    const stub = { profileDir: "/tmp/origin", shutdown: async () => {} } as never;
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

  it("Origin: null is NOT treated as 'no origin' — it's a real header value, and the empty allowlist rejects it", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "null", // sandboxed iframes / file:// pages send this literal string
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error.message).toMatch(/origin 'null' not allowed/);
  });

  it("absence of Origin header is still accepted (native client)", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
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
    // Past CORS gate — not 403.
    expect(r.status).not.toBe(403);
  });
});
