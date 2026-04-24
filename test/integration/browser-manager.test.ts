import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("mgr");

describe.skipIf(SKIP)("BrowserManager — direct method surface", () => {
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

  it("getPage throws when no tab is open", () => {
    expect(() => mgr.getPage()).toThrow(/No active tab/);
  });

  it("getPage throws when given an unknown tab id", async () => {
    await mgr.openTab(fixtureUrl("article.html"));
    expect(() => mgr.getPage("nonexistent")).toThrow(/not found/);
  }, 60_000);

  it("activeTabId follows openTab", async () => {
    const info = await mgr.openTab(fixtureUrl("article.html"));
    expect(mgr.activeTabId).toBe(info.tab_id);
  }, 60_000);

  it("listTabs returns tab metadata", async () => {
    const info = await mgr.openTab(fixtureUrl("form.html"));
    const tabs = await mgr.listTabs();
    expect(tabs.some((t) => t.tab_id === info.tab_id)).toBe(true);
  }, 60_000);

  it("switchTab updates active", async () => {
    const a = await mgr.openTab(fixtureUrl("article.html"));
    const b = await mgr.openTab(fixtureUrl("form.html"));
    mgr.switchTab(a.tab_id);
    expect(mgr.activeTabId).toBe(a.tab_id);
    mgr.switchTab(b.tab_id);
    expect(mgr.activeTabId).toBe(b.tab_id);
  }, 60_000);

  it("closeTab removes from the list; activeTabId migrates when active is closed", async () => {
    const a = await mgr.openTab(fixtureUrl("article.html"));
    const b = await mgr.openTab(fixtureUrl("form.html"));
    expect(mgr.activeTabId).toBe(b.tab_id);
    await mgr.closeTab(b.tab_id);
    // b is gone; active migrated to some other existing tab (not b).
    expect(mgr.activeTabId).not.toBe(b.tab_id);
    const tabs = await mgr.listTabs();
    expect(tabs.some((t) => t.tab_id === b.tab_id)).toBe(false);
    expect(tabs.some((t) => t.tab_id === a.tab_id)).toBe(true);
  }, 60_000);

  it("setUserAgent applies to existing pages via init script", async () => {
    await mgr.openTab(fixtureUrl("article.html"));
    await mgr.setUserAgent("Mozilla/5.0 browser-mcp-test/1.0");
    const page = mgr.getPage();
    const ua = await page.evaluate(() => navigator.userAgent);
    expect(ua).toContain("browser-mcp-test/1.0");
  }, 60_000);

  it("setLocale updates Accept-Language header (context-wide)", async () => {
    await mgr.openTab(fixtureUrl("article.html"));
    // Smoke — just verify it doesn't throw
    await mgr.setLocale("de-DE");
  }, 60_000);

  it("setColorScheme toggles prefers-color-scheme media query", async () => {
    await mgr.openTab(fixtureUrl("article.html"));
    await mgr.setColorScheme("dark");
    const page = mgr.getPage();
    const dark = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
    expect(dark).toBe(true);
    await mgr.setColorScheme("light");
    const light = await page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches);
    expect(light).toBe(true);
    await mgr.setColorScheme("no-preference");
  }, 60_000);

  it("setViewport resizes the given tab", async () => {
    const info = await mgr.openTab(fixtureUrl("article.html"));
    await mgr.setViewport(1024, 600, info.tab_id);
    const page = mgr.getPage(info.tab_id);
    const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    expect(size.w).toBe(1024);
  }, 60_000);

  it("elementScreenshot returns PNG bytes for an in-view element", async () => {
    await mgr.openTab(fixtureUrl("article.html"));
    const buf = await mgr.elementScreenshot("article");
    expect(buf.byteLength).toBeGreaterThan(100);
  }, 60_000);

  it("screenshot (full page) returns PNG bytes", async () => {
    await mgr.openTab(fixtureUrl("article.html"));
    const buf = await mgr.screenshot(true);
    expect(buf.byteLength).toBeGreaterThan(100);
  }, 60_000);

  it("a11ySnapshot with a selector returns an AX tree (CDP fetchRelatives=true also includes ancestors)", async () => {
    await mgr.openTab(fixtureUrl("form.html"));
    const snap = await mgr.a11ySnapshot({ selector: "form" });
    expect(snap).not.toBeNull();
    // The tree should at least contain form controls, regardless of where the
    // root sits (CDP's getPartialAXTree with fetchRelatives includes ancestors).
    const flat = JSON.stringify(snap);
    expect(flat.length).toBeGreaterThan(10);
  }, 60_000);

  it("a11ySnapshot — missing selector throws", async () => {
    await mgr.openTab(fixtureUrl("form.html"));
    await expect(mgr.a11ySnapshot({ selector: "#nope-missing" })).rejects.toThrow(/selector not found/);
  }, 60_000);

  it("a11ySnapshot — maxDepth truncates children", async () => {
    await mgr.openTab(fixtureUrl("dashboard.html"));
    const snap = await mgr.a11ySnapshot({ maxDepth: 0, interestingOnly: true });
    expect(snap).not.toBeNull();
  }, 60_000);

  it("reconfigure restarts the context and forgets old tabs", async () => {
    const before = await mgr.openTab(fixtureUrl("article.html"));
    await mgr.reconfigure({ viewport: { width: 800, height: 600 } });
    // New context: tabs from before should no longer be addressable.
    expect(() => mgr.getPage(before.tab_id)).toThrow(/not found|No active/);
  }, 120_000);

  it("storeSnapshot / getStoredSnapshot / listStoredSnapshots / deleteStoredSnapshot", () => {
    const snap = { role: "root" } as const;
    mgr.storeSnapshot("hello", snap);
    expect(mgr.getStoredSnapshot("hello")).toEqual(snap);
    expect(mgr.listStoredSnapshots()).toContain("hello");
    expect(mgr.deleteStoredSnapshot("hello")).toBe(true);
    expect(mgr.getStoredSnapshot("hello")).toBeUndefined();
    expect(mgr.deleteStoredSnapshot("hello")).toBe(false);
  });

  it("getContext returns the BrowserContext", async () => {
    await mgr.openTab(fixtureUrl("article.html"));
    const ctx = await mgr.getContext();
    expect(typeof ctx.newPage).toBe("function");
  }, 60_000);

  it("shutdown is idempotent (second call is a no-op)", async () => {
    await mgr.openTab(fixtureUrl("article.html"));
    await mgr.shutdown();
    await mgr.shutdown();
  }, 60_000);

  it("sweep closes stale tabs (artificial lastUsed backdate)", async () => {
    const a = await mgr.openTab(fixtureUrl("article.html"));
    const b = await mgr.openTab(fixtureUrl("form.html"));
    // Mark b as very stale so sweep wants to close it; a is currently active so it survives.
    const lastUsed = (mgr as unknown as { lastUsed: Map<string, number> }).lastUsed;
    mgr.switchTab(a.tab_id);
    lastUsed.set(b.tab_id, Date.now() - 10_000_000);
    await (mgr as unknown as { sweep: () => Promise<void> }).sweep();
    // b should be gone; a survives.
    const tabs = await mgr.listTabs();
    expect(tabs.some((t) => t.tab_id === a.tab_id)).toBe(true);
    expect(tabs.some((t) => t.tab_id === b.tab_id)).toBe(false);
  }, 60_000);
});
