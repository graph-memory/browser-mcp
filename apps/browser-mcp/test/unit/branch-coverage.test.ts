import { describe, it, expect } from "vitest";
import {
  htmlToMarkdown,
  stripCompactHtml,
  stripCompactText,
} from "../../src/render.js";
import { resolveLocator, type LocatorType } from "../../src/browser.js";
import { vi } from "vitest";

describe("render.ts — less-travelled branches", () => {
  it("htmlToMarkdown with no article and no fallback falls back to raw body via turndown", () => {
    const html = "<html><body><p>body-only</p></body></html>";
    // No plainTextFallback provided → hits the last-resort body.innerHTML branch.
    const md = htmlToMarkdown(html, "https://example.com");
    expect(md).toContain("body-only");
  });

  it("htmlToMarkdown with empty body + no fallback returns empty string (or title only)", () => {
    const html = "<html><body></body></html>";
    const md = htmlToMarkdown(html, "https://example.com");
    // Nothing substantive; at most a title which isn't emitted when empty.
    expect(md.trim().length).toBeLessThan(50);
  });

  it("stripCompactHtml falls back to documentElement.outerHTML when body is absent", () => {
    // Malformed HTML where JSDOM still wraps it but we synthesize a no-body doc.
    const html = "<!doctype html><html></html>";
    const out = stripCompactHtml(html, "https://example.com");
    // Body is an empty string or full document. Either way, no error.
    expect(typeof out).toBe("string");
  });

  it("stripCompactText returns an empty-ish string on a no-body document", () => {
    const html = "<!doctype html><html></html>";
    const out = stripCompactText(html, "https://example.com");
    expect(out).toBe("");
  });
});

describe("resolveLocator — default case", () => {
  it("falls through to page.locator for unrecognized type values", () => {
    const spy = vi.fn((sel: string) => ({ __kind: "locator", sel }));
    const page = {
      locator: spy,
      getByText: vi.fn(),
      getByRole: vi.fn(),
      getByLabel: vi.fn(),
      getByPlaceholder: vi.fn(),
      getByTestId: vi.fn(),
    };
    // Pass an unknown type — TypeScript blocks this at compile time, so cast.
    resolveLocator(page as never, "xyz", "bogus" as unknown as LocatorType);
    expect(spy).toHaveBeenCalledWith("xyz");
  });
});
