import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.remove(["script", "style", "noscript"]);

export const DEFAULT_MAX_CHARS = Number(process.env.BROWSER_MCP_MAX_CHARS) || 50_000;

/** Cap raw HTML fed into JSDOM/Readability to avoid OOM on huge pages. */
const MAX_HTML_BYTES = Number(process.env.BROWSER_MCP_MAX_HTML_BYTES) || 10_000_000;

export function htmlToMarkdown(
  html: string,
  url: string,
  max = DEFAULT_MAX_CHARS,
  plainTextFallback?: string,
): string {
  const safeHtml = html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html;
  const dom = new JSDOM(safeHtml, { url });
  const article = new Readability(dom.window.document).parse();
  const source = article?.content ?? "";
  const title = article?.title ? `# ${article.title}\n\n` : "";
  let md = source ? title + turndown.turndown(source) : "";

  // Readability returns empty or near-empty on non-article pages (dashboards, SPAs, etc.)
  if (md.trim().length < 100 && plainTextFallback && plainTextFallback.trim().length > md.trim().length) {
    md = title + plainTextFallback;
  } else if (md.trim().length < 100 && !plainTextFallback) {
    // Last resort: convert raw body HTML via turndown
    const bodyHtml = dom.window.document.body?.innerHTML ?? "";
    if (bodyHtml) md = title + turndown.turndown(bodyHtml);
  }

  const result = truncate(md.trim(), max);
  if (html.length > MAX_HTML_BYTES) {
    return result + "\n\n[warning: HTML was truncated before parsing — page exceeded 10 MB]";
  }
  return result;
}

export function truncate(text: string, max = DEFAULT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut}\n\n[...truncated, ${text.length - max} more chars]`;
}
