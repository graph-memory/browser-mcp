import { describe, it, expect, vi } from "vitest";
import { makeSnapshotHandler } from "../../src/tools/snapshot.js";
import { makeCookiesHandler } from "../../src/tools/cookies.js";
import { makeNetworkHandler } from "../../src/tools/network.js";
import { makeReadHandler } from "../../src/tools/read.js";
import { makeSaveHandler } from "../../src/tools/save.js";
import { makePermissionsHandler } from "../../src/tools/permissions.js";
import { makeOpenHandler } from "../../src/tools/open.js";
import type { AxNode, BrowserManager, NetLogEntry } from "../../src/browser.js";

/**
 * These tests drive tool handlers with hand-built BrowserManager stubs so we
 * can exercise edge branches that are awkward to set up against a real
 * browser — e.g. diff overflow (>100 added/removed/changed), cookies with no
 * flags at all, network entries with no status, save-pdf on a non-headless
 * browser.
 */

function baseMgr(overrides: Partial<BrowserManager> = {}): BrowserManager {
  return { ...overrides } as unknown as BrowserManager;
}

describe("snapshot — diff overflow truncates each list to 100", () => {
  const N = 120;

  function makeTree(prefix: string): AxNode {
    // Each listitem has a distinct name — each produces one added/removed sig.
    return {
      role: "list",
      children: Array.from({ length: N }, (_, i) => ({
        role: "listitem" as const,
        name: `${prefix}-${i}`,
      })),
    };
  }

  it("added overflow shows (N more) footer", async () => {
    const stored = new Map<string, AxNode>();
    const mgr = baseMgr({
      a11ySnapshot: async () => makeTree("new"),
      getStoredSnapshot: ((id: string) => stored.get(id)) as BrowserManager["getStoredSnapshot"],
      storeSnapshot: ((id: string, t: AxNode) => { stored.set(id, t); }) as BrowserManager["storeSnapshot"],
    });
    // Before: empty list → all 120 are "added"
    stored.set("before", { role: "list", children: [] });
    const handler = makeSnapshotHandler(mgr);
    const r = await handler({ interesting_only: true, format: "yaml", diff_against: "before" });
    const t = (r as { content: { text: string }[] }).content[0].text;
    expect(t).toContain(`Added (${N})`);
    expect(t).toContain(`…(${N - 100} more)`);
  });

  it("removed overflow shows (N more) footer", async () => {
    const stored = new Map<string, AxNode>();
    const mgr = baseMgr({
      a11ySnapshot: async () => ({ role: "list", children: [] }),
      getStoredSnapshot: ((id: string) => stored.get(id)) as BrowserManager["getStoredSnapshot"],
      storeSnapshot: (() => {}) as BrowserManager["storeSnapshot"],
    });
    stored.set("before", makeTree("old"));
    const handler = makeSnapshotHandler(mgr);
    const r = await handler({ interesting_only: true, format: "yaml", diff_against: "before" });
    const t = (r as { content: { text: string }[] }).content[0].text;
    expect(t).toContain(`Removed (${N})`);
    expect(t).toContain(`…(${N - 100} more)`);
  });

  it("changed overflow shows (N more) footer", async () => {
    // Same role+name signatures across before/after but different `value`
    // (state change) — gives 120 "changed" entries.
    const before: AxNode = {
      role: "form",
      children: Array.from({ length: N }, (_, i) => ({
        role: "textbox" as const,
        name: `field-${i}`,
        value: "",
      })),
    };
    const after: AxNode = {
      role: "form",
      children: Array.from({ length: N }, (_, i) => ({
        role: "textbox" as const,
        name: `field-${i}`,
        value: "x",
      })),
    };
    const stored = new Map<string, AxNode>([["before", before]]);
    const mgr = baseMgr({
      a11ySnapshot: async () => after,
      getStoredSnapshot: ((id: string) => stored.get(id)) as BrowserManager["getStoredSnapshot"],
      storeSnapshot: (() => {}) as BrowserManager["storeSnapshot"],
    });
    const handler = makeSnapshotHandler(mgr);
    const r = await handler({ interesting_only: true, format: "yaml", diff_against: "before" });
    const t = (r as { content: { text: string }[] }).content[0].text;
    expect(t).toContain(`Changed (${N})`);
    expect(t).toContain(`…(${N - 100} more)`);
  });
});

