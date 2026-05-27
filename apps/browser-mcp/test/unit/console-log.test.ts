import { describe, it, expect } from "vitest";
import { BrowserManager, type ConsoleLogEntry } from "../../src/browser.js";

// pushConsole is private; drive it via a cast and read back through the public
// readConsoleLog — same code path as the real page hooks, no browser needed.
type WithPush = { pushConsole(e: ConsoleLogEntry): void };

function mk(i: number, o: Partial<ConsoleLogEntry> = {}): ConsoleLogEntry {
  return { ts: 1_000 + i, tab_id: "t1", level: "log", text: `msg ${i}`, ...o };
}
function mgr(): BrowserManager & WithPush {
  return new BrowserManager("console-test") as unknown as BrowserManager & WithPush;
}

describe("console ring buffer", () => {
  it("returns [] when empty", () => {
    const m = mgr();
    expect(m.readConsoleLog({}).entries).toEqual([]);
    expect(m.readConsoleLog({}).total).toBe(0);
  });

  it("keeps insertion order below capacity", () => {
    const m = mgr();
    for (let i = 0; i < 4; i++) m.pushConsole(mk(i));
    expect(m.readConsoleLog({}).entries.map((e) => e.text)).toEqual(["msg 0", "msg 1", "msg 2", "msg 3"]);
  });

  it("preserves chronological order after wrapping (cap 500)", () => {
    const m = mgr();
    const CAP = 500;
    for (let i = 0; i < CAP + 10; i++) m.pushConsole(mk(i));
    const r = m.readConsoleLog({ limit: CAP + 50 });
    expect(r.total).toBe(CAP);
    expect(r.entries[0].text).toBe("msg 10");
    expect(r.entries[r.entries.length - 1].text).toBe(`msg ${CAP + 9}`);
  });

  it("filters by tab_id", () => {
    const m = mgr();
    m.pushConsole(mk(1, { tab_id: "A" }));
    m.pushConsole(mk(2, { tab_id: "B" }));
    expect(m.readConsoleLog({ tabId: "A" }).entries).toHaveLength(1);
  });

  it("filters by level", () => {
    const m = mgr();
    m.pushConsole(mk(1, { level: "log" }));
    m.pushConsole(mk(2, { level: "error" }));
    m.pushConsole(mk(3, { level: "pageerror" }));
    expect(m.readConsoleLog({ level: "error" }).entries).toHaveLength(1);
    expect(m.readConsoleLog({ level: "pageerror" }).entries[0].text).toBe("msg 3");
  });

  it("filters by textRegex", () => {
    const m = mgr();
    m.pushConsole(mk(1, { text: "user logged in" }));
    m.pushConsole(mk(2, { text: "fetch failed 500" }));
    const r = m.readConsoleLog({ textRegex: "failed \\d+" });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].text).toContain("failed");
  });

  it("respects limit (most recent) and defaults to 100", () => {
    const m = mgr();
    for (let i = 0; i < 150; i++) m.pushConsole(mk(i));
    expect(m.readConsoleLog({ limit: 2 }).entries.map((e) => e.text)).toEqual(["msg 148", "msg 149"]);
    expect(m.readConsoleLog({}).entries).toHaveLength(100);
  });
});
