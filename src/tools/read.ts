import { z } from "zod";
import { browser } from "../browser.js";
import { htmlToMarkdown, truncate, DEFAULT_MAX_CHARS } from "../render.js";

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
  tab_id: z.string().optional().describe("Tab to read from; defaults to the active tab"),
};

export async function readHandler({
  mode,
  selector,
  max_chars,
  tab_id,
}: {
  mode: "markdown" | "text" | "html";
  selector?: string;
  max_chars?: number;
  tab_id?: string;
}) {
  const page = browser.getPage(tab_id);
  const max = max_chars ?? DEFAULT_MAX_CHARS;

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
  if (mode === "html") body = truncate(html, max);
  else if (mode === "text") body = truncate(text, max);
  else body = htmlToMarkdown(html, page.url(), max, text);

  return {
    content: [{ type: "text" as const, text: `URL: ${page.url()}\n\n${body}` }],
  };
}
