import { z } from "zod";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { BrowserManager, LocatorType } from "../browser.js";
import { resolveLocator } from "../browser.js";
import { assertNavigableUrl } from "../lib/url-safety.js";
import { resolveWritePath } from "../lib/path-sandbox.js";

const LOCATOR_TYPES = ["text", "role", "label", "placeholder", "testid", "selector"] as const;

export const downloadSchema = {
  action: z.enum(["click", "navigate"]).default("click")
    .describe(
      "What to do to trigger the download. 'click' clicks a target element. " +
      "'navigate' points the tab at `url` (e.g. a direct download URL).",
    ),
  target: z.string().max(2_048).optional()
    .describe("For action='click': the button/link that triggers the download."),
  target_type: z.enum(LOCATOR_TYPES).default("text").describe("Locator strategy for `target`."),
  role: z.string().optional().describe("ARIA role when target_type='role'."),
  url: z.string().url().optional()
    .describe("For action='navigate': URL that triggers the download."),
  save_to: z.string().max(4_096)
    .describe(
      "Path (absolute or relative) to save the downloaded file. " +
      "If it ends with '/' or points to an existing directory, the server's suggested filename is used.",
    ),
  timeout_ms: z.number().int().positive().max(600_000).default(60_000)
    .describe("How long to wait for the download to start AND complete."),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};

export function makeDownloadHandler(browser: BrowserManager) {
  return async (args: {
    action: "click" | "navigate";
    target?: string;
    target_type: LocatorType;
    role?: string;
    url?: string;
    save_to: string;
    timeout_ms?: number;
    tab_id?: string;
  }) => {
    const page = browser.getPage(args.tab_id);
    const timeout = args.timeout_ms ?? 60_000;

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout }),
      (async () => {
        if (args.action === "click") {
          if (!args.target) throw new Error("target required for action='click'");
          const loc = resolveLocator(page, args.target, args.target_type, { role: args.role }).first();
          await loc.click({ timeout: 10_000 });
        } else {
          if (!args.url) throw new Error("url required for action='navigate'");
          assertNavigableUrl(args.url);
          // Don't use goto — downloads would never resolve the navigation.
          await page.evaluate((u) => { window.location.href = u; }, args.url);
        }
      })(),
    ]);

    // Sandbox the write path. If save_to ends with '/' use it as the sandbox
    // dir and let the suggested filename land there; otherwise save_to is
    // the full filename (resolved against the download sandbox unless the
    // any-write opt-in is set).
    const endsAsDir = args.save_to.endsWith("/") || args.save_to.endsWith("\\");
    let targetPath: string;
    if (endsAsDir) {
      const suggested = download.suggestedFilename() || "download";
      targetPath = resolveWritePath(`${args.save_to}${suggested}`, browser.profileName);
    } else {
      targetPath = resolveWritePath(args.save_to, browser.profileName);
    }
    try { mkdirSync(dirname(targetPath), { recursive: true }); } catch { /* ignore */ }

    await download.saveAs(targetPath);
    const failure = await download.failure();
    if (failure) {
      return { isError: true, content: [{ type: "text" as const, text: `download failed: ${failure}` }] };
    }

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Downloaded: ${targetPath}\n` +
            `  suggested filename: ${download.suggestedFilename() || "(none)"}\n` +
            `  url: ${download.url()}`,
        },
      ],
    };
  };
}