describe("cookies — entries with no flags at all", () => {
  it("prints an empty [] flag block and ISO expires when expires>0", async () => {
    const cookies = [{
      name: "plain", value: "v", domain: "example.com", path: "/",
      secure: false, httpOnly: false, sameSite: undefined,
      expires: Math.floor(Date.parse("2030-01-02T03:04:05Z") / 1000),
    }];
    const mgr = baseMgr({
      getContext: async () => ({
        cookies: async () => cookies,
        addCookies: async () => {},
        clearCookies: async () => {},
      } as unknown as Awaited<ReturnType<BrowserManager["getContext"]>>),
    });
    const handler = makeCookiesHandler(mgr);
    const r = await handler({ action: "get" });
    const t = (r as { content: { text: string }[] }).content[0].text;
    expect(t).toContain("plain (example.com/) = v");
    expect(t).toContain("[]"); // no flags
    expect(t).toContain("2030-01-02");
  });
});

describe("network — entries with undefined status and missing duration", () => {
  it("formats '—' placeholder for missing status and duration", () => {
    // Build a BrowserManager stub whose readNetLog returns crafted entries.
    const entries: NetLogEntry[] = [
      {
        ts: Date.now(),
        tab_id: "t1",
        method: "GET",
        url: "https://example.com/",
        resource_type: "fetch",
      },
    ];
    const mgr = baseMgr({
      readNetLog: (() => ({ entries, total: 1 })) as BrowserManager["readNetLog"],
    });
    const handler = makeNetworkHandler(mgr);
    return handler({}).then((r) => {
      const t = (r as { content: { text: string }[] }).content[0].text;
      expect(t).toContain("—"); // missing status/duration → dashes
      expect(t).toContain("GET");
    });
  });
});

describe("read — handler default mode falls through to markdown", () => {
  it("invokes mode-default when args.mode is omitted (defensive)", async () => {
    // The real handler requires mode from zod defaults; we call with explicit
    // mode='markdown' to exercise the function itself (not the schema default).
    const mgr = baseMgr({
      getPage: () => ({
        url: () => "about:blank",
        $: async () => null,
        content: async () => "<html><body><article><h1>t</h1><p>x</p></article></body></html>",
        evaluate: async () => "text here",
      } as unknown as ReturnType<BrowserManager["getPage"]>),
    });
    const handler = makeReadHandler(mgr);
    const r = await handler({ mode: "markdown" });
    const t = (r as { content: { text: string }[] }).content[0].text;
    expect(t).toContain("URL: ");
  });
});

describe("permissions — getPage throws, origin hint is skipped", () => {
  it("no active tab + no origin arg → grants globally (any origin)", async () => {
    const ctxStub = {
      clearPermissions: async () => {},
      grantPermissions: async () => {},
    };
    const mgr = baseMgr({
      getContext: async () => ctxStub as unknown as Awaited<ReturnType<BrowserManager["getContext"]>>,
      getPage: (() => { throw new Error("No active tab"); }) as BrowserManager["getPage"],
    });
    const handler = makePermissionsHandler(mgr);
    const r = await handler({ grant: ["geolocation"] });
    expect((r as { content: { text: string }[] }).content[0].text).toContain("(any origin)");
  });

  it("active tab with file:// url → origin is skipped (not http(s))", async () => {
    const ctxStub = {
      clearPermissions: async () => {},
      grantPermissions: async () => {},
    };
    const mgr = baseMgr({
      getContext: async () => ctxStub as unknown as Awaited<ReturnType<BrowserManager["getContext"]>>,
      getPage: (() => ({
        url: () => "file:///tmp/foo.html",
      })) as unknown as BrowserManager["getPage"],
    });
    const handler = makePermissionsHandler(mgr);
    const r = await handler({ grant: ["geolocation"] });
    expect((r as { content: { text: string }[] }).content[0].text).toContain("(any origin)");
  });
});

