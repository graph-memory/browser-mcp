import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("configure");

describe.skipIf(SKIP)("tools/configure — presets, overrides, and restart branches", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let configure: ReturnType<typeof import("../../src/tools/configure.js").makeConfigureHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const c = await import("../../src/tools/configure.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    configure = c.makeConfigureHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("with no parameters emits 'No changes'", async () => {
    const r = await configure({});
    expect(textOf(r)).toContain("No changes");
  }, 60_000);

  it("viewport_preset — no restart, reports applied preset", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ viewport_preset: "desktop-hd" });
    expect(textOf(r)).toContain("viewport: desktop-hd");
    expect(textOf(r)).not.toContain("context was restarted");
  }, 60_000);

  it("custom viewport_width + viewport_height — no restart when alone", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ viewport_width: 1024, viewport_height: 768 });
    expect(textOf(r)).toContain("viewport: 1024x768");
  }, 60_000);

  it("user_agent (custom) — no restart, labeled 'custom'", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ user_agent: "test/1.0" });
    expect(textOf(r)).toContain("user_agent: custom");
  }, 60_000);

  it("ua_preset — applied with preset name", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ ua_preset: "safari-desktop" });
    expect(textOf(r)).toContain("user_agent: safari-desktop");
  }, 60_000);

  it("locale — no restart path", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ locale: "ja-JP" });
    expect(textOf(r)).toContain("locale: ja-JP");
  }, 60_000);

  it("color_scheme — no restart path", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ color_scheme: "dark" });
    expect(textOf(r)).toContain("color_scheme: dark");
  }, 60_000);

  it("device_scale_factor — restarts context", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ device_scale_factor: 2 });
    expect(textOf(r)).toContain("device_scale_factor: 2");
    expect(textOf(r)).toContain("context was restarted");
  }, 120_000);

  it("is_mobile — restarts context", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ is_mobile: true });
    expect(textOf(r)).toContain("mobile: true");
    expect(textOf(r)).toContain("context was restarted");
  }, 120_000);

  it("is_mobile + viewport_width + viewport_height — viewport folded into restart overrides", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({
      is_mobile: true,
      viewport_width: 375,
      viewport_height: 667,
    });
    expect(textOf(r)).toContain("viewport: 375x667");
    expect(textOf(r)).toContain("context was restarted");
  }, 120_000);

  it("is_mobile + viewport_preset — preset folded into restart overrides", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ is_mobile: true, viewport_preset: "mobile" });
    expect(textOf(r)).toContain("viewport: mobile");
  }, 120_000);

  it("is_mobile + ua_preset — ua folded into restart overrides", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ is_mobile: true, ua_preset: "chrome-mobile" });
    expect(textOf(r)).toContain("user_agent: chrome-mobile");
  }, 120_000);

  it("is_mobile + locale + color_scheme — both applied during restart", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ is_mobile: true, locale: "en-GB", color_scheme: "light" });
    const t = textOf(r);
    expect(t).toContain("locale: en-GB");
    expect(t).toContain("color_scheme: light");
  }, 120_000);

  it("device_preset — applies viewport/UA/scale atomically via restart", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await configure({ device_preset: "iphone-15" });
    const t = textOf(r);
    expect(t).toContain("device: iphone-15");
    expect(t).toContain("393x852");
    expect(t).toContain("mobile");
    expect(t).toContain("context was restarted");
  }, 120_000);
});
