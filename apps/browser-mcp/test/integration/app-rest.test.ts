import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { rmSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { bootIntegrationEnv } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir } = bootIntegrationEnv("rest");
process.env.BROWSER_MCP_CORS_ORIGIN = "*";
delete process.env.BROWSER_MCP_API_KEY;

// Per-profile BrowserManager stub — fast and deterministic. We test the REST
// transport/lifecycle layer, not real browser behaviour, so only the handful of
// methods our chosen tools touch are implemented.
type Stub = {
  profileDir: string;
  shutdownCount: number;
  shutdown: () => Promise<void>;
  navigate: (url: string, tabId?: string) => Promise<{ tab_id: string; title: string; url: string; status: number }>;
  listTabs: () => Promise<Array<{ tab_id: string; title: string; url: string; status: number }>>;
  hasTab: (id: string) => boolean;
};

describe.skipIf(SKIP)("app — stateless REST surface (/api/v1)", () => {
  let createApp: typeof import("../../src/app.js").createApp;
  let app: ReturnType<typeof createApp>;
  let baseUrl: string;
  const stubs = new Map<string, Stub>();

  function makeStub(profile: string): Stub {
    const s: Stub = {
      profileDir: `/tmp/rest-${profile}`,
      shutdownCount: 0,
      shutdown: async () => { s.shutdownCount++; },
      navigate: async (url) => ({ tab_id: "t1", title: "T", url, status: 200 }),
      listTabs: async () => [{ tab_id: "t1", title: "T", url: "https://x/", status: 200 }],
      hasTab: () => true,
    };
    return s;
  }
  function factory(profile: string): never {
    const key = profile || "default";
    if (!stubs.has(key)) stubs.set(key, makeStub(key));
    return stubs.get(key) as never;
  }

  beforeAll(async () => {
    ({ createApp } = await import("../../src/app.js"));
    app = createApp({ browserFactory: factory });
    await new Promise<void>((r) => app.httpServer.listen(0, "127.0.0.1", r));
    const addr = app.httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.shutdownApp();
    rmSync(profileDir, { recursive: true, force: true });
    delete process.env.BROWSER_MCP_CORS_ORIGIN;
  }, 30_000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function tool(name: string, args: unknown, profile?: string): Promise<{ status: number; body: any }> {
    const q = profile ? `?profile=${profile}` : "";
    const res = await fetch(`${baseUrl}/api/v1/tools/${name}${q}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    return { status: res.status, body: await res.json() };
  }

  it("happy path: browser_open returns 200 ok:true with structured TabInfo data + text parity", async () => {
    const { status, body } = await tool("browser_open", { url: "https://example.com" }, "p1");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.tab_id).toBe("t1");
    expect(body.data.url).toBe("https://example.com");
    expect(Array.isArray(body.content)).toBe(true);
  });

  it("GET /api/v1/tools lists all 36 tools", async () => {
    const res = await fetch(`${baseUrl}/api/v1/tools`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: { name: string }[] };
    expect(body.tools).toHaveLength(36);
  });

  it("400 with zod issues when args fail validation", async () => {
    const { status, body } = await tool("browser_open", {}, "p1");
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.issues).toBeDefined();
  });

  it("404 for an unknown tool name", async () => {
    const { status, body } = await tool("browser_nope", {}, "p1");
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it("405 for the wrong method on a tool path", async () => {
    const res = await fetch(`${baseUrl}/api/v1/tools/browser_open`, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("400 for an invalid profile name", async () => {
    const res = await fetch(`${baseUrl}/api/v1/tools/browser_open?profile=bad%2Fname`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(res.status).toBe(400);
  });

  it("404 for an unknown /api path", async () => {
    const res = await fetch(`${baseUrl}/api/v1/nope`);
    expect(res.status).toBe(404);
  });

  it("lifecycle: first call creates a holder; reuse keeps the count; a new profile adds one", async () => {
    const c0 = app._sessionCount(); // p1 already exists from earlier tests
    await tool("browser_open", { url: "https://example.com" }, "p1"); // reuse
    expect(app._sessionCount()).toBe(c0);
    await tool("browser_open", { url: "https://example.com" }, "p2"); // new profile
    expect(app._sessionCount()).toBe(c0 + 1);
  });

  it("DELETE /api/v1/profiles/:name releases the holder and shuts its (solely-REST-held) browser", async () => {
    await tool("browser_open", { url: "https://example.com" }, "rel1");
    const before = app._sessionCount();
    expect(stubs.get("rel1")!.shutdownCount).toBe(0);

    const res = await fetch(`${baseUrl}/api/v1/profiles/rel1`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { released: boolean }).released).toBe(true);

    expect(app._sessionCount()).toBe(before - 1);
    expect(stubs.get("rel1")!.shutdownCount).toBe(1);
  });

  it("cross-surface: REST shares the browser an MCP session opened; ref-count protects it", async () => {
    // An MCP session on profile "shared" creates the BrowserManager.
    const client = new Client({ name: "t", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/shared`));
    await client.connect(transport);
    const sharedStub = stubs.get("shared")!;
    expect(sharedStub).toBeDefined();

    // REST call to the same profile reuses that browser (factory not called again).
    const { body } = await tool("browser_open", { url: "https://example.com" }, "shared");
    expect(body.ok).toBe(true);

    // Releasing the REST holder must NOT shut the browser — the MCP session still holds it.
    const res = await fetch(`${baseUrl}/api/v1/profiles/shared`, { method: "DELETE" });
    expect(((await res.json()) as { released: boolean }).released).toBe(true);
    expect(sharedStub.shutdownCount).toBe(0);

    // MCP still works against the same live browser.
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThanOrEqual(20);

    await client.close();
  });
});