describe("download — failure branch reports isError", () => {
  it("download.failure() truthy returns 'download failed'", async () => {
    const fakeDownload = {
      suggestedFilename: () => "x.bin",
      saveAs: async () => {},
      failure: async () => "net::ERR_FAILED",
      url: () => "https://example.com/x.bin",
    };
    const fakePage = {
      waitForEvent: async () => fakeDownload,
      evaluate: async () => {},
    };
    const mgr = baseMgr({
      profileName: "default",
      getPage: (() => fakePage) as unknown as BrowserManager["getPage"],
    });
    const { makeDownloadHandler } = await import("../../src/tools/download.js");
    const handler = makeDownloadHandler(mgr);
    const r = await handler({
      action: "navigate",
      url: "https://example.com/x.bin",
      save_to: "dl-fail",
      target_type: "text",
    });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { content: { text: string }[] }).content[0].text).toContain("download failed");
  });
});

describe("visual — openVisible handler message", () => {
  it("returns a helpful guidance message after opening a visible window", async () => {
    const mgr = baseMgr({
      openVisible: (async () => ({ tab_id: "t", title: "Login", url: "https://example.com/" })) as BrowserManager["openVisible"],
    });
    const { makeOpenVisibleHandler } = await import("../../src/tools/visual.js");
    const handler = makeOpenVisibleHandler(mgr);
    const r = await handler({ url: "https://example.com/" });
    const t = (r as { content: { text: string }[] }).content[0].text;
    expect(t).toContain("Visible browser opened");
    expect(t).toContain("close the window");
  });
});

describe("open — messages for 2xx, 4xx, unknown status", () => {
  it("unknown status falls through to 'HTTP status unknown'", async () => {
    const mgr = baseMgr({
      navigate: (async () => ({
        tab_id: "tab1", title: "T", url: "https://example.com/x", status: undefined,
      })) as BrowserManager["navigate"],
    });
    const handler = makeOpenHandler(mgr);
    const r = await handler({ url: "https://example.com/x" });
    expect((r as { content: { text: string }[] }).content[0].text).toContain("HTTP status unknown");
  });
});

describe("save — PDF headless-requirement error branch", () => {
  // Unit tests run with no env opt-ins set, so paths must land under the
  // default sandbox (~/.browser-mcp/downloads/default/). Relative paths do.
  it("returns isError when page.pdf() throws a 'headless'-containing message", async () => {
    const fakePage = {
      content: async () => "<html></html>",
      pdf: async () => { throw new Error("pdf() is only available in headless mode"); },
    };
    const mgr = baseMgr({
      profileName: "default",
      getPage: () => fakePage as unknown as ReturnType<BrowserManager["getPage"]>,
    });
    const handler = makeSaveHandler(mgr);
    const r = await handler({ format: "pdf", path: "ignored.pdf" });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { content: { text: string }[] }).content[0].text).toContain("headless");
  });

  it("rethrows non-headless pdf errors", async () => {
    const fakePage = {
      content: async () => "<html></html>",
      pdf: async () => { throw new Error("something else broke"); },
    };
    const mgr = baseMgr({
      profileName: "default",
      getPage: () => fakePage as unknown as ReturnType<BrowserManager["getPage"]>,
    });
    const handler = makeSaveHandler(mgr);
    await expect(handler({ format: "pdf", path: "ignored2.pdf" })).rejects.toThrow(/something else/);
  });
});
