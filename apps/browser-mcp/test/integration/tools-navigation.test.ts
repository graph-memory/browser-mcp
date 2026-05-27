import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("nav");

describe.skipIf(SKIP)("tools/open + tabs + interact navigation", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let openHandler: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let listHandler: ReturnType<typeof import("../../src/tools/tabs.js").makeTabsListHandler>;
  let switchHandler: ReturnType<typeof import("../../src/tools/tabs.js").makeTabSwitchHandler>;
  let closeHandler: ReturnType<typeof import("../../src/tools/tabs.js").makeTabCloseHandler>;
  let reloadHandler: ReturnType<typeof import("../../src/tools/interact.js").makeReloadHandler>;
  let backHandler: ReturnType<typeof import("../../src/tools/interact.js").makeBackHandler>;
  let forwardHandler: ReturnType<typeof import("../../src/tools/interact.js").makeForwardHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const tabs = await import("../../src/tools/tabs.js");
    const interact = await import("../../src/tools/interact.js");
    const open = await import("../../src/tools/open.js");
    mgr = new BrowserManager(profileName);
    openHandler = open.makeOpenHandler(mgr);
    listHandler = tabs.makeTabsListHandler(mgr);
    switchHandler = tabs.makeTabSwitchHandler(mgr);
    closeHandler = tabs.makeTabCloseHandler(mgr);
    reloadHandler = interact.makeReloadHandler(mgr);
    backHandler = interact.makeBackHandler(mgr);
    forwardHandler = interact.makeForwardHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("browser_tabs_list shows (no tabs open) before any navigation", async () => {
    const res = await listHandler();
    expect(textOf(res)).toBe("(no tabs open)");
  });

  it("browser_open reports HTTP status and title", async () => {
    const res = await openHandler({ url: fixtureUrl("article.html") });
    const t = textOf(res);
    // file:// URLs report as HTTP 200 in Chromium
    expect(t).toMatch(/^HTTP (200|status unknown)/);
    expect(t).toContain("Sample Post");
    expect(t).toContain("Tab:");
  }, 60_000);

  it("browser_open into an existing tab_id navigates that tab", async () => {
    // Open first, capture tab_id, then re-navigate
    const first = await openHandler({ url: fixtureUrl("article.html") });
    const tabId = first.content[0].text.match(/Tab: (\S+)/)?.[1] as string;
    const res = await openHandler({ url: fixtureUrl("form.html"), tab_id: tabId });
    expect(textOf(res)).toContain("Form test");
    expect(textOf(res)).toContain(`Tab: ${tabId}`);
  }, 60_000);

  it("browser_tabs_list marks the active tab with →", async () => {
    await openHandler({ url: fixtureUrl("article.html") });
    const res = await listHandler();
    expect(textOf(res)).toMatch(/^→ /m);
  }, 60_000);

  it("browser_tab_switch changes the active tab", async () => {
    const a = await openHandler({ url: fixtureUrl("article.html") });
    const tabA = a.content[0].text.match(/Tab: (\S+)/)?.[1] as string;
    const b = await openHandler({ url: fixtureUrl("form.html") });
    const tabB = b.content[0].text.match(/Tab: (\S+)/)?.[1] as string;
    expect(tabA).not.toBe(tabB);
    const sw = await switchHandler({ tab_id: tabA });
    expect(textOf(sw)).toBe(`Switched to ${tabA}`);
  }, 60_000);

  it("browser_tab_close removes a tab from the list", async () => {
    const b = await openHandler({ url: fixtureUrl("form.html") });
    const tab = b.content[0].text.match(/Tab: (\S+)/)?.[1] as string;
    const r = await closeHandler({ tab_id: tab });
    expect(textOf(r)).toBe(`Closed ${tab}`);
  }, 60_000);

  it("browser_back then browser_forward round-trip through history", async () => {
    const first = await openHandler({ url: fixtureUrl("article.html") });
    const tab = first.content[0].text.match(/Tab: (\S+)/)?.[1] as string;
    await openHandler({ url: fixtureUrl("form.html"), tab_id: tab });
    const back = await backHandler({ tab_id: tab });
    expect(textOf(back)).toContain("Back →");
    const fwd = await forwardHandler({ tab_id: tab });
    expect(textOf(fwd)).toContain("Forward →");
  }, 60_000);

  it("browser_back at earliest entry reports 'no history'", async () => {
    const first = await openHandler({ url: fixtureUrl("article.html") });
    const tab = first.content[0].text.match(/Tab: (\S+)/)?.[1] as string;
    const back = await backHandler({ tab_id: tab });
    expect(textOf(back)).toContain("Already at earliest history entry");
  }, 60_000);

  it("browser_forward at latest entry reports 'no history'", async () => {
    const first = await openHandler({ url: fixtureUrl("article.html") });
    const tab = first.content[0].text.match(/Tab: (\S+)/)?.[1] as string;
    const fwd = await forwardHandler({ tab_id: tab });
    expect(textOf(fwd)).toContain("Already at latest history entry");
  }, 60_000);

  it("browser_reload returns a tab with an URL", async () => {
    const first = await openHandler({ url: fixtureUrl("article.html") });
    const tab = first.content[0].text.match(/Tab: (\S+)/)?.[1] as string;
    const r = await reloadHandler({ tab_id: tab });
    expect(textOf(r)).toContain("Reloaded →");
  }, 60_000);
});
