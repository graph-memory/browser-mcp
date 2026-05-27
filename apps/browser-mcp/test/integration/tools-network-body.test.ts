import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, textOf } from "./helpers.js";
import { startTestServer } from "./test-http-server.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("netbody");

describe.skipIf(SKIP)("tools/network_body — captured response bodies", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let networkBody: ReturnType<typeof import("../../src/tools/network-body.js").makeNetworkBodyHandler>;
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer({
      "/data": { headers: { "content-type": "application/json" }, body: JSON.stringify({ hello: "world", n: 42 }) },
      "/page": { body: "<!doctype html><script>fetch('/data').then(r => r.json()).then(d => { window.__d = d; });</script>" },
      "/data2": { headers: { "content-type": "application/json" }, body: JSON.stringify({ only: "when-enabled" }) },
      "/page2": { body: "<!doctype html><script>fetch('/data2');</script>" },
    });
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    networkBody = (await import("../../src/tools/network-body.js")).makeNetworkBodyHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    await server?.close();
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("returns the JSON body of a fetched endpoint", async () => {
    await open({ url: server.url("/page") });
    await new Promise((r) => setTimeout(r, 200));
    const r = await networkBody({ url_regex: "/data$", index: 0 });
    const t = textOf(r);
    expect(t).toContain("application/json");
    expect(t).toContain('"hello":"world"');
    expect(t).toContain('"n":42');
  }, 60_000);

  it("filter with no match reports nothing captured", async () => {
    await open({ url: server.url("/page") });
    const r = await networkBody({ url_regex: "/nonexistent-xyz", index: 0 });
    expect(textOf(r)).toContain("no captured response body");
  }, 60_000);

  it("BROWSER_MCP_NO_NETWORK_BODY=1 disables passive capture", async () => {
    process.env.BROWSER_MCP_NO_NETWORK_BODY = "1";
    try {
      await open({ url: server.url("/page2") });
      await new Promise((r) => setTimeout(r, 200));
      // /data2 is only fetched here, with capture disabled → never buffered.
      const r = await networkBody({ url_regex: "/data2$", index: 0 });
      expect(textOf(r)).toContain("no captured response body");
    } finally {
      delete process.env.BROWSER_MCP_NO_NETWORK_BODY;
    }
  }, 60_000);
});
