import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("interact");

describe.skipIf(SKIP)("tools/interact — click, type, scroll, find, wait, evaluate", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let click: ReturnType<typeof import("../../src/tools/interact.js").makeClickHandler>;
  let type: ReturnType<typeof import("../../src/tools/interact.js").makeTypeHandler>;
  let scroll: ReturnType<typeof import("../../src/tools/interact.js").makeScrollHandler>;
  let find: ReturnType<typeof import("../../src/tools/interact.js").makeFindHandler>;
  let wait: ReturnType<typeof import("../../src/tools/interact.js").makeWaitHandler>;
  let evaluate: ReturnType<typeof import("../../src/tools/interact.js").makeEvaluateHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const i = await import("../../src/tools/interact.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    click = i.makeClickHandler(mgr);
    type = i.makeTypeHandler(mgr);
    scroll = i.makeScrollHandler(mgr);
    find = i.makeFindHandler(mgr);
    wait = i.makeWaitHandler(mgr);
    evaluate = i.makeEvaluateHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("click by text — reports target type", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await click({ target: "Sign in", target_type: "text", exact: false });
    expect(textOf(r)).toContain("Clicked (text): Sign in");
  }, 60_000);

  it("click by role — appends role= suffix in message", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    const r = await click({ target: "Add", target_type: "role", role: "button", exact: false });
    expect(textOf(r)).toContain("role=button");
  }, 60_000);

  it("type — label locator + submit=false", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await type({
      target: "Email",
      target_type: "label",
      text: "user@example.com",
      submit: false,
    });
    expect(textOf(r)).toContain("Typed into (label): Email");
  }, 60_000);

  it("type with submit=true presses Enter and the message indicates it", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await type({
      target: "Email",
      target_type: "label",
      text: "user@example.com",
      submit: true,
    });
    expect(textOf(r)).toContain("+ Enter");
  }, 60_000);

  it("type with role locator + role suffix in message", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await type({
      target: "Email",
      target_type: "role",
      role: "textbox",
      text: "x@y.z",
      submit: false,
    });
    expect(textOf(r)).toContain("role=textbox");
  }, 60_000);

  it("type accepts the legacy `selector` alias", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await type({
      target_type: "selector",
      selector: 'input[name="email"]',
      text: "legacy@example.com",
      submit: false,
    });
    expect(textOf(r)).toContain("Typed into");
  }, 60_000);

  it("type throws when neither target nor selector is provided", async () => {
    await open({ url: fixtureUrl("form.html") });
    await expect(type({ target_type: "selector", text: "x", submit: false })).rejects.toThrow(/requires/);
  }, 60_000);

  it("scroll 'down' reports scroll position", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await scroll({ direction: "down", amount: 200 });
    expect(textOf(r)).toContain("Scrolled down");
    expect(textOf(r)).toContain("px");
  }, 60_000);

  it("scroll 'up' works too", async () => {
    await open({ url: fixtureUrl("article.html") });
    await scroll({ direction: "down", amount: 500 });
    const r = await scroll({ direction: "up", amount: 200 });
    expect(textOf(r)).toContain("Scrolled up");
  }, 60_000);

  it("scroll 'top' jumps to page start", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await scroll({ direction: "top", amount: 0 });
    expect(textOf(r)).toContain("Scrolled top");
  }, 60_000);

  it("scroll 'bottom' jumps to page end", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await scroll({ direction: "bottom", amount: 0 });
    expect(textOf(r)).toContain("Scrolled bottom");
  }, 60_000);

  it("find — returns matches with snippets and selectors", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await find({ query: "accessibility", limit: 5 });
    const t = textOf(r);
    expect(t).toMatch(/^1\. /);
    expect(t).toContain("selector:");
  }, 60_000);

  it("find — reports 'no matches' for a missing query", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await find({ query: "xyzzyzxyzz-impossible-token", limit: 5 });
    expect(textOf(r)).toContain('No matches for "xyzzyzxyzz-impossible-token"');
  }, 60_000);

  it("wait — default 'visible' state against a selector that exists", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await wait({ selector: "form#login", state: "visible", timeout: 5000 });
    expect(textOf(r)).toContain("visible");
  }, 60_000);

  it("evaluate — returns JSON-serialized result", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await evaluate({ expression: "1 + 2" });
    expect(textOf(r)).toBe("3");
  }, 60_000);

  it("evaluate — handles undefined result explicitly", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await evaluate({ expression: "undefined" });
    expect(textOf(r)).toBe("undefined");
  }, 60_000);

  it("evaluate — stringifies complex values", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await evaluate({ expression: "({ a: 1, b: [2, 3] })" });
    expect(JSON.parse(textOf(r))).toEqual({ a: 1, b: [2, 3] });
  }, 60_000);
});
