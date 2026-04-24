import { homedir } from "node:os";
import { resolve as resolvePath, relative as relativePath, sep } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Filesystem sandbox for tools that write (browser_save, browser_download_wait)
 * or read (browser_upload) user-supplied paths. Without this, a malicious
 * MCP client / prompt-injected agent can write arbitrary files (overwriting
 * ~/.ssh/authorized_keys, ~/.zshrc, cron files, Claude config) or exfiltrate
 * any readable file by uploading it to an attacker page.
 *
 * Default sandbox:
 *   downloads → ~/.browser-mcp/downloads/<profile>/
 *   uploads   → ~/.browser-mcp/uploads/<profile>/
 *
 * Opt-in escape hatches (env, 0|1):
 *   BROWSER_MCP_ALLOW_ANY_WRITE_PATH  — permit save/download to any path
 *   BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH — permit upload from any path
 *
 * The base dir is also overridable:
 *   BROWSER_MCP_SANDBOX_DIR — defaults to ~/.browser-mcp
 */

function isOptIn(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v !== "0" && v !== "";
}

function sandboxBase(): string {
  return process.env.BROWSER_MCP_SANDBOX_DIR || `${homedir()}/.browser-mcp`;
}

export function downloadSandbox(profileName: string): string {
  return resolvePath(sandboxBase(), "downloads", profileName || "default");
}

export function uploadSandbox(profileName: string): string {
  return resolvePath(sandboxBase(), "uploads", profileName || "default");
}

/** True when `child` is equal to or lives under `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = relativePath(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !resolvePath(rel).startsWith(".."));
}

/**
 * Resolve `path` for a write operation, ensuring it lands inside the profile's
 * download sandbox unless the caller has opted into any-path writes.
 * Creates parent directories under the sandbox if needed.
 */
export function resolveWritePath(
  path: string,
  profileName: string,
  optInEnv = "BROWSER_MCP_ALLOW_ANY_WRITE_PATH",
): string {
  if (isOptIn(optInEnv)) return resolvePath(path);

  const sandbox = downloadSandbox(profileName);
  mkdirSync(sandbox, { recursive: true });
  // Relative paths resolve against the sandbox (user-friendly for "save.pdf").
  const absPath = resolvePath(sandbox, path);
  if (!isInside(sandbox, absPath)) {
    throw new Error(
      `path '${path}' escapes the download sandbox (${sandbox}). ` +
      `Set BROWSER_MCP_ALLOW_ANY_WRITE_PATH=1 to write outside the sandbox, ` +
      `or pass a relative path / path under the sandbox.`,
    );
  }
  return absPath;
}

/**
 * Resolve `path` for a read operation (upload), ensuring it lives inside the
 * profile's upload sandbox unless the caller has opted into any-path reads.
 * Relative paths are treated as relative to the sandbox for consistency
 * with resolveWritePath.
 */
export function resolveReadPath(path: string, profileName: string): string {
  if (isOptIn("BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH")) return resolvePath(path);

  const sandbox = uploadSandbox(profileName);
  mkdirSync(sandbox, { recursive: true });
  const absPath = resolvePath(sandbox, path);
  if (!isInside(sandbox, absPath)) {
    throw new Error(
      `upload path '${path}' escapes the upload sandbox (${sandbox}). ` +
      `Drop the file into the sandbox first, or set ` +
      `BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH=1 to upload arbitrary paths.`,
    );
  }
  return absPath;
}
