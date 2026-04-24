import { z } from "zod";
import type { BrowserManager, LocatorType } from "../browser.js";
import { resolveLocator } from "../browser.js";

const LOCATOR_TYPES = ["text", "role", "label", "placeholder", "testid", "selector"] as const;

export const expectSchema = {
  assertion: z.enum([
    "visible", "hidden", "enabled", "disabled",
    "text_equals", "text_contains", "text_matches",
    "value_equals",
    "count",
    "url_matches", "url_equals",
    "title_matches", "title_equals",
  ]).describe(
    "What to assert. Element state: visible|hidden|enabled|disabled. " +
    "Text: text_equals|text_contains|text_matches (regex). Form: value_equals. " +
    "Count: number of matching elements. Page: url_*, title_*.",
  ),
  target: z.string().max(2_048).optional()
    .describe("Element target. Required for all element/text/count assertions; ignored for url_* and title_*."),
  target_type: z.enum(LOCATOR_TYPES).default("selector")
    .describe("Locator strategy for `target`."),
  role: z.string().optional().describe("ARIA role when target_type='role'."),
  exact: z.boolean().default(false).describe("Exact match for text/role/label/placeholder locators."),
  expected: z.union([z.string().max(4_096), z.number()]).optional()
    .describe(
      "Expected value. Required for text_*/value_*/count/url_*/title_* assertions. " +
      "For count it must be a number; for *_matches it's a regex string.",
    ),
  timeout_ms: z.number().int().positive().max(60_000).default(5_000)
    .describe("How long to retry the assertion before failing."),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab."),
};

type ExpectArgs = {
  assertion:
    | "visible" | "hidden" | "enabled" | "disabled"
    | "text_equals" | "text_contains" | "text_matches"
    | "value_equals"
    | "count"
    | "url_matches" | "url_equals"
    | "title_matches" | "title_equals";
  target?: string;
  target_type: LocatorType;
  role?: string;
  exact?: boolean;
  expected?: string | number;
  timeout_ms?: number;
  tab_id?: string;
};

export function makeExpectHandler(browser: BrowserManager) {
  return async (args: ExpectArgs) => {
    const timeout = args.timeout_ms ?? 5_000;
    const page = browser.getPage(args.tab_id);

    const start = Date.now();
    let lastActual: string | number | undefined;
    let lastErr: string | undefined;

    while (Date.now() - start < timeout) {
      try {
        const res = await checkOnce(args);
        if (res.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `PASS ${args.assertion}${res.detail ? ` — ${res.detail}` : ""}`,
              },
            ],
          };
        }
        lastActual = res.actual;
        lastErr = res.detail;
      } catch (e) {
        lastErr = (e as Error).message;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    const body =
      `FAIL ${args.assertion}` +
      (args.expected !== undefined ? ` expected=${JSON.stringify(args.expected)}` : "") +
      (lastActual !== undefined ? ` actual=${JSON.stringify(lastActual)}` : "") +
      (lastErr ? `\n  ${lastErr}` : "") +
      `\n  (retried for ${timeout}ms)`;
    return { isError: true, content: [{ type: "text" as const, text: body }] };

    async function checkOnce(a: ExpectArgs): Promise<{ ok: boolean; actual?: string | number; detail?: string }> {
      switch (a.assertion) {
        case "visible":
        case "hidden":
        case "enabled":
        case "disabled": {
          if (!a.target) return { ok: false, detail: "target required" };
          const loc = resolveLocator(page, a.target, a.target_type, { role: a.role, exact: a.exact }).first();
          const count = await loc.count();
          if (count === 0) {
            const want = a.assertion === "hidden";
            return { ok: want, actual: 0, detail: want ? "no match" : "not found" };
          }
          const v = await loc.isVisible();
          const e = await loc.isEnabled().catch(() => true);
          if (a.assertion === "visible") return { ok: v, actual: v ? "visible" : "hidden" };
          if (a.assertion === "hidden") return { ok: !v, actual: v ? "visible" : "hidden" };
          if (a.assertion === "enabled") return { ok: e, actual: e ? "enabled" : "disabled" };
          return { ok: !e, actual: e ? "enabled" : "disabled" };
        }
        case "text_equals":
        case "text_contains":
        case "text_matches": {
          if (!a.target || a.expected === undefined) return { ok: false, detail: "target + expected required" };
          const loc = resolveLocator(page, a.target, a.target_type, { role: a.role, exact: a.exact }).first();
          const text = (await loc.innerText()).trim();
          const exp = String(a.expected);
          if (a.assertion === "text_equals") return { ok: text === exp, actual: text };
          if (a.assertion === "text_contains") return { ok: text.includes(exp), actual: text };
          try {
            return { ok: new RegExp(exp).test(text), actual: text };
          } catch (e) {
            return { ok: false, detail: `bad regex: ${(e as Error).message}` };
          }
        }
        case "value_equals": {
          if (!a.target || a.expected === undefined) return { ok: false, detail: "target + expected required" };
          const loc = resolveLocator(page, a.target, a.target_type, { role: a.role, exact: a.exact }).first();
          const v = await loc.inputValue();
          return { ok: v === String(a.expected), actual: v };
        }
        case "count": {
          if (!a.target || a.expected === undefined) return { ok: false, detail: "target + expected required" };
          const loc = resolveLocator(page, a.target, a.target_type, { role: a.role, exact: a.exact });
          const n = await loc.count();
          return { ok: n === Number(a.expected), actual: n };
        }
        case "url_equals":
        case "url_matches": {
          if (a.expected === undefined) return { ok: false, detail: "expected required" };
          const url = page.url();
          if (a.assertion === "url_equals") return { ok: url === String(a.expected), actual: url };
          try {
            return { ok: new RegExp(String(a.expected)).test(url), actual: url };
          } catch (e) {
            return { ok: false, detail: `bad regex: ${(e as Error).message}` };
          }
        }
        case "title_equals":
        case "title_matches": {
          if (a.expected === undefined) return { ok: false, detail: "expected required" };
          const t = await page.title();
          if (a.assertion === "title_equals") return { ok: t === String(a.expected), actual: t };
          try {
            return { ok: new RegExp(String(a.expected)).test(t), actual: t };
          } catch (e) {
            return { ok: false, detail: `bad regex: ${(e as Error).message}` };
          }
        }
      }
    }
  };
}
