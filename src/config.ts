import { Command } from "commander";

const pkg = { name: "browser-mcp", version: "0.2.0" };

const program = new Command()
  .name(pkg.name)
  .version(pkg.version)
  .description("MCP server that browses websites via a local Playwright-driven Chromium.")
  .option("-p, --port <number>", "HTTP port")
  .option("-H, --host <address>", "Bind address")
  .option("--headless", "Run in headless mode (default)")
  .option("--no-headless", "Run in visible mode")
  .option("--stealth", "Enable stealth plugin (default)")
  .option("--no-stealth", "Disable stealth plugin")
  .option("--channel <name>", "Chromium channel (chrome, msedge, etc.)")
  .option("--proxy <url>", "Proxy server URL")
  .option("--proxy-bypass <domains>", "Comma-separated domains to bypass proxy")
  .option("--proxy-username <user>", "Proxy auth username")
  .option("--proxy-password <pass>", "Proxy auth password")
  .option("--max-chars <number>", "Max characters returned by browser_read")
  .option("--max-html-bytes <number>", "Cap raw HTML size before parsing")
  .option("--tab-ttl <seconds>", "Auto-close inactive tabs after N seconds")
  .option("--settle-ms <ms>", "Quiet-window duration for request-counting settle")
  .option("--settle-timeout-ms <ms>", "Hard timeout for settle after navigation/click")
  .option("--session-ttl <seconds>", "Session TTL in seconds")
  .option("--profile-dir <path>", "Base directory for browser profiles")
  .option("--viewport <WxH>", "Default viewport size, e.g. 1920x1080 (default: 1280x900)")
  .option("--user-agent <string>", "Default User-Agent string")
  .option("--locale <lang>", "Default Accept-Language locale, e.g. en-US")
  .option("--color-scheme <mode>", "Default color scheme: light, dark, no-preference")
  .option("--device-scale-factor <number>", "Device pixel ratio, e.g. 2 for retina (default: 1)")
  .option("--mobile", "Enable mobile emulation (isMobile + hasTouch)")
  .option("--no-mobile", "Disable mobile emulation (default)")
  .option("--javascript", "Enable JavaScript (default)")
  .option("--no-javascript", "Disable JavaScript")
  .option("--api-key <key>", "API key for authentication (Bearer token). If set, all requests must include Authorization header")
  .option("--allow-insecure", "Allow binding to a non-loopback host without an API key. Off by default — browser-mcp refuses to start in that configuration because /mcp can automate a real browser on behalf of anyone who can reach it.")
  .option("--cors-origin <value>", "Allowed CORS Origin. Comma-separated exact origins, or '*' to disable origin checking. Defaults to 'null' — only requests without an Origin header (curl, native MCP clients) are allowed.")
  .option("--max-sessions <number>", "Hard cap on concurrent MCP sessions");

// Under vitest, process.argv contains the runner's flags (--run, --reporter, etc.)
// which commander would reject. Tests exercise config via env vars anyway, so we
// skip CLI parsing in that environment. In production the CLI always parses.
if (!process.env.VITEST) program.parse();

const opts = program.opts();

/** Pick the first defined string among CLI arg, env var, fallback. Exported for tests. */
export function str(cli: string | undefined, env: string | undefined, fallback: string): string {
  return cli ?? env ?? fallback;
}

/**
 * Pick the first parsable number among CLI arg, env var, fallback. Exported
 * for tests. Both CLI and env are treated as strings (commander always gives
 * strings); NaN inputs fall through to the next source.
 */
export function num(cli: string | undefined, env: string | undefined, fallback: number): number {
  if (cli !== undefined) { const n = Number(cli); if (!Number.isNaN(n)) return n; }
  if (env !== undefined) { const n = Number(env); if (!Number.isNaN(n)) return n; }
  return fallback;
}

/**
 * Boolean from CLI (already parsed by commander), env ("0" = false, anything
 * else = true), or fallback. Exported for tests.
 */
