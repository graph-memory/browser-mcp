import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("sessionscope");

describe.skipIf(SKIP)("N1 — BrowserSession isolates active tab + snapshots, shares context", () => {
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

  it("two sessions keep separate active tabs (no cross-talk)", async () => {
    const a = new BrowserSession(mgr);
    const b = new BrowserSession(mgr);
    await a.navigate(fixtureUrl("form.html"));
    await b.navigate(fixtureUrl("article.html"));
    // A's tab_id-less getPage must still see A's page, not B's.
    expect(a.getPage().url()).toContain("form.html");
    expect(b.getPage().url()).toContain("article.html");
  }, 60_000);

  it("snapshot store is per-session", async () => {
    const a = new BrowserSession(mgr);
    const b = new BrowserSession(mgr);
    a.storeSnapshot("snap", { role: "RootWebArea", name: "x" });
    expect(a.getStoredSnapshot("snap")).toBeDefined();
    expect(b.getStoredSnapshot("snap")).toBeUndefined();
  }, 60_000);

  it("tabs and context are shared across sessions", async () => {
    const a = new BrowserSession(mgr);
    const b = new BrowserSession(mgr);
    await a.navigate(fixtureUrl("form.html"));
    await b.navigate(fixtureUrl("article.html"));
    // listTabs reflects the shared context — both sessions' tabs are visible.
    const tabsFromA = await a.listTabs();
    const tabsFromB = await b.listTabs();
    expect(tabsFromA.length).toBeGreaterThanOrEqual(2);
    expect(tabsFromA.length).toBe(tabsFromB.length);
  }, 60_000);

  it("getPage throws when this session has no active tab", async () => {
    const c = new BrowserSession(mgr);
    expect(() => c.getPage()).toThrow(/No active tab/);
  }, 60_000);

  it("closing a session's active tab clears its active tab", async () => {
    const a = new BrowserSession(mgr);
    const info = await a.navigate(fixtureUrl("form.html"));
    await a.closeTab(info.tab_id);
    expect(() => a.getPage()).toThrow(/No active tab/);
  }, 60_000);
});
