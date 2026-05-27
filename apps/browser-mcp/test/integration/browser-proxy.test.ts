import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("proxy");

// Proxy settings are read from env at config import time, so they must be set
// before browser.js (which imports config.js) is dynamically imported below.
// The proxy address is never actually dialed — we only launch the context and
// open an about:blank page, no real navigation — so an unreachable host is
// fine. This exercises the proxy/bypass/username/password spread in
// ensureContext(), which the rest of the suite never reaches.
process.env.BROWSER_MCP_PROXY = "http://127.0.0.1:9";
process.env.BROWSER_MCP_PROXY_BYPASS = "example.com";
process.env.BROWSER_MCP_PROXY_USERNAME = "user";
process.env.BROWSER_MCP_PROXY_PASSWORD = "pass";

describe.skipIf(SKIP)("browser — proxy configuration", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    mgr = new BrowserManager(profileName);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("launches a context with proxy + bypass + credentials configured", async () => {
    const ctx = await mgr.getContext();
    expect(ctx).toBeDefined();
    // A page can be created in the proxied context. No navigation, so the
    // unreachable proxy is never contacted.
    const page = await ctx.newPage();
    expect(page).toBeDefined();
    await page.close();
  }, 60_000);
});
