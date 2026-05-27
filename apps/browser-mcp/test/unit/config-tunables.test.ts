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
