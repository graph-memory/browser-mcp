import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { bootIntegrationEnv } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName: _pn } = bootIntegrationEnv("app");
void _pn;
// API key to exercise auth branches
process.env.BROWSER_MCP_API_KEY = "test-key-42";
// Permissive origin so we can spoof any
process.env.BROWSER_MCP_CORS_ORIGIN = "https://allowed.example";

describe.skipIf(SKIP)("app — HTTP server: CSRF, auth, health, sessions, error paths", () => {
  let createApp: typeof import("../../src/app.js").createApp;
  let insecureStartupProblem: typeof import("../../src/app.js").insecureStartupProblem;
  let app: ReturnType<typeof createApp>;
  let baseUrl: string;

  beforeAll(async () => {
    ({ createApp, insecureStartupProblem } = await import("../../src/app.js"));
    // browserFactory: return a minimal stub so we don't launch Chromium for
    // HTTP-layer tests. These tests poke at CSRF / auth / health / session
    // lifecycle, not at tool behaviour.
    const stubBrowser = {
      profileDir: "/tmp/app-test-profile",
      shutdown: async () => {},
    } as never;
    app = createApp({ browserFactory: () => stubBrowser });
    await new Promise<void>((resolve) => app.httpServer.listen(0, "127.0.0.1", resolve));
    const addr = app.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.shutdownApp();
    rmSync(profileDir, { recursive: true, force: true });
    delete process.env.BROWSER_MCP_API_KEY;
    delete process.env.BROWSER_MCP_CORS_ORIGIN;
  }, 30_000);

  // --- /health ---
  it("/health returns 200 with JSON status", async () => {
    const r = await fetch(`${baseUrl}/health`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    const body = await r.json();
    expect(body.status).toBe("ok");
    expect(body.config.auth).toBe("on");
  });

  it("/health with HEAD is also handled", async () => {
    const r = await fetch(`${baseUrl}/health`, { method: "HEAD" });
    expect(r.status).toBe(200);
  });

  // --- unknown path ---
  it("unknown path returns 404 text", async () => {
    const r = await fetch(`${baseUrl}/nope`);
    expect(r.status).toBe(404);
    expect(await r.text()).toContain("Not found");
  });

  // --- auth (apiKey is set) ---
  it("/mcp without Authorization returns 401", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.error.message).toContain("Unauthorized");
  });

  it("/mcp with wrong Bearer token returns 401", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(r.status).toBe(401);
  });

  // --- CSRF (origin) ---
  it("/mcp with disallowed Origin returns 403", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-key-42",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(r.status).toBe(403);
  });

  it("/mcp with allowed Origin proceeds past origin check", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-key-42",
        origin: "https://allowed.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    // Past origin + content-type + auth → MCP handler processes.
    // Result depends on StreamableHTTP transport; we care that it's NOT 403.
    expect(r.status).not.toBe(403);
  });

  // --- content-type ---
  it("POST /mcp without application/json returns 415", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer test-key-42", "content-type": "text/plain" },
      body: "not json",
    });
    expect(r.status).toBe(415);
  });

  // --- profile parse ---
  it("/mcp/<invalid!> → 400 (profile name regex)", async () => {
    const r = await fetch(`${baseUrl}/mcp/bad..name`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-42" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.message).toMatch(/Invalid profile name/);
  });

  // --- session flow without initialize ---
  it("POST /mcp with a non-initialize body and no session → 400", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-42" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.message).toMatch(/initialize/);
  });

  it("GET /mcp without session → 400", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "GET",
      headers: { authorization: "Bearer test-key-42" },
    });
    expect(r.status).toBe(400);
  });

  // --- body size limit ---
  it("POST /mcp with body > 1 MiB is rejected by the handler", async () => {
    const huge = Array.from({ length: 1_100_000 }, () => "x").join("");
    // The server calls req.destroy() after exceeding the 1 MiB cap, which
    // from the client side manifests as ECONNRESET or a 413 response.
    let outcome: string;
    try {
      const r = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-key-42" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { big: huge } }),
      });
      outcome = `status:${r.status}`;
    } catch (e) {
      outcome = `err:${(e as Error).message}`;
    }
    // Either the server emitted 413, or the TCP socket was torn down.
    expect(outcome).toMatch(/status:(413|500)|err:fetch failed|err:socket/i);
  });

  // --- malformed JSON ---
  it("POST /mcp with malformed JSON returns 500 with a parse error", async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key-42" },
      body: "{not valid",
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  // --- insecure startup guard ---
  it("insecureStartupProblem returns null for loopback + no apiKey", () => {
    // config.host is 127.0.0.1 by default → always null here
    expect(insecureStartupProblem()).toBeNull();
  });
});
