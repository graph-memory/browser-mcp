import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Shared bootstrap for integration tests: sets env to force headless, disables
 * stealth plugin, and points the profile directory at a throwaway tmp dir so
 * developers' local ~/.browser-mcp/profiles isn't mutated.
 *
 * Must be called BEFORE any dynamic import of src/browser.js or src/config.js.
 * Each test file gets its own profile via `profileTag`.
 */
export function bootIntegrationEnv(profileTag: string): { profileDir: string; profileName: string } {
  const profileDir = mkdtempSync(join(tmpdir(), `browser-mcp-${profileTag}-`));
  process.env.BROWSER_MCP_PROFILE_DIR = profileDir;
  process.env.BROWSER_MCP_HEADLESS = "1";
  process.env.BROWSER_MCP_STEALTH = "0";
  return { profileDir, profileName: profileTag.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) };
}

export const FIXTURES = resolve(import.meta.dirname, "fixtures");

export function fixtureUrl(name: string): string {
  return pathToFileURL(join(FIXTURES, name)).toString();
}

/** Extract text content from an MCP tool response. Throws if shape is off. */
export function textOf(res: unknown): string {
  const r = res as { content?: Array<{ type?: string; text?: string }> };
  if (!r || !Array.isArray(r.content)) throw new Error("tool response missing content[]");
  const first = r.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("tool response[0] is not a text block");
  }
  return first.text;
}

/** Returns true when the MCP tool response carries isError. */
export function isToolError(res: unknown): boolean {
  return Boolean((res as { isError?: boolean }).isError);
}
