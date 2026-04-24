import { z } from "zod";
import type { BrowserManager, LocatorType } from "../browser.js";

const LOCATOR_TYPES = ["text", "role", "label", "placeholder", "testid", "selector"] as const;

const ROLES = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote",
  "button", "caption", "cell", "checkbox", "code", "columnheader", "combobox",
  "complementary", "contentinfo", "definition", "deletion", "dialog", "directory",
  "document", "emphasis", "feed", "figure", "form", "generic", "grid", "gridcell",
  "group", "heading", "img", "insertion", "link", "list", "listbox", "listitem",
  "log", "main", "marquee", "math", "meter", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "navigation", "none", "note", "option",
  "paragraph", "presentation", "progressbar", "radio", "radiogroup", "region",
  "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator",
  "slider", "spinbutton", "status", "strong", "subscript", "superscript", "switch",
  "tab", "table", "tablist", "tabpanel", "term", "textbox", "time", "timer",
  "toolbar", "tooltip", "tree", "treegrid", "treeitem",
] as const;

export const clickSchema = {
  target: z
    .string()
    .max(2_048)
    .describe(
      "What to click. Meaning depends on target_type:\n" +
      "- text: visible text, e.g. \"Sign in\"\n" +
      "- role: accessible name when combined with `role` param, e.g. \"Sign in\" + role=\"button\"\n" +
      "- label: <label> text, e.g. \"Email\" (for inputs)\n" +
      "- placeholder: input placeholder text\n" +
      "- testid: data-testid value\n" +
      "- selector: CSS selector",
    ),
  target_type: z
    .enum(LOCATOR_TYPES)
    .default("text")
    .describe(
      "How to interpret target. Prefer `role` for buttons/links (most reliable), " +
      "`label` for form fields, `text` for generic visible text. `selector` is the escape hatch.",
    ),
  role: z
    .enum(ROLES)
    .optional()
    .describe("ARIA role when target_type='role'. Common: button, link, textbox, checkbox."),
  exact: z
    .boolean()
    .default(false)
    .describe("Exact match vs substring (for text/role/label/placeholder)."),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeClickHandler(browser: BrowserManager) {
  return async ({
    target,
    target_type,
    role,
    exact,
    tab_id,
  }: {
    target: string;
    target_type: LocatorType;
    role?: string;
    exact?: boolean;
    tab_id?: string;
  }) => {
    await browser.click(target, target_type, tab_id, { role, exact });
    const suffix = target_type === "role" && role ? ` role=${role}` : "";
    return {
      content: [{ type: "text" as const, text: `Clicked (${target_type}${suffix}): ${target}` }],
    };
  };
}

export const typeSchema = {
  target: z
    .string()
    .max(2_048)
    .describe("Target to fill. See target_type for semantics."),
  target_type: z
    .enum(LOCATOR_TYPES)
    .default("selector")
    .describe(
      "Locator strategy. Default 'selector' (CSS) for backward compat. " +
      "Prefer 'label' for forms (e.g. target=\"Email\") — most robust against markup changes.",
    ),
  role: z.enum(ROLES).optional().describe("ARIA role when target_type='role'."),
  exact: z.boolean().default(false).describe("Exact match for text/label/placeholder/role."),
  text: z.string().describe("Text to type. Existing value is replaced (fill semantics)."),
  submit: z
    .boolean()
    .default(false)
    .describe("Press Enter after typing (e.g. to submit a search or login form)"),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
  // Legacy alias
  selector: z
    .string()
    .optional()
    .describe("Deprecated alias for `target` (when target_type='selector'). Kept for compatibility."),
};
export function makeTypeHandler(browser: BrowserManager) {
  return async ({
    target,
    target_type,
    role,
    exact,
    text,
    submit,
    tab_id,
    selector,
  }: {
    target?: string;
    target_type: LocatorType;
    role?: string;
    exact?: boolean;
    text: string;
    submit: boolean;
    tab_id?: string;
    selector?: string;
  }) => {
    const actualTarget = target ?? selector;
    if (!actualTarget) {
      throw new Error("browser_type requires `target` (preferred) or `selector` (legacy)");
    }
    await browser.type(actualTarget, text, submit, tab_id, target_type, { role, exact });
    const suffix = target_type === "role" && role ? ` role=${role}` : "";
    return {
      content: [
        { type: "text" as const, text: `Typed into (${target_type}${suffix}): ${actualTarget}${submit ? " + Enter" : ""}` },
      ],
    };
  };
}

export const scrollSchema = {
  direction: z
    .enum(["up", "down", "top", "bottom"])
    .default("down")
    .describe("up/down scroll by `amount` px; top/bottom jump to the page edges"),
  amount: z
    .number()
    .int()
    .positive()
    .default(800)
    .describe("Pixels to scroll when direction is up/down (ignored for top/bottom)"),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeScrollHandler(browser: BrowserManager) {
  return async ({
    direction,
    amount,
    tab_id,
  }: {
    direction: "up" | "down" | "top" | "bottom";
    amount: number;
    tab_id?: string;
  }) => {
    const pos = await browser.scroll(direction, amount, tab_id);
    const pct = pos.scrollHeight > pos.viewportHeight
      ? Math.round((pos.scrollY / (pos.scrollHeight - pos.viewportHeight)) * 100)
      : 100;
    return {
      content: [
        {
          type: "text" as const,
          text: `Scrolled ${direction} — position: ${pos.scrollY}/${pos.scrollHeight}px (${pct}%)`,
        },
      ],
    };
  };
}

export const backSchema = {
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeBackHandler(browser: BrowserManager) {
  return async ({ tab_id }: { tab_id?: string }) => {
    const info = await browser.back(tab_id);
    const text = info.no_history
      ? `Already at earliest history entry — ${info.url}`
      : `Back → ${info.url}`;
    return { content: [{ type: "text" as const, text }] };
  };
}

export const forwardSchema = {
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeForwardHandler(browser: BrowserManager) {
  return async ({ tab_id }: { tab_id?: string }) => {
    const info = await browser.forward(tab_id);
    const text = info.no_history
      ? `Already at latest history entry — ${info.url}`
      : `Forward → ${info.url}`;
    return { content: [{ type: "text" as const, text }] };
  };
}

export const reloadSchema = {
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeReloadHandler(browser: BrowserManager) {
  return async ({ tab_id }: { tab_id?: string }) => {
    const info = await browser.reload(tab_id);
    return { content: [{ type: "text" as const, text: `Reloaded → ${info.url}` }] };
  };
}

export const findSchema = {
  query: z
    .string()
    .describe("Substring to search for in the page's visible text (case-insensitive)"),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(10)
    .describe("Maximum number of matches to return"),
  tab_id: z.string().optional().describe("Tab to search in; defaults to the active tab"),
};
export function makeFindHandler(browser: BrowserManager) {
  return async ({
    query,
    limit,
    tab_id,
  }: {
    query: string;
    limit: number;
    tab_id?: string;
  }) => {
    const hits = await browser.find(query, limit, tab_id);
    if (!hits.length) {
      return { content: [{ type: "text" as const, text: `No matches for "${query}"` }] };
    }
    const text = hits
      .map((h, i) => `${i + 1}. [${h.tag}] ${h.snippet}\n   selector: ${h.selector}`)
      .join("\n");
    return { content: [{ type: "text" as const, text }] };
  };
}

export const waitSchema = {
  selector: z.string().describe("CSS selector to wait for"),
  state: z
    .enum(["visible", "hidden", "attached", "detached"])
    .default("visible")
    .describe("Element state to wait for"),
  timeout: z
    .number()
    .int()
    .positive()
    .default(10000)
    .describe("Max wait time in milliseconds"),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeWaitHandler(browser: BrowserManager) {
  return async ({
    selector,
    state,
    timeout,
    tab_id,
  }: {
    selector: string;
    state: "visible" | "hidden" | "attached" | "detached";
    timeout: number;
    tab_id?: string;
  }) => {
    const page = browser.getPage(tab_id);
    await page.locator(selector).waitFor({ state, timeout });
    return {
      content: [{ type: "text" as const, text: `Element ${selector} is ${state}` }],
    };
  };
}

export const evaluateSchema = {
  expression: z
    .string()
    .describe(
      "JavaScript expression to evaluate in the page context. Must return a JSON-serializable value.",
    ),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeEvaluateHandler(browser: BrowserManager) {
  return async ({
    expression,
    tab_id,
  }: {
    expression: string;
    tab_id?: string;
  }) => {
    const page = browser.getPage(tab_id);
    const result = await page.evaluate(expression);
    const text =
      result === undefined ? "undefined" : JSON.stringify(result, null, 2);
    return { content: [{ type: "text" as const, text }] };
  };
}
