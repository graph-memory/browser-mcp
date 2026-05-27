import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("sessdeleg");

// Drives the full BrowserSession delegation surface so each per-session method
// is exercised (the tool handlers themselves are tested via BrowserManager).
describe.skipIf(SKIP)("BrowserSession — delegates the whole tool surface", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let BrowserSession: typeof import("../../src/browser-session.js").BrowserSession;
  let mgr: InstanceType<typeof BrowserManager>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    ({ BrowserSession } = await import("../../src/browser-session.js"));
    mgr = new BrowserManager(profileName);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("per-tab operations delegate to the shared manager", async () => {
    const s = new BrowserSession(mgr);
    await s.navigate(fixtureUrl("widgets.html"));
    expect(s.activeTabId).toBeTruthy();

    // interaction
    await s.setChecked("#agree", "selector", true);
    await s.click("#agree", "selector"); // toggle back off
    await s.type("#note", "hello", false, undefined, "selector");
    await s.press("Backspace", "#note", "selector");
    await s.hover("Menu", "text");
    await s.selectOption("#fruit", "selector", "value", ["b"]);
    await s.drag("#src", "selector", "#drop", "selector");
    await s.scroll("down", 100);
    const hits = await s.find("Widgets", 5);
    expect(Array.isArray(hits)).toBe(true);

    // storage
    await s.storage("set", "local", "k", "v");
    const got = await s.storage("get", "local", "k");
    expect(got).toMatchObject({ k: "v" });

    // visual / snapshot
    expect((await s.screenshot(false)).length).toBeGreaterThan(0);
    expect((await s.elementScreenshot("#fruit")).length).toBeGreaterThan(0);
    expect(await s.a11ySnapshot({})).not.toBeNull();

    // per-tab config
    await s.setViewport(800, 600);
    await s.setColorScheme("dark");

    // history + tab control
    await s.reload();
    await s.back();
    await s.forward();
    s.switchTab(s.activeTabId!);
    expect((await s.listTabs()).length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("context-wide operations delegate (and reconfigure restarts last)", async () => {
    const s = new BrowserSession(mgr);
    await s.navigate(fixtureUrl("widgets.html"));

    expect(await s.getContext()).toBeDefined();
    await s.setUserAgent("Test-UA/1.0");
    await s.setLocale("en-US");
    await s.setExtraHeaders({ "x-sess": "1" });
    await s.setGeolocation(10, 20, 5);
    s.setDialogPolicy("accept", undefined, false);

    expect(s.readNetLog({}).total).toBeGreaterThanOrEqual(0);
    expect(s.readConsoleLog({}).total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(s.readNetworkBodies({}))).toBe(true);

    // reconfigure restarts the context (closes tabs) — do it last.
    await s.reconfigure({ viewport: { width: 700, height: 500 } });
  }, 120_000);
});
