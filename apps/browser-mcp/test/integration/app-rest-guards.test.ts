import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { rmSync } from "node:fs";
import { bootIntegrationEnv } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir } = bootIntegrationEnv("rest-guards");
// Auth required, hard cap of 1 session, default (empty) CORS allowlist so any
// Origin header is rejected. These are read by config at import time.
process.env.BROWSER_MCP_API_KEY = "secret-token";
process.env.BROWSER_MCP_MAX_SESSIONS = "1";
delete process.env.BROWSER_MCP_CORS_ORIGIN;

describe.skipIf(SKIP)("app — REST guards (auth / origin / content-type / cap)", () => {
  let app: ReturnType<typeof import("../../src/app.js").createApp>;
  let baseUrl: string;
  const stub = {
    profileDir: "/tmp/rest-guards",
    shutdown: async () => {},
    navigate: async (url: string) => ({ tab_id: "t1", title: "T", url, status: 200 }),
    hasTab: () => true,
  } as never;

  beforeAll(async () => {
    const { createApp } = await import("../../src/app.js");
    app = createApp({ browserFactory: () => stub });
    await new Promise<void>((r) => app.httpServer.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(app.httpServer.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.shutdownApp();
    rmSync(profileDir, { recursive: true, force: true });
    delete process.env.BROWSER_MCP_API_KEY;
    delete process.env.BROWSER_MCP_MAX_SESSIONS;
  }, 30_000);

  const toolUrl = (p = "default") => `${baseUrl}/api/v1/tools/browser_open?profile=${p}`;
  const body = JSON.stringify({ url: "https://example.com" });
  const json = "application/json";

  it("401 without a Bearer token", async () => {
    const res = await fetch(toolUrl(), { method: "POST", headers: { "content-type": json }, body });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("401 with the wrong token", async () => {
    const res = await fetch(toolUrl(), { method: "POST", headers: { "content-type": json, authorization: "Bearer nope" }, body });
    expect(res.status).toBe(401);
  });

  it("415 when content-type is not application/json", async () => {
    const res = await fetch(toolUrl(), { method: "POST", headers: { "content-type": "text/plain", authorization: "Bearer secret-token" }, body });
    expect(res.status).toBe(415);
  });

  it("403 when an Origin header is not in the (empty) allowlist", async () => {
    const res = await fetch(toolUrl(), {
      method: "POST",
      headers: { "content-type": json, authorization: "Bearer secret-token", origin: "http://evil.example" },
      body,
    });
    expect(res.status).toBe(403);
  });

  it("200 with a valid Bearer token (creates the single allowed holder)", async () => {
    const res = await fetch(toolUrl("default"), { method: "POST", headers: { "content-type": json, authorization: "Bearer secret-token" }, body });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("503 when the shared session cap is reached (a new profile can't allocate)", async () => {
    const res = await fetch(toolUrl("other"), { method: "POST", headers: { "content-type": json, authorization: "Bearer secret-token" }, body });
    expect(res.status).toBe(503);
  });
});
