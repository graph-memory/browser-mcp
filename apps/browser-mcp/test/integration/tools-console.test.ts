import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, fixtureUrl, textOf } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("console");

describe.skipIf(SKIP)("tools/console_log — console + pageerror capture", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let consoleLog: ReturnType<typeof import("../../src/tools/console.js").makeConsoleHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const c = await import("../../src/tools/console.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    consoleLog = c.makeConsoleHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("captures console messages and the uncaught page error", async () => {
    await open({ url: fixtureUrl("console.html") });
    // pageerror fires via setTimeout(0) after load — give it a tick.
    await new Promise((r) => setTimeout(r, 200));
    const all = textOf(await consoleLog({}));
    expect(all).toContain("hello log");
    expect(all).toContain("a warning line");
    expect(all).toContain("boom error happened");
    expect(all).toContain("uncaught boom");
  }, 60_000);

  it("filters by level=error", async () => {
    await open({ url: fixtureUrl("console.html") });
    const r = textOf(await consoleLog({ level: "error" }));
    expect(r).toContain("boom error happened");
    expect(r).not.toContain("hello log");
    expect(r).not.toContain("a warning line");
  }, 60_000);

  it("filters by level=pageerror", async () => {
    await open({ url: fixtureUrl("console.html") });
    await new Promise((r) => setTimeout(r, 200));
    const r = textOf(await consoleLog({ level: "pageerror" }));
    expect(r).toContain("uncaught boom");
  }, 60_000);

  it("filters by text_regex", async () => {
    await open({ url: fixtureUrl("console.html") });
    const r = textOf(await consoleLog({ text_regex: "warning" }));
    expect(r).toContain("a warning line");
    expect(r).not.toContain("hello log");
  }, 60_000);
});
