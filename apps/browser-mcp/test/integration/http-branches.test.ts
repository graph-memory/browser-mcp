import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, textOf } from "./helpers.js";
import { startTestServer } from "./test-http-server.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("httpbranches");

describe.skipIf(SKIP)("HTTP-status branches + network log failed/unknown formatting", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let openHandler: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let network: ReturnType<typeof import("../../src/tools/network.js").makeNetworkHandler>;
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const n = await import("../../src/tools/network.js");
    mgr = new BrowserManager(profileName);
    openHandler = o.makeOpenHandler(mgr);
    network = n.makeNetworkHandler(mgr);

    server = await startTestServer({
      "/ok": { status: 200, body: "<html><head><title>OK page</title></head><body>hi</body></html>" },
      "/notfound": { status: 404, body: "<html><head><title>Gone</title></head><body>nope</body></html>" },
      "/servererr": { status: 500, body: "<html><head><title>Oops</title></head><body>boom</body></html>" },
    });
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    if (server) await server.close();
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("browser_open on HTTP 200 reports 'HTTP 200'", async () => {
    const r = await openHandler({ url: server.url("/ok") });
    expect(textOf(r)).toContain("HTTP 200");
    expect(textOf(r)).not.toContain(" (error)");
  }, 60_000);

  it("browser_open on HTTP 404 appends '(error)' to the status line", async () => {
    const r = await openHandler({ url: server.url("/notfound") });
    expect(textOf(r)).toContain("HTTP 404");
    expect(textOf(r)).toContain("(error)");
  }, 60_000);

  it("browser_open on HTTP 500 appends '(error)' too", async () => {
    const r = await openHandler({ url: server.url("/servererr") });
    expect(textOf(r)).toContain("HTTP 500");
    expect(textOf(r)).toContain("(error)");
  }, 60_000);

  it("permissions — current tab http origin used when origin is omitted", async () => {
    await openHandler({ url: server.url("/ok") });
    const { makePermissionsHandler } = await import("../../src/tools/permissions.js");
    const r = await makePermissionsHandler(mgr)({ grant: ["geolocation"] });
    const txt = textOf(r);
    expect(txt).toMatch(/to http:\/\/127\.0\.0\.1:\d+/);
  }, 60_000);

  it("network log shows failed entries after a failed fetch", async () => {
    await openHandler({ url: server.url("/ok") });
    // Trigger a failed fetch: abort via fetch to a non-listening port.
    await mgr.getPage().evaluate(() => {
      return fetch("http://127.0.0.1:1/does-not-exist").catch(() => {});
    });
    // Give Playwright a moment to emit requestfailed
    await new Promise((r) => setTimeout(r, 300));
    const r = await network({ failed_only: true, limit: 50 });
    expect(textOf(r)).toContain("FAIL(");
  }, 60_000);
});
