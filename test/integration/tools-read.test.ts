import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("read");

describe.skipIf(SKIP)("tools/read — markdown, text, html × compact", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let openHandler: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let readHandler: ReturnType<typeof import("../../src/tools/read.js").makeReadHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const open = await import("../../src/tools/open.js");
    const read = await import("../../src/tools/read.js");
    mgr = new BrowserManager(profileName);
    openHandler = open.makeOpenHandler(mgr);
    readHandler = read.makeReadHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("markdown extracts article body", async () => {
    await openHandler({ url: fixtureUrl("article.html") });
    const r = await readHandler({ mode: "markdown" });
    const t = textOf(r);
    expect(t).toContain("Understanding Accessibility Trees");
    expect(t).toContain("URL: ");
  }, 60_000);

  it("text mode with compact=true strips chrome", async () => {
    await openHandler({ url: fixtureUrl("dashboard.html") });
    const r = await readHandler({ mode: "text", compact: true });
    expect(textOf(r)).toContain("Welcome back, user42");
    expect(textOf(r)).not.toContain("Copyright 2025");
  }, 60_000);

  it("text mode with compact=false keeps chrome", async () => {
    await openHandler({ url: fixtureUrl("dashboard.html") });
    const r = await readHandler({ mode: "text", compact: false });
    // compact=false → everything via page.innerText, including footer
    expect(textOf(r)).toContain("Copyright 2025");
  }, 60_000);

  it("html mode returns raw HTML", async () => {
    await openHandler({ url: fixtureUrl("article.html") });
    const r = await readHandler({ mode: "html", compact: false });
    expect(textOf(r)).toContain("<!DOCTYPE html>");
    expect(textOf(r)).toContain("<article>");
  }, 60_000);

  it("html mode with compact strips nav/script/style", async () => {
    await openHandler({ url: fixtureUrl("dashboard.html") });
    const r = await readHandler({ mode: "html", compact: true });
    expect(textOf(r)).not.toMatch(/<nav/i);
    expect(textOf(r)).not.toMatch(/<footer/i);
    expect(textOf(r)).not.toMatch(/<script/i);
  }, 60_000);

  it("selector narrows extraction to a subtree", async () => {
    await openHandler({ url: fixtureUrl("article.html") });
    const r = await readHandler({ mode: "text", selector: "article", compact: false });
    expect(textOf(r)).toContain("Understanding Accessibility Trees");
    expect(textOf(r)).not.toContain("Secondary nav");
  }, 60_000);

  it("selector + html returns only the subtree's outerHTML", async () => {
    await openHandler({ url: fixtureUrl("article.html") });
    const r = await readHandler({ mode: "html", selector: "article", compact: false });
    expect(textOf(r)).toContain("<article>");
    expect(textOf(r)).toContain("</article>");
    expect(textOf(r)).not.toMatch(/<footer/i);
  }, 60_000);

  it("selector + markdown runs Readability on the subtree HTML", async () => {
    await openHandler({ url: fixtureUrl("article.html") });
    const r = await readHandler({ mode: "markdown", selector: "article" });
    expect(textOf(r)).toContain("Accessibility");
  }, 60_000);

  it("missing selector throws", async () => {
    await openHandler({ url: fixtureUrl("article.html") });
    await expect(readHandler({ mode: "text", selector: "#does-not-exist", compact: false })).rejects.toThrow(/Selector not found/);
  }, 60_000);

  it("max_chars caps output", async () => {
    await openHandler({ url: fixtureUrl("article.html") });
    const r = await readHandler({ mode: "markdown", max_chars: 100 });
    const t = textOf(r);
    // Output: "URL: ...\n\n" + body truncated to 100 chars + "[...truncated, N more chars]"
    expect(t).toContain("[...truncated");
  }, 60_000);
});
