import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf, isToolError } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("misc");

describe.skipIf(SKIP)("tools/{network,cookies,permissions,visual} — mixed", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let network: ReturnType<typeof import("../../src/tools/network.js").makeNetworkHandler>;
  let cookies: ReturnType<typeof import("../../src/tools/cookies.js").makeCookiesHandler>;
  let perms: ReturnType<typeof import("../../src/tools/permissions.js").makePermissionsHandler>;
  let screenshot: ReturnType<typeof import("../../src/tools/visual.js").makeScreenshotHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const n = await import("../../src/tools/network.js");
    const c = await import("../../src/tools/cookies.js");
    const p = await import("../../src/tools/permissions.js");
    const v = await import("../../src/tools/visual.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    network = n.makeNetworkHandler(mgr);
    cookies = c.makeCookiesHandler(mgr);
    perms = p.makePermissionsHandler(mgr);
    screenshot = v.makeScreenshotHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  // --- network ---
  it("network — empty result reports (no network entries match; ring has N total)", async () => {
    const r = await network({ failed_only: true });
    expect(textOf(r)).toContain("ring has");
  });

  it("network — invalid regex returns isError", async () => {
    // Drive some traffic first
    await open({ url: fixtureUrl("article.html") });
    const r = await network({ url_regex: "[bad-regex" });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("invalid filter");
  });

  it("network — entries show status, method, resource_type", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await network({ limit: 50 });
    const t = textOf(r);
    expect(t).toContain("entries (of");
    expect(t).toMatch(/\bGET\b/);
  });

  // --- cookies ---
  it("cookies get — reports (no cookies) initially", async () => {
    // clear first to ensure predictable state
    await cookies({ action: "clear" });
    const r = await cookies({ action: "get" });
    expect(textOf(r)).toBe("(no cookies)");
  });

  it("cookies set — adds a cookie using url form", async () => {
    const r = await cookies({
      action: "set",
      cookies: [{
        name: "testcookie",
        value: "yes",
        url: "https://example.com/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
        expires: Math.floor(Date.now() / 1000) + 3600,
      }],
    });
    expect(textOf(r)).toBe("Set 1 cookie");
  });

  it("cookies get — returns the formatted cookie line with flags", async () => {
    const r = await cookies({ action: "get", urls: ["https://example.com/"] });
    const t = textOf(r);
    expect(t).toContain("testcookie");
    expect(t).toContain("Secure");
    expect(t).toContain("HttpOnly");
    expect(t).toContain("SameSite=Lax");
  });

  it("cookies set — throws when 'cookies' array is missing", async () => {
    await expect(cookies({ action: "set" })).rejects.toThrow(/required/);
  });

  it("cookies set — throws when 'cookies' array is empty", async () => {
    await expect(cookies({ action: "set", cookies: [] })).rejects.toThrow(/required/);
  });

  it("cookies — session cookie (no expires) shows expires=session", async () => {
    await cookies({ action: "clear" });
    await cookies({
      action: "set",
      cookies: [{ name: "sessid", value: "abc", url: "https://example.com/" }],
    });
    const r = await cookies({ action: "get", urls: ["https://example.com/"] });
    expect(textOf(r)).toContain("expires=session");
  });

  it("cookies clear — wipes all cookies", async () => {
    const r = await cookies({ action: "clear" });
    expect(textOf(r)).toBe("Cleared all cookies");
    const after = await cookies({ action: "get" });
    expect(textOf(after)).toBe("(no cookies)");
  });

  // --- permissions ---
  it("permissions 'none' clears all grants", async () => {
    const r = await perms({ grant: "none" });
    expect(textOf(r)).toContain("Cleared all permission grants");
  });

  it("permissions 'all' grants every supported perm", async () => {
    await open({ url: fixtureUrl("article.html") });
    // file:// origins can't be pre-granted in Playwright; origin will be skipped
    const r = await perms({ grant: "all" });
    const t = textOf(r);
    expect(t).toMatch(/Granted \d+ permissions/);
  });

  it("permissions — explicit origin is honored", async () => {
    const r = await perms({
      grant: ["geolocation", "notifications"],
      origin: "https://example.com",
    });
    expect(textOf(r)).toContain("to https://example.com");
    expect(textOf(r)).toContain("geolocation");
    expect(textOf(r)).toContain("notifications");
  });

  it("permissions — singular count is 'permission'", async () => {
    const r = await perms({ grant: ["geolocation"], origin: "https://example.com" });
    expect(textOf(r)).toContain("Granted 1 permission ");
  });

  // The "no active tab → grants globally" branch is covered by a mock-based
  // unit test in test/unit/tool-handlers-mock.test.ts (faster, deterministic).

  // --- visual ---
  it("screenshot full_page=false returns PNG image bytes", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await screenshot({ full_page: false });
    const content = (r as { content: Array<{ type: string; data: string; mimeType: string }> }).content[0];
    expect(content.type).toBe("image");
    expect(content.mimeType).toBe("image/png");
    // Base64 PNG signature starts with iVBOR
    expect(content.data.startsWith("iVBOR")).toBe(true);
  });

  it("screenshot full_page=true also returns a PNG", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await screenshot({ full_page: true });
    const content = (r as { content: Array<{ type: string; data: string }> }).content[0];
    expect(content.type).toBe("image");
    expect(content.data.length).toBeGreaterThan(100);
  });

  it("screenshot with selector captures that element only", async () => {
    await open({ url: fixtureUrl("article.html") });
    const r = await screenshot({ full_page: false, selector: "article" });
    const content = (r as { content: Array<{ type: string; data: string }> }).content[0];
    expect(content.type).toBe("image");
  });
});
