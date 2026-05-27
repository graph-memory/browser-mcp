import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf, isToolError } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("fillform");

describe.skipIf(SKIP)("tools/fill_form — batch form fill", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let evaluate: ReturnType<typeof import("../../src/tools/interact.js").makeEvaluateHandler>;
  let fillForm: ReturnType<typeof import("../../src/tools/fill-form.js").makeFillFormHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const i = await import("../../src/tools/interact.js");
    const f = await import("../../src/tools/fill-form.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    evaluate = i.makeEvaluateHandler(mgr);
    fillForm = f.makeFillFormHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  const evalJson = async (expr: string) => JSON.parse(textOf(await evaluate({ expression: expr })));

  it("fills text + checkbox + select in one call", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    const r = await fillForm({
      fields: [
        { target: "#note", target_type: "selector", exact: false, value: "hi" },
        { target: "#agree", target_type: "selector", exact: false, checked: true },
        { target: "#fruit", target_type: "selector", exact: false, options: ["c"] },
      ],
    });
    expect(isToolError(r)).toBe(false);
    expect(textOf(r)).toContain("Filled 3 fields");
    expect(await evalJson('document.querySelector("#note").value')).toBe("hi");
    expect(await evalJson('document.querySelector("#agree").checked')).toBe(true);
    expect(await evalJson('document.querySelector("#fruit").value')).toBe("c");
  }, 60_000);

  it("fills a login form by label and submits via click", async () => {
    await open({ url: fixtureUrl("form.html") });
    const r = await fillForm({
      fields: [
        { target: "Email", target_type: "label", exact: false, value: "a@b.co" },
        { target: "Password", target_type: "label", exact: false, value: "secret" },
        { target: "Remember me", target_type: "label", exact: false, checked: true },
      ],
      submit: { target: "Sign in", target_type: "role", role: "button" },
    });
    expect(textOf(r)).toContain("submit(Sign in)");
    expect(await evalJson("document.getElementById('status').textContent")).toContain("Signed in as a@b.co (remembered)");
  }, 60_000);

  it("aborts on the first failing field and reports which", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    const r = await fillForm({
      fields: [
        { target: "#note", target_type: "selector", exact: false, value: "ok" },
        { target: "#does-not-exist", target_type: "selector", exact: false, value: "x" },
      ],
    });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("filled 1/2");
    expect(textOf(r)).toContain("#does-not-exist");
  }, 60_000);
});
