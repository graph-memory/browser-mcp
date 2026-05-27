import { z } from "zod";
import type { BrowserManager } from "../browser.js";
import { assertNavigableUrl } from "../lib/url-safety.js";

export const openSchema = {
  url: z.url().describe(
    "Absolute URL to navigate to. http(s) only by default — file://, data:, " +
    "javascript:, and private/loopback IPs are blocked; set BROWSER_MCP_ALLOW_FILE_URLS=1 " +
    "or BROWSER_MCP_ALLOW_PRIVATE_NETWORKS=1 to opt in.",
  ),
  tab_id: z
    .string()
    .optional()
    .describe("If set, navigate this existing tab instead of opening a new one"),
};

export function makeOpenHandler(browser: BrowserManager) {
  return async ({ url, tab_id }: { url: string; tab_id?: string }) => {
    assertNavigableUrl(url);
    const info = await browser.navigate(url, tab_id);
    const statusLine = info.status
      ? `HTTP ${info.status}${info.status >= 400 ? " (error)" : ""}`
      : "HTTP status unknown";
    return {
      content: [
        {
          type: "text" as const,
          text: `${statusLine}\nURL: ${info.url}\nTitle: ${info.title}\nTab: ${info.tab_id}`,
        },
      ],
    };
  };
}
