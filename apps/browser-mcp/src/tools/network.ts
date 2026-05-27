import { z } from "zod";
import type { BrowserApi } from "../browser.js";
import { config } from "../config.js";

export const networkSchema = {
  tab_id: z.string().optional()
    .describe("Only entries from this tab. Omit to see all tabs in the profile."),
  // Cap follows the network ring capacity (BROWSER_MCP_NET_RING) — can't return
  // more than the ring holds.
  limit: z.number().int().positive().max(config.netRingCap).default(Math.min(100, config.netRingCap))
    .describe("Keep at most this many of the most recent matching entries (printed oldest-first)."),
  url_regex: z.string().max(512).optional()
    .describe("JS regex; only URLs matching are returned. Compiled and run on the server against recent URLs — keep the pattern simple (no need for catastrophic-backtracking constructs)."),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]).optional()
    .describe("Filter by HTTP method."),
  failed_only: z.boolean().default(false)
    .describe("Only return requests that failed (net::ERR_*, blocked, aborted)."),
  min_status: z.number().int().min(100).max(599).optional()
    .describe("Only return responses with status >= this. Use 400 to see errors only."),
};

export function makeNetworkHandler(browser: BrowserApi) {
  return async (args: {
    tab_id?: string;
    limit?: number;
    url_regex?: string;
    method?: string;
    failed_only?: boolean;
    min_status?: number;
  }) => {
    let result;
    try {
      result = browser.readNetLog({
        tabId: args.tab_id,
        limit: args.limit,
        urlRegex: args.url_regex,
        method: args.method,
        failedOnly: args.failed_only,
        minStatus: args.min_status,
      });
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `invalid filter: ${(e as Error).message}` }],
      };
    }

    if (result.entries.length === 0) {
      return {
        content: [{ type: "text" as const, text: `(no network entries match; ring has ${result.total} total)` }],
        data: { entries: result.entries, total: result.total },
      };
    }

    const lines: string[] = [];
    lines.push(`── ${result.entries.length} entries (of ${result.total} in ring) ──`);
    for (const e of result.entries) {
      const t = new Date(e.ts).toISOString().slice(11, 23);
      const status = e.failed
        ? `FAIL(${e.failed})`
        : e.status !== undefined ? String(e.status) : "—";
      const dur = e.duration_ms !== undefined ? `${e.duration_ms}ms` : "—";
      const rt = e.resource_type;
      lines.push(`${t}  ${status.padEnd(10)}  ${e.method.padEnd(7)} ${e.url}  [${rt}, ${dur}]`);
    }
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      data: { entries: result.entries, total: result.total },
    };
  };
}
