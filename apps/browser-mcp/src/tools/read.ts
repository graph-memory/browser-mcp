import { z } from "zod";
import type { BrowserManager } from "../browser.js";
import {
  htmlToMarkdown,
  stripCompactHtml,
  stripCompactText,
  truncate,
  DEFAULT_MAX_CHARS,
} from "../render.js";

export const readSchema = {
  mode: z
    .enum(["markdown", "text", "html"])
    .default("markdown")
    .describe(
      "markdown: main article via Readability, converted to Markdown (best default). text: body innerText. html: raw HTML of the page or selected element.",
    ),
  selector: z
    .string()
    .optional()
    .describe("CSS selector to narrow extraction to a specific element (outerHTML/innerText of that node)"),
  max_chars: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Cap output length in characters (default: ${DEFAULT_MAX_CHARS})`),
  compact: z
    .boolean()
    .optional()
    .describe(
      "Strip nav / header / footer / aside / script / style / svg / iframe and aria landmark " +
      "chrome (banner, navigation, complementary, contentinfo, search) before rendering. " +
      "Also drops [aria-hidden=true] and [hidden]. Works for all modes — useful for dashboards / " +
      "SPAs where Readability bails out and the raw body is drowned in nav boilerplate. " +
      "Defaults to false for markdown (Readability already handles chrome) and true for text/html.",
    ),
  tab_id: z.string().optional().describe("Tab to read from; defaults to the active tab"),
};

export function makeReadHandler(browser: BrowserManager) {
  return async ({
    mode,
    selector,
    max_chars,
    compact,
    tab_id,
  }: {
    mode: "markdown" | "text" | "html";
    selector?: string;
    max_chars?: number;
    compact?: boolean;
    tab_id?: string;
  }) => {
    const page = browser.getPage(tab_id);
    const max = max_chars ?? DEFAULT_MAX_CHARS;
    // Markdown already funnels through Readability (which extracts main content),
    // so compact defaults off there. For text/html, raw output includes nav/footer,
    // so compact defaults on — matches what humans usually want.
    const doCompact = compact ?? (mode !== "markdown");

    let html: string;
    let text: string;
    if (selector) {
      const el = await page.$(selector);
      if (!el) throw new Error(`Selector not found: ${selector}`);
      ({ html, text } = await el.evaluate((n) => ({
        html: (n as HTMLElement).outerHTML,
        text: (n as HTMLElement).innerText,
      })));
    } else {
      html = await page.content();
      text = await page.evaluate(() => document.body.innerText);
    }

    let body: string;
    if (mode === "html") {
      body = truncate(doCompact ? stripCompactHtml(html, page.url()) : html, max);
    } else if (mode === "text") {
      body = truncate(doCompact ? stripCompactText(html, page.url()) : text, max);
    } else {
      body = htmlToMarkdown(html, page.url(), max, text, doCompact);
    }

    return {
      content: [{ type: "text" as const, text: `URL: ${page.url()}\n\n${body}` }],
    };
  };
}
