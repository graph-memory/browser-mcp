import { isIP } from "node:net";

/**
 * URL safety gate for every tool that navigates a real Chromium tab on the
 * user's machine. Without this, `browser_open("file:///etc/passwd")` +
 * `browser_read` is a 2-call local file read, and HTTP to 169.254.169.254
 * is a free SSRF into cloud metadata / intranet services.
 *
 * Default policy:
 *   - allow http: / https: / about:blank
 *   - reject everything else (file:, data:, javascript:, chrome:, view-source:,
 *     about:!=blank, ftp:, etc.)
 *   - reject private/loopback/link-local IPs
 *
 * Opt-ins (both env vars, 0|1):
 *   - BROWSER_MCP_ALLOW_FILE_URLS       — permit file:// (for local fixtures / tests)
 *   - BROWSER_MCP_ALLOW_PRIVATE_NETWORKS — permit 127./10./172.16–31./192.168./169.254./::1/fc00:
 *
 * These cannot be set via CLI flag on purpose — they're sharp-edge escape
 * hatches meant for automation/test setups, not for day-to-day use.
 */

const ALWAYS_ALLOWED_SCHEMES = new Set(["http:", "https:"]);

function isOptIn(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v !== "0" && v !== "";
}

/** Block RFC1918 + loopback + link-local + ULA. */
function isPrivateHost(host: string): boolean {
  // Strip IPv6 brackets if present, e.g. "[::1]"
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const family = isIP(h);
  if (family === 4) {
    const parts = h.split(".").map((n) => Number(n));
    if (parts[0] === 127) return true;                                  // 127.0.0.0/8
    if (parts[0] === 10) return true;                                   // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;              // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;              // 169.254.0.0/16
    if (parts[0] === 0) return true;                                    // 0.0.0.0/8
    return false;
  }
  if (family === 6) {
    const lower = h.toLowerCase();
    if (lower === "::1") return true;
    if (lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;  // fc00::/7 ULA
    if (lower.startsWith("fe80:")) return true;                         // link-local
    return false;
  }
  // hostname — trust DNS. `localhost` would otherwise be ambiguous; reject explicitly.
  return h === "localhost";
}

/**
 * Throws if the URL is unsafe to navigate the controlled Chromium tab to.
 * Returns the parsed URL on success so callers can reuse it.
 */
export function assertNavigableUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }

  // about:blank is the only about-scheme we allow — useful for "clear the tab".
  if (u.protocol === "about:") {
    if (u.pathname === "blank" || u.href === "about:blank") return u;
    throw new Error(`about: scheme other than about:blank is blocked: ${u.href}`);
  }

  if (u.protocol === "file:") {
    if (isOptIn("BROWSER_MCP_ALLOW_FILE_URLS")) return u;
    throw new Error(
      `file:// URLs are blocked by default. Set BROWSER_MCP_ALLOW_FILE_URLS=1 to permit.`,
    );
  }

  if (!ALWAYS_ALLOWED_SCHEMES.has(u.protocol)) {
    throw new Error(
      `URL scheme '${u.protocol}' is not allowed. Only http:, https:, about:blank are supported by default.`,
    );
  }

  // http(s) — check host isn't a private/loopback/link-local IP.
  if (u.hostname && isPrivateHost(u.hostname)) {
    if (isOptIn("BROWSER_MCP_ALLOW_PRIVATE_NETWORKS")) return u;
    throw new Error(
      `host '${u.hostname}' is a private/loopback/link-local address. Set BROWSER_MCP_ALLOW_PRIVATE_NETWORKS=1 to permit.`,
    );
  }

  return u;
}

/** Lenient variant for `browser_permissions` — accepts http(s) only, no private-IP block. */
export function assertOriginUrl(raw: string): URL {
  const u = assertNavigableUrl(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`permissions origin must be http(s), got ${u.protocol}`);
  }
  return u;
}
