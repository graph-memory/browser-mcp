import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Integration tests: drive a real headless Chromium via BrowserManager against
 * local HTML fixtures under file://.
 *
 * Preconditions:
 *   - Chromium is installed (`npx playwright install chromium`, done by the
 *     project's postinstall hook).
 *   - BROWSER_MCP_HEADLESS defaults to true, so tests don't pop windows.
 *
 * Escape hatch: set SKIP_INTEGRATION=1 to skip the whole suite. CI without a
 * display server / browser binaries can set that.
 */
const SKIP = process.env.SKIP_INTEGRATION === "1";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
const articleUrl = pathToFileURL(join(FIXTURES, "article.html")).toString();
const formUrl = pathToFileURL(join(FIXTURES, "form.html")).toString();
const dashboardUrl = pathToFileURL(join(FIXTURES, "dashboard.html")).toString();

// Each test-run gets its own throwaway profile directory so developers' local
// ~/.browser-mcp/profiles isn't touched.
let tmpProfile: string;

beforeAll(() => {
  tmpProfile = mkdtempSync(join(tmpdir(), "browser-mcp-test-"));
  process.env.BROWSER_MCP_PROFILE_DIR = tmpProfile;
  process.env.BROWSER_MCP_HEADLESS = "1";
  // Disable stealth so plugin noise doesn't leak into the AX tree.
  process.env.BROWSER_MCP_STEALTH = "0";
});

afterAll(() => {
  if (tmpProfile) rmSync(tmpProfile, { recursive: true, force: true });
});

describe.skipIf(SKIP)("BrowserManager integration", () => {
  // Imported inside the suite (after env mutation above) so config.ts reads
  // the right BROWSER_MCP_PROFILE_DIR / HEADLESS / STEALTH.
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let filterCompact: typeof import("../../src/browser.js").filterCompact;
  let diffSnapshots: typeof import("../../src/browser.js").diffSnapshots;
  let makeReadHandler: typeof import("../../src/tools/read.js").makeReadHandler;
  let manager: InstanceType<typeof BrowserManager>;

  beforeAll(async () => {
    ({ BrowserManager, filterCompact, diffSnapshots } = await import("../../src/browser.js"));
    ({ makeReadHandler } = await import("../../src/tools/read.js"));
    manager = new BrowserManager("test-profile");
  }, 60_000);

  afterAll(async () => {
    if (manager) await manager.shutdown().catch(() => {});
  }, 30_000);

  it(
    "opens a page and returns title + url",
    async () => {
      const info = await manager.openTab(articleUrl);
      expect(info.tab_id).toMatch(/^[\w-]+$/);
      expect(info.title).toBe("Sample Post");
      expect(info.url).toContain("article.html");
    },
    60_000,
  );

  it(
    "browser_read markdown extracts the article body (Readability)",
    async () => {
      const info = await manager.openTab(articleUrl);
      const read = makeReadHandler(manager);
      const res = await read({ mode: "markdown", tab_id: info.tab_id });
      const text = res.content[0].text;
      expect(text).toContain("Understanding Accessibility Trees");
      expect(text).toContain("screen readers");
      // Readability drops the nav/footer/ad slot on article pages.
      expect(text).not.toContain("Ad slot");
      expect(text).not.toContain("Secondary nav");
    },
    60_000,
  );

  it(
    "browser_read compact mode strips nav/footer on dashboard pages",
    async () => {
      const info = await manager.openTab(dashboardUrl);
      const read = makeReadHandler(manager);
      const res = await read({ mode: "text", compact: true, tab_id: info.tab_id });
      const text = res.content[0].text;
      expect(text).toContain("Welcome back, user42");
      expect(text).toContain("1,234");
      expect(text).toContain("Items");
      // Chrome elements are out.
      expect(text).not.toMatch(/Home\s+Reports\s+Settings/);
      expect(text).not.toContain("Copyright 2025");
    },
    60_000,
  );

  it(
    "a11ySnapshot returns a compacted tree with form controls",
    async () => {
      const info = await manager.openTab(formUrl);
      const raw = await manager.a11ySnapshot({ tabId: info.tab_id, interestingOnly: true });
      expect(raw).not.toBeNull();
      const compact = filterCompact(raw!);
      expect(compact).not.toBeNull();

      const flat = JSON.stringify(compact);
      expect(flat).toContain("textbox");
      expect(flat).toContain("checkbox");
      expect(flat).toContain("button");
      // Heading and form landmarks survive compact filtering.
      expect(flat).toContain("heading");
    },
    60_000,
  );

  it(
    "diffSnapshots detects a new listitem after clicking Add",
    async () => {
      const info = await manager.openTab(dashboardUrl);
      const before = await manager.a11ySnapshot({ tabId: info.tab_id, interestingOnly: true });
      const beforeCompact = filterCompact(before!)!;

      await manager.click("Add", "role", info.tab_id, { role: "button" });

      const after = await manager.a11ySnapshot({ tabId: info.tab_id, interestingOnly: true });
      const afterCompact = filterCompact(after!)!;

      const d = diffSnapshots(beforeCompact, afterCompact);
      // The new listitem "pay bills" is what we care about.
      const newItem = d.added.find((s) => s.includes("pay bills"));
      expect(newItem).toBeDefined();
    },
    60_000,
  );

  it(
    "click + type modifies textbox value (visible in next snapshot)",
    async () => {
      const info = await manager.openTab(formUrl);

      await manager.click("Email", "label", info.tab_id);
      // type(selector, text, submit, tabId?, targetType?, opts?)
      await manager.type("Email", "a@b.co", false, info.tab_id, "label");

      const snap = await manager.a11ySnapshot({ tabId: info.tab_id, interestingOnly: true });
      expect(snap).not.toBeNull();
      // The textbox labelled "Email" should now have the value we typed,
      // somewhere in the tree. Look for a role=textbox node with matching value.
      const flat = JSON.stringify(snap);
      expect(flat).toContain("a@b.co");
    },
    60_000,
  );

  it(
    "reload() returns a new page state without error",
    async () => {
      const info = await manager.openTab(articleUrl);
      const after = await manager.reload(info.tab_id);
      expect(after.title).toBe("Sample Post");
    },
    60_000,
  );
});
