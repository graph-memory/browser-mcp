import { z } from "zod";
import type { BrowserManager } from "../browser.js";
import { config } from "../config.js";
import { truncate } from "../render.js";

export const networkBodySchema = {
  url_regex: z.string().max(512).optional()
    .describe("JS regex; only responses whose URL matches are considered. Compiled and run on the server."),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]).optional()
    .describe("Filter by HTTP method."),
  index: z.number().int().min(0).default(0)
    .describe("Which match to return, counting back from the most recent (0 = latest, 1 = previous, …)."),
};

export function makeNetworkBodyHandler(browser: BrowserManager) {
  return async (args: { url_regex?: string; method?: string; index: number }) => {
    let matches;
    try {
      matches = browser.readNetworkBodies({ urlRegex: args.url_regex, method: args.method });
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: `invalid filter: ${(e as Error).message}` }] };
    }

    if (matches.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: "(no captured response body matches — only small texty/JSON responses are captured, last 50)",
        }],
      };
    }

    const e = matches[matches.length - 1 - args.index];
    if (!e) {
      return { content: [{ type: "text" as const, text: `(index ${args.index} out of range — ${matches.length} match${matches.length === 1 ? "" : "es"})` }] };
    }

    const header = `${e.method} ${e.url}\nstatus: ${e.status ?? "—"}  content-type: ${e.contentType}  (match ${matches.length - args.index}/${matches.length})\n\n`;
    return { content: [{ type: "text" as const, text: truncate(header + e.body, config.maxChars) }] };
  };
}
