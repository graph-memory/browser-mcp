import { describe, it, expect, vi, afterEach } from "vitest";

// config.ts reads process.env at import time and builds a frozen `config`
// object. To assert env wiring we stub the env, reset the module registry, and
// re-import so the top-level code re-evaluates against the stubbed values.
// (Under VITEST, config.ts skips commander parsing, so values come purely from
// env ?? fallback.)
async function freshConfig(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return (await import("../../src/config.js")).config;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("tunable config — action/nav timeouts (Tier 1)", () => {
  it("defaults: action 10000ms, nav 30000ms", async () => {
    const config = await freshConfig({});
    expect(config.actionTimeoutMs).toBe(10_000);
    expect(config.navTimeoutMs).toBe(30_000);
  });

  it("env overrides are picked up", async () => {
    const config = await freshConfig({
      BROWSER_MCP_ACTION_TIMEOUT_MS: "2500",
      BROWSER_MCP_NAV_TIMEOUT_MS: "60000",
    });
    expect(config.actionTimeoutMs).toBe(2_500);
    expect(config.navTimeoutMs).toBe(60_000);
  });

  it("non-numeric env falls back to the default", async () => {
    const config = await freshConfig({ BROWSER_MCP_ACTION_TIMEOUT_MS: "soon" });
    expect(config.actionTimeoutMs).toBe(10_000);
  });
});

describe("tunable config — ring capacities (Tier 2)", () => {
  it("defaults: net 500, console 500, body 50, bodyMaxBytes 256KiB", async () => {
    const config = await freshConfig({});
    expect(config.netRingCap).toBe(500);
    expect(config.consoleRingCap).toBe(500);
    expect(config.bodyRingCap).toBe(50);
    expect(config.bodyMaxBytes).toBe(256 * 1024);
  });

  it("env overrides are picked up", async () => {
    const config = await freshConfig({
      BROWSER_MCP_NET_RING: "1000",
      BROWSER_MCP_CONSOLE_RING: "20",
      BROWSER_MCP_BODY_RING: "10",
      BROWSER_MCP_BODY_MAX_BYTES: "65536",
    });
    expect(config.netRingCap).toBe(1_000);
    expect(config.consoleRingCap).toBe(20);
    expect(config.bodyRingCap).toBe(10);
    expect(config.bodyMaxBytes).toBe(65_536);
  });

  it("CONSOLE_RING env actually bounds the console ring end-to-end", async () => {
    type Pushable = { pushConsole(e: { ts: number; tab_id: string; level: "log"; text: string }): void };
    vi.stubEnv("BROWSER_MCP_CONSOLE_RING", "3");
    vi.resetModules(); // force browser.js (and its config import) to re-evaluate against the stub
    const { BrowserManager } = await import("../../src/browser.js");
    const m = new BrowserManager("ringcap-test") as unknown as InstanceType<typeof BrowserManager> & Pushable;
    for (let i = 0; i < 5; i++) m.pushConsole({ ts: i, tab_id: "t", level: "log", text: `m${i}` });
    const r = m.readConsoleLog({});
    expect(r.total).toBe(3);
    expect(r.entries.map((e) => e.text)).toEqual(["m2", "m3", "m4"]);
  });
});
