import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf, isToolError } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("snap");

describe.skipIf(SKIP)("tools/snapshot — compact / store_as / diff_against", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let snap: ReturnType<typeof import("../../src/tools/snapshot.js").makeSnapshotHandler>;
  let click: ReturnType<typeof import("../../src/tools/interact.js").makeClickHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const s = await import("../../src/tools/snapshot.js");
    const i = await import("../../src/tools/interact.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    snap = s.makeSnapshotHandler(mgr);
    click = i.makeClickHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("returns YAML-style tree by default", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await snap({ interesting_only: true, format: "yaml" });
    // Chromium emits "RootWebArea" at the top of the AX tree.
    expect(textOf(r)).toMatch(/^- (Root)?WebArea/m);
  }, 60_000);

  it("json format returns parseable JSON", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await snap({ interesting_only: true, format: "json" });
    const parsed = JSON.parse(textOf(r));
    expect(parsed.role).toBeDefined();
  }, 60_000);

  it("compact=true strips to interactive + landmark nodes", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await snap({ interesting_only: true, compact: true, format: "yaml" });
    const t = textOf(r);
    expect(t).toContain("textbox");
    expect(t).toContain("button");
  }, 60_000);

  it("store_as saves a named snapshot and notes it in the output", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    const r = await snap({ interesting_only: true, format: "yaml", store_as: "dash-before" });
    expect(textOf(r)).toContain('stored as "dash-before"');
  }, 60_000);

  it("diff_against reports no changes when nothing has changed", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    await snap({ interesting_only: true, format: "yaml", store_as: "same" });
    const r = await snap({ interesting_only: true, format: "yaml", diff_against: "same" });
    expect(textOf(r)).toContain("No changes since");
  }, 60_000);

  it("diff_against detects added items after an interaction", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    await snap({ interesting_only: true, format: "yaml", store_as: "before-add" });
    await click({ target: "Add", target_type: "role", role: "button", exact: false });
    const r = await snap({ interesting_only: true, format: "yaml", diff_against: "before-add" });
    const t = textOf(r);
    expect(t).toContain('diff vs "before-add"');
    expect(t).toContain("Added");
    expect(t).toContain("pay bills");
  }, 60_000);

  it("diff_against + store_as rolls forward the stored snapshot", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    await snap({ interesting_only: true, format: "yaml", store_as: "roll-1" });
    await click({ target: "Add", target_type: "role", role: "button", exact: false });
    await snap({ interesting_only: true, format: "yaml", diff_against: "roll-1", store_as: "roll-2" });
    // roll-2 should now reflect the post-click state, so diffing against roll-2
    // with no further changes should say "No changes".
    const again = await snap({ interesting_only: true, format: "yaml", diff_against: "roll-2" });
    expect(textOf(again)).toContain("No changes since");
  }, 60_000);

  it("diff_against unknown label returns isError", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    const r = await snap({ interesting_only: true, format: "yaml", diff_against: "never-stored" });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("No stored snapshot");
  }, 60_000);

  it("selector — snapshots a subtree rooted at that element", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    const r = await snap({ interesting_only: true, format: "yaml", selector: "main" });
    const t = textOf(r);
    expect(t.length).toBeGreaterThan(0);
  }, 60_000);

  it("max_depth truncates descendants with 'N hidden children'", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    const r = await snap({ interesting_only: true, format: "yaml", max_depth: 0 });
    expect(textOf(r)).toMatch(/hidden child/);
  }, 60_000);

  it("returns 'empty accessibility tree' only when CDP returns nothing", async () => {
    // about:blank → AX tree is tiny but not null. Synth a manager stub to
    // exercise the null branch of the handler.
    const stubMgr = {
      a11ySnapshot: async () => null,
    } as unknown as typeof mgr;
    const { makeSnapshotHandler } = await import("../../src/tools/snapshot.js");
    const r = await makeSnapshotHandler(stubMgr)({ interesting_only: true, format: "yaml" });
    expect(textOf(r)).toContain("empty accessibility tree");
  }, 60_000);
});
