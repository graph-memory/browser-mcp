import { describe, it, expect } from "vitest";
import { BrowserManager, type NetLogEntry } from "../../src/browser.js";

/**
 * The net log is a ring buffer inside BrowserManager. pushNet is private;
 * tests drive it through a cast and then read back via the public readNetLog.
 * This exercises the same code path as the real page hooks without requiring
 * a browser.
 */

type WithPushNet = { pushNet(e: NetLogEntry): void };

function mkEntry(i: number, overrides: Partial<NetLogEntry> = {}): NetLogEntry {
  return {
    ts: 1_000_000 + i,
    tab_id: "tab1",
    method: "GET",
    url: `https://example.com/path/${i}`,
    resource_type: "document",
    status: 200,
    duration_ms: 10,
    ...overrides,
  };
}

function makeManager(): BrowserManager & WithPushNet {
  return new BrowserManager("netlog-test") as unknown as BrowserManager & WithPushNet;
}

describe("netlog ring buffer", () => {
  it("readNetLog returns [] when nothing has been pushed", () => {
    const m = makeManager();
    const r = m.readNetLog({});
    expect(r.entries).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("records entries in insertion order when below ring capacity", () => {
    const m = makeManager();
    for (let i = 0; i < 5; i++) m.pushNet(mkEntry(i));
    const r = m.readNetLog({});
    expect(r.total).toBe(5);
    expect(r.entries.map((e) => e.url)).toEqual([
      "https://example.com/path/0",
      "https://example.com/path/1",
      "https://example.com/path/2",
      "https://example.com/path/3",
      "https://example.com/path/4",
    ]);
  });

  it("preserves chronological order after wrapping past ring capacity", () => {
    const m = makeManager();
    const CAP = 500; // matches NET_RING_CAP
    for (let i = 0; i < CAP + 20; i++) m.pushNet(mkEntry(i));
    const r = m.readNetLog({ limit: CAP + 50 });
    expect(r.total).toBe(CAP);
    // Oldest 20 were overwritten. First surviving entry is index 20.
    expect(r.entries[0].url).toBe("https://example.com/path/20");
    expect(r.entries[r.entries.length - 1].url).toBe(`https://example.com/path/${CAP + 19}`);
  });

  it("filters by tab_id", () => {
    const m = makeManager();
    m.pushNet(mkEntry(1, { tab_id: "A" }));
    m.pushNet(mkEntry(2, { tab_id: "B" }));
    m.pushNet(mkEntry(3, { tab_id: "A" }));
    const r = m.readNetLog({ tabId: "A" });
    expect(r.entries).toHaveLength(2);
    expect(r.entries.every((e) => e.tab_id === "A")).toBe(true);
  });

  it("filters by method (case-insensitive)", () => {
    const m = makeManager();
    m.pushNet(mkEntry(1, { method: "GET" }));
    m.pushNet(mkEntry(2, { method: "POST" }));
    const r = m.readNetLog({ method: "post" });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].method).toBe("POST");
  });

  it("filters failedOnly", () => {
    const m = makeManager();
    m.pushNet(mkEntry(1));
    m.pushNet(mkEntry(2, { failed: "net::ERR_FAILED" }));
    const r = m.readNetLog({ failedOnly: true });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].failed).toBeDefined();
  });

  it("filters minStatus (missing status treated as 0)", () => {
    const m = makeManager();
    m.pushNet(mkEntry(1, { status: 200 }));
    m.pushNet(mkEntry(2, { status: 404 }));
    m.pushNet(mkEntry(3, { status: 500 }));
    m.pushNet(mkEntry(4, { status: undefined }));
    const r = m.readNetLog({ minStatus: 400 });
    expect(r.entries.map((e) => e.status)).toEqual([404, 500]);
  });

  it("filters urlRegex", () => {
    const m = makeManager();
    m.pushNet(mkEntry(1, { url: "https://api.example.com/users" }));
    m.pushNet(mkEntry(2, { url: "https://cdn.example.com/img.png" }));
    m.pushNet(mkEntry(3, { url: "https://api.example.com/posts" }));
    const r = m.readNetLog({ urlRegex: "/api\\.example\\.com/" });
    expect(r.entries).toHaveLength(2);
  });

  it("respects limit and returns most-recent entries", () => {
    const m = makeManager();
    for (let i = 0; i < 10; i++) m.pushNet(mkEntry(i));
    const r = m.readNetLog({ limit: 3 });
    expect(r.entries).toHaveLength(3);
    expect(r.entries.map((e) => e.url)).toEqual([
      "https://example.com/path/7",
      "https://example.com/path/8",
      "https://example.com/path/9",
    ]);
  });

  it("defaults limit to 100 when not specified", () => {
    const m = makeManager();
    for (let i = 0; i < 150; i++) m.pushNet(mkEntry(i));
    const r = m.readNetLog({});
    expect(r.entries).toHaveLength(100);
    expect(r.total).toBe(150);
  });
});
