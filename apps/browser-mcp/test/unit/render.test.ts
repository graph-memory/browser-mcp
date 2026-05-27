import { describe, it, expect } from "vitest";
import {
  htmlToMarkdown,
  stripCompactHtml,
  stripCompactText,
  stripCompactDom,
  truncate,
  DEFAULT_MAX_CHARS,
  COMPACT_STRIP_SELECTORS,
} from "../../src/render.js";
import { JSDOM } from "jsdom";

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    expect(truncate("hello", 100)).toBe("hello");
  });

  it("cuts at max with a truncation notice", () => {
    const result = truncate("abcdefghij", 5);
    expect(result).toContain("abcde");
    expect(result).toContain("[...truncated, 5 more chars]");
  });

  it("uses default max when not provided", () => {
    const huge = "x".repeat(DEFAULT_MAX_CHARS + 100);
    const result = truncate(huge);
    expect(result.length).toBeLessThan(huge.length);
    expect(result).toContain("[...truncated");
  });
});

const DASHBOARD_HTML = `<!doctype html><html><body>
<header><h1>Site</h1></header>
<nav>Home About Contact</nav>
<aside>Ads</aside>
<main><div>Welcome</div><div>Metric: <b>42</b></div></main>
<footer>© 2025</footer>
<div role="navigation">second nav</div>
<div aria-hidden="true">hidden</div>
<svg><path/></svg>
<iframe src="https://ads.example/"></iframe>
<script>alert(1)</script>
<style>body{color:red}</style>
</body></html>`;

const ARTICLE_HTML = `<!doctype html><html><head><title>Post</title></head><body>
<nav>X Y Z</nav>
<main><article>
  <h1>Title</h1>
  <p>First paragraph of the article with enough substance to make Readability pick it up. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.</p>
  <p>Second paragraph with more <b>interesting</b> content. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
</article></main>
<footer>bye</footer>
</body></html>`;

describe("stripCompactHtml", () => {
  it("removes navigation chrome", () => {
    const out = stripCompactHtml(DASHBOARD_HTML, "https://example.com");
    expect(out).not.toContain("Home About Contact");
    expect(out).not.toContain("© 2025");
    expect(out).not.toContain("Ads");
    expect(out).not.toContain("second nav");
    expect(out).not.toContain("hidden");
  });

  it("keeps main content", () => {
    const out = stripCompactHtml(DASHBOARD_HTML, "https://example.com");
    expect(out).toContain("Welcome");
    expect(out).toContain("Metric");
    expect(out).toContain("42");
  });

  it("removes scripts and styles", () => {
    const out = stripCompactHtml(DASHBOARD_HTML, "https://example.com");
    expect(out).not.toContain("alert(1)");
    expect(out).not.toContain("color:red");
  });

  it("removes iframes and svgs", () => {
    const out = stripCompactHtml(DASHBOARD_HTML, "https://example.com");
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("<svg");
  });
});

describe("stripCompactText", () => {
  it("extracts plain text without chrome", () => {
    const out = stripCompactText(DASHBOARD_HTML, "https://example.com");
    expect(out).toContain("Welcome");
    expect(out).toContain("Metric");
    expect(out).not.toContain("Home About");
    expect(out).not.toContain("© 2025");
    expect(out).not.toContain("alert(1)");
  });

  it("collapses excessive whitespace", () => {
    const html = "<html><body><p>a     b\t\tc</p></body></html>";
    const out = stripCompactText(html, "https://example.com");
    expect(out).toBe("a b c");
  });

  it("preserves paragraph breaks between block elements", () => {
    const html = "<html><body><p>one</p><p>two</p><p>three</p></body></html>";
    const out = stripCompactText(html, "https://example.com");
    const paragraphs = out.split(/\n\n/).map((s) => s.trim()).filter(Boolean);
    expect(paragraphs).toEqual(["one", "two", "three"]);
  });
});

describe("stripCompactDom", () => {
  it("mutates the document in place", () => {
    const dom = new JSDOM("<body><nav>x</nav><main>keep</main><footer>bye</footer></body>");
    stripCompactDom(dom.window.document);
    expect(dom.window.document.body.innerHTML).toContain("keep");
    expect(dom.window.document.body.innerHTML).not.toContain("<nav>");
    expect(dom.window.document.body.innerHTML).not.toContain("<footer>");
  });
});

describe("htmlToMarkdown", () => {
  it("extracts article content via Readability", () => {
    const md = htmlToMarkdown(ARTICLE_HTML, "https://example.com");
    expect(md).toContain("Title");
    expect(md).toContain("First paragraph");
    expect(md).toContain("Second paragraph");
    expect(md).toContain("**interesting**");
  });

  it("falls back to plain text when Readability returns too little", () => {
    const tiny = "<html><body><div>tiny</div></body></html>";
    const md = htmlToMarkdown(tiny, "https://example.com", 5000, "longer plain text fallback here that should be used");
    expect(md).toContain("longer plain text fallback");
  });

  it("truncates output to max_chars", () => {
    const long = "<html><body><article>" + "<p>Paragraph with content.</p>".repeat(500) + "</article></body></html>";
    const md = htmlToMarkdown(long, "https://example.com", 200);
    expect(md.length).toBeLessThanOrEqual(200 + 100); // +margin for truncation notice
    expect(md).toContain("[...truncated");
  });

  it("respects compact flag on non-article pages", () => {
    // On a dashboard, compact should strip nav even if Readability would have
    // kept it as part of the body.
    const md = htmlToMarkdown(DASHBOARD_HTML, "https://example.com", 5000, undefined, true);
    expect(md).toContain("Welcome");
    expect(md).not.toContain("Home About Contact");
  });

  it("warns when HTML exceeds MAX_HTML_BYTES", () => {
    // Synthesize a huge blob. MAX_HTML_BYTES default is 10_000_000.
    const huge = "<html><body>" + "x".repeat(11_000_000) + "</body></html>";
    const md = htmlToMarkdown(huge, "https://example.com", 100);
    expect(md).toContain("page exceeded 10 MB");
  });
});

describe("COMPACT_STRIP_SELECTORS", () => {
  it("covers the documented selector set", () => {
    // Guard against accidental removal — if someone drops a selector, this
    // test will flag it and force an intentional change.
    const required = ["script", "nav", "footer", "[aria-hidden=true]", "iframe"];
    for (const sel of required) {
      expect(COMPACT_STRIP_SELECTORS).toContain(sel);
    }
  });
});
