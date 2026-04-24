import { z } from "zod";
import { dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { BrowserManager } from "../browser.js";
import { resolveWritePath } from "../lib/path-sandbox.js";

export const saveSchema = {
  format: z.enum(["pdf", "mhtml", "html"])
    .describe(
      "Output format. 'pdf' — Chromium's native print-to-PDF (headless-only). " +
      "'mhtml' — single-file archive with resources inlined, great for offline review. " +
      "'html' — raw page HTML as-is.",
    ),
  path: z.string().max(4_096)
    .describe(
      "Absolute or relative path where to write the file. Parent directories " +
      "are created automatically. Relative paths resolve against the supervisor's cwd.",
    ),
  full_page: z.boolean().default(false)
    .describe("PDF only: include full scrollable page (true) vs just viewport (default)."),
  landscape: z.boolean().default(false)
    .describe("PDF only: landscape orientation."),
  tab_id: z.string().optional().describe("Tab to save; defaults to the active tab."),
};

export function makeSaveHandler(browser: BrowserManager) {
  return async (args: {
    format: "pdf" | "mhtml" | "html";
    path: string;
    full_page?: boolean;
    landscape?: boolean;
    tab_id?: string;
  }) => {
    const page = browser.getPage(args.tab_id);
    const outPath = resolveWritePath(args.path, browser.profileName);
    try { mkdirSync(dirname(outPath), { recursive: true }); } catch { /* ignore */ }

    if (args.format === "html") {
      const html = await page.content();
      writeFileSync(outPath, html, "utf8");
      const size = Buffer.byteLength(html, "utf8");
      return { content: [{ type: "text" as const, text: `Saved HTML → ${outPath} (${size} bytes)` }] };
    }

    if (args.format === "pdf") {
      // page.pdf() works only in headless Chromium.
      try {
        const buf = await page.pdf({
          path: outPath,
          printBackground: true,
          preferCSSPageSize: true,
          landscape: args.landscape ?? false,
          ...(args.full_page ? {} : { format: "A4" }),
        });
        return {
          content: [{ type: "text" as const, text: `Saved PDF → ${outPath} (${buf.length} bytes)` }],
        };
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("headless")) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `PDF export requires headless mode: ${msg}` }],
          };
        }
        throw e;
      }
    }

    // mhtml via CDP: Page.captureSnapshot returns a MHTML document string.
    const ctx = await browser.getContext();
    const cdp = await ctx.newCDPSession(page);
    try {
      const { data } = await cdp.send("Page.captureSnapshot", { format: "mhtml" });
      writeFileSync(outPath, data, "utf8");
      const size = Buffer.byteLength(data, "utf8");
      return { content: [{ type: "text" as const, text: `Saved MHTML → ${outPath} (${size} bytes)` }] };
    } finally {
      await cdp.detach().catch(() => {});
    }
  };
}
