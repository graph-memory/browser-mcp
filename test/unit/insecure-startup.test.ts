import { describe, it, expect } from "vitest";

/**
 * `insecureStartupProblem` is a pure function that reads config. To exercise
 * its non-null branch we mutate env BEFORE importing, forcing a reload via
 * vi.resetModules so a fresh config singleton is built.
 */
import { vi } from "vitest";

describe("insecureStartupProblem", () => {
  it("returns null when host is loopback (default config)", async () => {
    vi.resetModules();
    delete process.env.BROWSER_MCP_HOST;
    delete process.env.BROWSER_MCP_API_KEY;
    delete process.env.BROWSER_MCP_ALLOW_INSECURE;
    const { insecureStartupProblem } = await import("../../src/app.js");
    expect(insecureStartupProblem()).toBeNull();
  });

  it("returns null when host is non-loopback but apiKey is set", async () => {
    vi.resetModules();
    process.env.BROWSER_MCP_HOST = "0.0.0.0";
    process.env.BROWSER_MCP_API_KEY = "secret";
    delete process.env.BROWSER_MCP_ALLOW_INSECURE;
    const { insecureStartupProblem } = await import("../../src/app.js");
    expect(insecureStartupProblem()).toBeNull();
    delete process.env.BROWSER_MCP_HOST;
    delete process.env.BROWSER_MCP_API_KEY;
  });

  it("returns null when allow-insecure is set", async () => {
    vi.resetModules();
    process.env.BROWSER_MCP_HOST = "0.0.0.0";
    delete process.env.BROWSER_MCP_API_KEY;
    process.env.BROWSER_MCP_ALLOW_INSECURE = "1";
    const { insecureStartupProblem } = await import("../../src/app.js");
    expect(insecureStartupProblem()).toBeNull();
    delete process.env.BROWSER_MCP_HOST;
    delete process.env.BROWSER_MCP_ALLOW_INSECURE;
  });

  it("returns a human-readable message when bound to 0.0.0.0 with no API key and no opt-in", async () => {
    vi.resetModules();
    process.env.BROWSER_MCP_HOST = "0.0.0.0";
    delete process.env.BROWSER_MCP_API_KEY;
    delete process.env.BROWSER_MCP_ALLOW_INSECURE;
    const { insecureStartupProblem } = await import("../../src/app.js");
    const msg = insecureStartupProblem();
    expect(msg).not.toBeNull();
    expect(msg!).toContain("'0.0.0.0'");
    expect(msg!).toContain("RCE");
    delete process.env.BROWSER_MCP_HOST;
  });
});