export function bool(cli: boolean | undefined, env: string | undefined, fallback: boolean): boolean {
  if (cli !== undefined) return cli;
  if (env !== undefined) return env !== "0";
  return fallback;
}

/**
 * Parse a WxH viewport string (e.g. "1920x1080"). Returns undefined for
 * missing or malformed input. Exported for tests.
 */
export function parseViewport(raw: string | undefined): { width: number; height: number } | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^(\d+)x(\d+)$/i);
  if (!m) return undefined;
  return { width: Number(m[1]), height: Number(m[2]) };
}

const DEFAULT_VIEWPORT = { width: 1280, height: 900 };

const cliViewport = parseViewport(opts.viewport);
const envViewport = parseViewport(process.env.BROWSER_MCP_VIEWPORT ?? undefined);

export const config = {
  port: num(opts.port, process.env.BROWSER_MCP_PORT, 7777),
  host: str(opts.host, process.env.BROWSER_MCP_HOST, "127.0.0.1"),

  headless: bool(opts.headless, process.env.BROWSER_MCP_HEADLESS, true),
  stealth: bool(opts.stealth, process.env.BROWSER_MCP_STEALTH, true),
  channel: str(opts.channel, process.env.BROWSER_MCP_CHANNEL, "chrome"),
  javaScript: bool(opts.javascript, process.env.BROWSER_MCP_JAVASCRIPT, true),

  proxy: str(opts.proxy, process.env.BROWSER_MCP_PROXY, ""),
  proxyBypass: str(opts.proxyBypass, process.env.BROWSER_MCP_PROXY_BYPASS, ""),
  proxyUsername: str(opts.proxyUsername, process.env.BROWSER_MCP_PROXY_USERNAME, ""),
  proxyPassword: str(opts.proxyPassword, process.env.BROWSER_MCP_PROXY_PASSWORD, ""),

  maxChars: num(opts.maxChars, process.env.BROWSER_MCP_MAX_CHARS, 50_000),
  maxHtmlBytes: num(opts.maxHtmlBytes, process.env.BROWSER_MCP_MAX_HTML_BYTES, 10_000_000),
  tabTtlSec: num(opts.tabTtl, process.env.BROWSER_MCP_TAB_TTL_SEC, 600),
  settleMs: num(opts.settleMs, process.env.BROWSER_MCP_SETTLE_MS, 500),
  settleTimeoutMs: num(opts.settleTimeoutMs, process.env.BROWSER_MCP_SETTLE_TIMEOUT_MS, 3_000),
  sessionTtlSec: num(opts.sessionTtl, process.env.BROWSER_MCP_SESSION_TTL_SEC, 1800),

  profileDir: str(opts.profileDir, process.env.BROWSER_MCP_PROFILE_DIR, ""),
  viewport: cliViewport ?? envViewport ?? DEFAULT_VIEWPORT,
  userAgent: str(opts.userAgent, process.env.BROWSER_MCP_USER_AGENT, ""),
  locale: str(opts.locale, process.env.BROWSER_MCP_LOCALE, ""),
  colorScheme: str(opts.colorScheme, process.env.BROWSER_MCP_COLOR_SCHEME, "") as
    | "light" | "dark" | "no-preference" | "",
  deviceScaleFactor: num(opts.deviceScaleFactor, process.env.BROWSER_MCP_DEVICE_SCALE_FACTOR, 1),
  mobile: bool(opts.mobile, process.env.BROWSER_MCP_MOBILE, false),
  apiKey: str(opts.apiKey, process.env.BROWSER_MCP_API_KEY, ""),
  allowInsecure: bool(opts.allowInsecure, process.env.BROWSER_MCP_ALLOW_INSECURE, false),
  corsOrigin: str(opts.corsOrigin, process.env.BROWSER_MCP_CORS_ORIGIN, "null"),
  maxSessions: num(opts.maxSessions, process.env.BROWSER_MCP_MAX_SESSIONS, 50),
} as const;
