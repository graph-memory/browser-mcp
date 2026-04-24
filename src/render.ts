import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { config } from "./config.js";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.remove(["script", "style", "noscript"]);

export const DEFAULT_MAX_CHARS = config.maxChars;

/** Cap raw HTML fed into JSDOM/Readability to avoid OOM on huge pages. */
const MAX_HTML_BYTES = config.maxHtmlBytes;

/**
 * Selectors for "chrome" / non-content regions that compact mode strips.
 * Targets page navigation, banners, ads, and non-rendering/auxiliary elements.
 * Does NOT strip <main>, <article>, or role=main/article — those stay.
 */
export const COMPACT_STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "nav",
  "header",
  "footer",
  "aside",
  "[role=navigation]",
  "[role=banner]",
  "[role=contentinfo]",
  "[role=complementary]",
  "[role=search]",
  "[aria-hidden=true]",
  "[hidden]",
];

/** Remove chrome/navigation/script nodes from a JSDOM document in place. */
export function stripCompactDom(doc: Document): void {
  for (const sel of COMPACT_STRIP_SELECTORS) {
    for (const n of Array.from(doc.querySelectorAll(sel))) n.remove();
  }
}

export function htmlToMarkdown(
  html: string,
  url: string,
  max = DEFAULT_MAX_CHARS,
  plainTextFallback?: string,
  compact = false,
): string {
  const safeHtml = html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html;
  const dom = new JSDOM(safeHtml, { url });
  if (compact) stripCompactDom(dom.window.document);
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

/**
 * Return HTML with compact-mode elements stripped. Used for `mode=html` when
 * `compact=true`. Parses through JSDOM (same pipeline as markdown) and returns
 * the cleaned body innerHTML — or the whole document if there is no body.
 */
export function stripCompactHtml(html: string, url: string): string {
  const safeHtml = html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html;
  const dom = new JSDOM(safeHtml, { url });
  stripCompactDom(dom.window.document);
  return dom.window.document.body?.innerHTML ?? dom.window.document.documentElement?.outerHTML ?? "";
}

/**
 * Best-effort plain-text extraction from HTML after compact stripping.
 * JSDOM has no layout so this uses textContent, collapses whitespace, and
 * preserves paragraph breaks around block-level elements.
 */
export function stripCompactText(html: string, url: string): string {
  const safeHtml = html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html;
  const dom = new JSDOM(safeHtml, { url });
  stripCompactDom(dom.window.document);
  // Insert paragraph breaks before block-level elements so textContent doesn't
  // glue them. `\n\n` so the output has semantic paragraph separators.
  const blockSel = "p,div,br,li,tr,section,article,h1,h2,h3,h4,h5,h6,blockquote,pre";
  for (const el of Array.from(dom.window.document.querySelectorAll(blockSel))) {
    el.insertAdjacentText("beforebegin", "\n\n");
  }
  const raw = dom.window.document.body?.textContent ?? dom.window.document.documentElement?.textContent ?? "";
  return raw
    .replace(/[ \t\f\v]+/g, " ")   // collapse inline whitespace
    .replace(/\n{3,}/g, "\n\n")    // cap blank lines
    .replace(/^ +| +$/gm, "")      // strip line-edge spaces
    .trim();
}

export function truncate(text: string, max = DEFAULT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut}\n\n[...truncated, ${text.length - max} more chars]`;
}
