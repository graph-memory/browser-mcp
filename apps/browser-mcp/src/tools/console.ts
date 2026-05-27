import { z } from "zod";
import type { BrowserApi, ConsoleLevel } from "../browser.js";

export const consoleSchema = {
  tab_id: z.string().optional()
    .describe("Only entries from this tab. Omit to see all tabs in the profile."),
  level: z.enum(["log", "info", "warn", "error", "debug", "pageerror"]).optional()
    .describe("Filter by level. 'pageerror' = uncaught exceptions on the page."),
  limit: z.number().int().positive().max(500).default(100)
    .describe("Keep at most this many of the most recent matching entries (printed oldest-first)."),
  text_regex: z.string().max(512).optional()
    .describe("JS regex; only messages whose text matches are returned. Compiled and run on the server — keep it simple."),
};

export function makeConsoleHandler(browser: BrowserApi) {
  return async (args: { tab_id?: string; level?: ConsoleLevel; limit?: number; text_regex?: string }) => {
    let result;
    try {
      result = browser.readConsoleLog({
        tabId: args.tab_id,
        level: args.level,
        limit: args.limit,
        textRegex: args.text_regex,
      });
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: `invalid filter: ${(e as Error).message}` }] };
    }

    if (result.entries.length === 0) {
      return { content: [{ type: "text" as const, text: `(no console entries match; ring has ${result.total} total)` }] };
    }

    const lines: string[] = [`── ${result.entries.length} entries (of ${result.total} in ring) ──`];
    for (const e of result.entries) {
      const t = new Date(e.ts).toISOString().slice(11, 23);
      const loc = e.location ? `  (${e.location})` : "";
      lines.push(`${t}  ${e.level.toUpperCase().padEnd(9)} ${e.text}${loc}`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  };
}
