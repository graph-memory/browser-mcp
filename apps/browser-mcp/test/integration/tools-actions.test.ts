import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("actions");

describe.skipIf(SKIP)("tools/actions — press, hover, select_option, check, drag", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let evaluate: ReturnType<typeof import("../../src/tools/interact.js").makeEvaluateHandler>;
  let type: ReturnType<typeof import("../../src/tools/interact.js").makeTypeHandler>;
  let a: typeof import("../../src/tools/actions.js");
  let press: ReturnType<typeof a.makePressHandler>;
  let hover: ReturnType<typeof a.makeHoverHandler>;
  let selectOption: ReturnType<typeof a.makeSelectOptionHandler>;
  let check: ReturnType<typeof a.makeCheckHandler>;
  let drag: ReturnType<typeof a.makeDragHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const i = await import("../../src/tools/interact.js");
    a = await import("../../src/tools/actions.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    evaluate = i.makeEvaluateHandler(mgr);
    type = i.makeTypeHandler(mgr);
    press = a.makePressHandler(mgr);
    hover = a.makeHoverHandler(mgr);
    selectOption = a.makeSelectOptionHandler(mgr);
    check = a.makeCheckHandler(mgr);
    drag = a.makeDragHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  // evaluate() JSON-stringifies its result, so parse it back to a real value.
  const evalJson = async (expr: string) => JSON.parse(textOf(await evaluate({ expression: expr })));

  it("press — Backspace on a focused field deletes a char", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    await type({ target: "#note", target_type: "selector", text: "ab", submit: false });
    await press({ key: "Backspace", target: "#note", target_type: "selector", exact: false });
    expect(await evalJson('document.querySelector("#note").value')).toBe("a");
  }, 60_000);

  it("press — without target sends to the page", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    const r = await press({ key: "Escape", target_type: "text", exact: false });
    expect(textOf(r)).toContain("Pressed Escape (page)");
  }, 60_000);

  it("hover — reveals a hover-only panel", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    await hover({ target: "Menu", target_type: "text", exact: false });
    expect(await evalJson("document.getElementById('panel').offsetParent !== null")).toBe(true);
  }, 60_000);

  it("select_option — by value, label, and index", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    await selectOption({ target: "#fruit", target_type: "selector", by: "value", values: ["b"], exact: false });
    expect(await evalJson('document.querySelector("#fruit").value')).toBe("b");
    await selectOption({ target: "#fruit", target_type: "selector", by: "label", values: ["Cherry"], exact: false });
    expect(await evalJson('document.querySelector("#fruit").value')).toBe("c");
    await selectOption({ target: "#fruit", target_type: "selector", by: "index", values: ["0"], exact: false });
    expect(await evalJson('document.querySelector("#fruit").value')).toBe("a");
  }, 60_000);

  it("select_option — nonexistent option rejects", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    await expect(
      selectOption({ target: "#fruit", target_type: "selector", by: "value", values: ["nope"], exact: false }),
    ).rejects.toThrow();
  }, 60_000);

  it("check — idempotent check/uncheck and radio", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    const checked = (sel: string) => evalJson(`document.querySelector(${JSON.stringify(sel)}).checked`);
    await check({ target: "#agree", target_type: "selector", checked: true, exact: false });
    expect(await checked("#agree")).toBe(true);
    await check({ target: "#agree", target_type: "selector", checked: true, exact: false }); // idempotent
    expect(await checked("#agree")).toBe(true);
    await check({ target: "#agree", target_type: "selector", checked: false, exact: false });
    expect(await checked("#agree")).toBe(false);
    await check({ target: "#plan input[value=pro]", target_type: "selector", checked: true, exact: false });
    expect(await checked("#plan input[value=pro]")).toBe(true);
  }, 60_000);

  it("drag — source onto dropzone", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    await drag({ source: "#src", source_type: "selector", target: "#drop", target_type: "selector" });
    expect(await evalJson("document.getElementById('drop').textContent")).toContain("dropped: DRAG ME");
  }, 60_000);
});
