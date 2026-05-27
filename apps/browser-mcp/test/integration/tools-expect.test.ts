import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf, isToolError } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("expect");

describe.skipIf(SKIP)("tools/expect — every assertion branch", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let exp: ReturnType<typeof import("../../src/tools/expect.js").makeExpectHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const e = await import("../../src/tools/expect.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    exp = e.makeExpectHandler(mgr);
    // Warm up Chromium outside the first test's budget — cold-start on CI
    // can run past 5 s, which would time out the first assertion test.
    await open({ url: fixtureUrl("form.html") });
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  async function loadForm() {
    await open({ url: fixtureUrl("form.html") });
  }

  it("visible — PASS when the element is visible", async () => {
    await loadForm();
    const r = await exp({ assertion: "visible", target: "h1", target_type: "selector" });
    expect(textOf(r)).toMatch(/^PASS visible/);
  }, 10_000);

  it("visible — FAIL with explicit 'not found' when selector matches nothing", async () => {
    await loadForm();
    const r = await exp({ assertion: "visible", target: "#nope", target_type: "selector", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("FAIL visible");
  }, 10_000);

  it("hidden — PASS when the element does not exist", async () => {
    await loadForm();
    const r = await exp({ assertion: "hidden", target: "#nope", target_type: "selector", timeout_ms: 200 });
    expect(textOf(r)).toMatch(/^PASS hidden/);
  }, 10_000);

  it("enabled — PASS on an enabled button", async () => {
    await loadForm();
    const r = await exp({ assertion: "enabled", target: "button[type=submit]", target_type: "selector" });
    expect(textOf(r)).toMatch(/^PASS enabled/);
  }, 10_000);

  it("disabled — FAIL on an enabled button (with retry)", async () => {
    await loadForm();
    const r = await exp({ assertion: "disabled", target: "button[type=submit]", target_type: "selector", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
  }, 10_000);

  it("text_equals — exact match passes", async () => {
    await loadForm();
    const r = await exp({ assertion: "text_equals", target: "h1", target_type: "selector", expected: "Sign in" });
    expect(textOf(r)).toMatch(/^PASS text_equals/);
  }, 10_000);

  it("text_contains — substring passes", async () => {
    await loadForm();
    const r = await exp({ assertion: "text_contains", target: "h1", target_type: "selector", expected: "Sign" });
    expect(textOf(r)).toMatch(/^PASS text_contains/);
  }, 10_000);

  it("text_matches — regex passes", async () => {
    await loadForm();
    const r = await exp({ assertion: "text_matches", target: "h1", target_type: "selector", expected: "^Sign" });
    expect(textOf(r)).toMatch(/^PASS text_matches/);
  }, 10_000);

  it("text_matches — bad regex reports 'bad regex'", async () => {
    await loadForm();
    const r = await exp({ assertion: "text_matches", target: "h1", target_type: "selector", expected: "[unterminated", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("bad regex");
  }, 10_000);

  it("value_equals — input value matches", async () => {
    await loadForm();
    await mgr.type('input[name="email"]', "a@b.c", false);
    const r = await exp({ assertion: "value_equals", target: 'input[name="email"]', target_type: "selector", expected: "a@b.c" });
    expect(textOf(r)).toMatch(/^PASS value_equals/);
  }, 10_000);

  it("count — number of matching elements equals expected", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    const r = await exp({ assertion: "count", target: "#items li", target_type: "selector", expected: 2 });
    expect(textOf(r)).toMatch(/^PASS count/);
  }, 10_000);

  it("url_equals — page URL matches exactly", async () => {
    await loadForm();
    const r = await exp({ assertion: "url_equals", target_type: "selector", expected: fixtureUrl("form.html") });
    expect(textOf(r)).toMatch(/^PASS url_equals/);
  }, 10_000);

  it("url_matches — regex against current URL", async () => {
    await loadForm();
    const r = await exp({ assertion: "url_matches", target_type: "selector", expected: "form\\.html$" });
    expect(textOf(r)).toMatch(/^PASS url_matches/);
  }, 10_000);

  it("url_matches — bad regex reports 'bad regex'", async () => {
    await loadForm();
    const r = await exp({ assertion: "url_matches", target_type: "selector", expected: "[unterminated", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("bad regex");
  }, 10_000);

  it("title_equals — page title matches", async () => {
    await loadForm();
    const r = await exp({ assertion: "title_equals", target_type: "selector", expected: "Form test" });
    expect(textOf(r)).toMatch(/^PASS title_equals/);
  }, 10_000);

  it("title_matches — regex on title", async () => {
    await loadForm();
    const r = await exp({ assertion: "title_matches", target_type: "selector", expected: "^Form" });
    expect(textOf(r)).toMatch(/^PASS title_matches/);
  }, 10_000);

  it("title_matches — bad regex reports 'bad regex'", async () => {
    await loadForm();
    const r = await exp({ assertion: "title_matches", target_type: "selector", expected: "[bad", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("bad regex");
  }, 10_000);

  it("element assertion missing target — emits FAIL with 'target required'", async () => {
    await loadForm();
    const r = await exp({ assertion: "visible", target_type: "selector", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("target required");
  }, 10_000);

  it("text assertion missing expected — emits FAIL", async () => {
    await loadForm();
    const r = await exp({ assertion: "text_equals", target: "h1", target_type: "selector", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("target + expected required");
  }, 10_000);

  it("url_equals missing expected — emits FAIL", async () => {
    await loadForm();
    const r = await exp({ assertion: "url_equals", target_type: "selector", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("expected required");
  }, 10_000);

  it("title_equals missing expected — emits FAIL", async () => {
    await loadForm();
    const r = await exp({ assertion: "title_equals", target_type: "selector", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("expected required");
  }, 10_000);

  it("hidden — FAIL when element exists and is visible", async () => {
    await loadForm();
    const r = await exp({ assertion: "hidden", target: "h1", target_type: "selector", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("FAIL hidden");
  }, 10_000);

  it("disabled — PASS on a disabled element", async () => {
    await open({ url: fixtureUrl("article.html") });
    // Inject a disabled button via evaluate so we don't need a new fixture.
    await mgr.getPage().evaluate(() => {
      const b = document.createElement("button");
      b.id = "disabled-btn";
      b.disabled = true;
      b.textContent = "Disabled";
      document.body.appendChild(b);
    });
    const r = await exp({ assertion: "disabled", target: "#disabled-btn", target_type: "selector" });
    expect(textOf(r)).toMatch(/^PASS disabled/);
  }, 10_000);

  it("enabled — FAIL on a disabled element", async () => {
    await open({ url: fixtureUrl("article.html") });
    await mgr.getPage().evaluate(() => {
      const b = document.createElement("button");
      b.id = "dis-btn-2";
      b.disabled = true;
      b.textContent = "Nope";
      document.body.appendChild(b);
    });
    const r = await exp({ assertion: "enabled", target: "#dis-btn-2", target_type: "selector", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("FAIL enabled");
  }, 10_000);

  it("value_equals — FAIL on mismatch", async () => {
    await loadForm();
    await mgr.type('input[name="email"]', "real@example.com", false);
    const r = await exp({ assertion: "value_equals", target: 'input[name="email"]', target_type: "selector", expected: "wrong@example.com", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("FAIL value_equals");
  }, 10_000);

  it("count — FAIL when count does not match", async () => {
    await open({ url: fixtureUrl("dashboard.html") });
    const r = await exp({ assertion: "count", target: "#items li", target_type: "selector", expected: 99, timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("FAIL count");
  }, 10_000);

  it("url_equals — FAIL on mismatch", async () => {
    await loadForm();
    const r = await exp({ assertion: "url_equals", target_type: "selector", expected: "https://nope.example.com/", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("FAIL url_equals");
  }, 10_000);

  it("url_matches — FAIL when regex does not match", async () => {
    await loadForm();
    const r = await exp({ assertion: "url_matches", target_type: "selector", expected: "definitely-not-in-path", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("FAIL url_matches");
  }, 10_000);

  it("title_matches — FAIL when regex does not match", async () => {
    await loadForm();
    const r = await exp({ assertion: "title_matches", target_type: "selector", expected: "^Other", timeout_ms: 200 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("FAIL title_matches");
  }, 10_000);

  it("catches thrown errors from inside checkOnce (e.g. non-input for value_equals)", async () => {
    await loadForm();
    // value_equals on an <h1> throws immediately — it's not an input. The
    // outer retry loop's `catch` records the message and eventually FAILs.
    const r = await exp({ assertion: "value_equals", target: "h1", target_type: "selector", expected: "x", timeout_ms: 500 });
    expect(isToolError(r)).toBe(true);
    expect(textOf(r)).toContain("FAIL value_equals");
  }, 10_000);
});
