import { Command } from "commander";

const pkg = { name: "browser-mcp", version: "0.1.0" };

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
  .parse();

const opts = program.opts();

function str(cli: string | undefined, env: string | undefined, fallback: string): string {
  return cli ?? env ?? fallback;
}

function num(cli: string | undefined, env: string | undefined, fallback: number): number {
  if (cli !== undefined) { const n = Number(cli); if (!Number.isNaN(n)) return n; }
  if (env !== undefined) { const n = Number(env); if (!Number.isNaN(n)) return n; }
  return fallback;
}

function bool(cli: boolean | undefined, env: string | undefined, fallback: boolean): boolean {
  if (cli !== undefined) return cli;
  if (env !== undefined) return env !== "0";
  return fallback;
}

export const config = {
  port: num(opts.port, process.env.BROWSER_MCP_PORT, 7777),
  host: str(opts.host, process.env.BROWSER_MCP_HOST, "127.0.0.1"),

  headless: bool(opts.headless, process.env.BROWSER_MCP_HEADLESS, true),
  stealth: bool(opts.stealth, process.env.BROWSER_MCP_STEALTH, true),
  channel: str(opts.channel, process.env.BROWSER_MCP_CHANNEL, "chrome"),

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
} as const;
