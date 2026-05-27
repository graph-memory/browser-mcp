import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf, isToolError } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("context");

describe.skipIf(SKIP)("tools/context — storage, handle_dialog, set_geolocation", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let evaluate: ReturnType<typeof import("../../src/tools/interact.js").makeEvaluateHandler>;
  let click: ReturnType<typeof import("../../src/tools/interact.js").makeClickHandler>;
  let storage: ReturnType<typeof import("../../src/tools/storage.js").makeStorageHandler>;
  let dialog: ReturnType<typeof import("../../src/tools/dialog.js").makeDialogHandler>;
  let permissions: ReturnType<typeof import("../../src/tools/permissions.js").makePermissionsHandler>;
  let geolocation: ReturnType<typeof import("../../src/tools/geolocation.js").makeGeolocationHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const i = await import("../../src/tools/interact.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    evaluate = i.makeEvaluateHandler(mgr);
    click = i.makeClickHandler(mgr);
    storage = (await import("../../src/tools/storage.js")).makeStorageHandler(mgr);
    dialog = (await import("../../src/tools/dialog.js")).makeDialogHandler(mgr);
    permissions = (await import("../../src/tools/permissions.js")).makePermissionsHandler(mgr);
    geolocation = (await import("../../src/tools/geolocation.js")).makeGeolocationHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  const evalJson = async (expr: string) => JSON.parse(textOf(await evaluate({ expression: expr })));

  // --- storage ---
  it("storage — set / get / remove / clear (local)", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    await storage({ action: "set", area: "local", key: "tok", value: "abc" });
    expect(textOf(await storage({ action: "get", area: "local", key: "tok" }))).toContain("tok = abc");
    await storage({ action: "remove", area: "local", key: "tok" });
    expect(await evalJson('localStorage.getItem("tok")')).toBeNull();
    await storage({ action: "set", area: "local", key: "k2", value: "v2" });
    await storage({ action: "clear", area: "local" });
    expect(await evalJson("localStorage.length")).toBe(0);
  }, 60_000);

  it("storage — session and local are independent; set requires key+value", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    await storage({ action: "set", area: "session", key: "s", value: "1" });
    expect(await evalJson('localStorage.getItem("s")')).toBeNull();
    expect(await evalJson('sessionStorage.getItem("s")')).toBe("1");
    const bad = await storage({ action: "set", area: "local", key: "x" });
    expect(isToolError(bad)).toBe(true);
  }, 60_000);

  // --- handle_dialog ---
  it("handle_dialog — accept makes confirm() return true", async () => {
    await open({ url: fixtureUrl("dialog.html") });
    await dialog({ action: "accept", persist: false });
    await click({ target: "#confirmBtn", target_type: "selector", exact: false });
    expect(await evalJson("document.getElementById('out').textContent")).toBe("confirmed");
  }, 60_000);

  it("handle_dialog — dismiss makes confirm() return false", async () => {
    await open({ url: fixtureUrl("dialog.html") });
    await dialog({ action: "dismiss", persist: false });
    await click({ target: "#confirmBtn", target_type: "selector", exact: false });
    expect(await evalJson("document.getElementById('out').textContent")).toBe("cancelled");
  }, 60_000);

  it("handle_dialog — prompt text is entered", async () => {
    await open({ url: fixtureUrl("dialog.html") });
    await dialog({ action: "accept", prompt_text: "Ada", persist: false });
    await click({ target: "#promptBtn", target_type: "selector", exact: false });
    expect(await evalJson("document.getElementById('out').textContent")).toBe("got:Ada");
  }, 60_000);

  // --- set_geolocation ---
  it("set_geolocation — page reads the emulated coordinates", async () => {
    await open({ url: fixtureUrl("widgets.html") });
    await permissions({ grant: ["geolocation"] });
    await geolocation({ latitude: 51.5, longitude: -0.12 });
    const lat = await evalJson(
      "new Promise((res, rej) => navigator.geolocation.getCurrentPosition(p => res(p.coords.latitude), e => rej(new Error(e.message)), { timeout: 5000 }))",
    );
    expect(lat).toBeCloseTo(51.5, 3);
  }, 60_000);
});
