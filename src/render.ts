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

export function htmlToMarkdown(html: string, url: string, max = DEFAULT_MAX_CHARS): string {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const source = article?.content ?? dom.window.document.body?.innerHTML ?? "";
  const title = article?.title ? `# ${article.title}\n\n` : "";
  const md = title + turndown.turndown(source);
  return truncate(md.trim(), max);
}

export function truncate(text: string, max = DEFAULT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut}\n\n[...truncated, ${text.length - max} more chars]`;
}
