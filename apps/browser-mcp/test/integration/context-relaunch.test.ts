import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import type { BrowserContext } from "playwright";
import { bootIntegrationEnv, fixtureUrl } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("relaunch");

/**
 * The browser can die under the manager. Headful Chrome quits when its last window closes, so a
 * client that tidies up after itself takes the whole browser down with the final tab; a crash or
 * an outside kill does the same. The manager used to cache the context handle forever, so every
 * later openTab threw "Target page, context or browser has been closed" until the process was
 * restarted — with the HTTP surface still answering, which reads as a healthy server that cannot
 * open a page.
 *
 * The death is simulated by closing the context directly rather than by closing the last tab:
 * the tests run headless (see helpers), and headless Chromium survives having no pages, so
 * closing tabs would not reproduce what the farm hit. Reaching for the private field is the
 * point — it stands in for Chromium exiting on its own.
 */
describe.skipIf(SKIP)("BrowserManager — the browser reopens after it dies", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;

  const killBrowser = async (): Promise<void> => {
    const ctx = (mgr as unknown as { context: BrowserContext | null }).context;
    if (!ctx) throw new Error("no context to kill — the test is not exercising what it claims");
    await ctx.close();
  };

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    mgr = new BrowserManager(profileName);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("openTab relaunches the browser after it closed underneath", async () => {
    const first = await mgr.openTab(fixtureUrl("article.html"));
    await killBrowser();

    const second = await mgr.openTab(fixtureUrl("article.html"));
    expect(second.url).toContain("article.html");
    // A fresh browser means fresh tab ids, and the dead one must not linger in the map.
    expect(second.tab_id).not.toBe(first.tab_id);
    const tabs = await mgr.listTabs();
    expect(tabs.some((t) => t.tab_id === second.tab_id)).toBe(true);
    expect(tabs.some((t) => t.tab_id === first.tab_id)).toBe(false);
  }, 120_000);

  it("recovers again on the next death, so the reset is not a one-off", async () => {
    await killBrowser();
    const revived = await mgr.openTab(fixtureUrl("form.html"));
    expect(revived.url).toContain("form.html");
    expect(mgr.activeTabId).toBe(revived.tab_id);
  }, 120_000);
});
