import { z } from "zod";
import type { BrowserApi, LocatorType } from "../browser.js";
import { LOCATOR_TYPES, ROLES } from "./locators.js";

// --- browser_press ---

export const pressSchema = {
  key: z.string().min(1).max(64).describe(
    "Key or chord to press, Playwright syntax. Examples: \"Enter\", \"Tab\", \"Escape\", " +
    "\"ArrowDown\", \"Control+A\", \"Meta+C\". Combine modifiers with '+'.",
  ),
  target: z.string().max(2_048).optional()
    .describe("Optional element to focus first. If omitted, the key is sent to the page (active element)."),
  target_type: z.enum(LOCATOR_TYPES).default("text").describe("Locator strategy for `target`."),
  role: z.enum(ROLES).optional().describe("ARIA role when target_type='role'."),
  exact: z.boolean().default(false).describe("Exact match for text/role/label/placeholder."),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makePressHandler(browser: BrowserApi) {
  return async (a: { key: string; target?: string; target_type: LocatorType; role?: string; exact?: boolean; tab_id?: string }) => {
    await browser.press(a.key, a.target, a.target_type, a.tab_id, { role: a.role, exact: a.exact });
    const where = a.target ? ` on (${a.target_type}): ${a.target}` : " (page)";
    return { content: [{ type: "text" as const, text: `Pressed ${a.key}${where}` }] };
  };
}

// --- browser_hover ---

export const hoverSchema = {
  target: z.string().max(2_048).describe("Element to hover. See target_type."),
  target_type: z.enum(LOCATOR_TYPES).default("text").describe("Locator strategy for `target`."),
  role: z.enum(ROLES).optional().describe("ARIA role when target_type='role'."),
  exact: z.boolean().default(false).describe("Exact match for text/role/label/placeholder."),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeHoverHandler(browser: BrowserApi) {
  return async (a: { target: string; target_type: LocatorType; role?: string; exact?: boolean; tab_id?: string }) => {
    await browser.hover(a.target, a.target_type, a.tab_id, { role: a.role, exact: a.exact });
    return { content: [{ type: "text" as const, text: `Hovered (${a.target_type}): ${a.target}` }] };
  };
}

// --- browser_select_option ---

export const selectOptionSchema = {
  target: z.string().max(2_048).describe("The <select> element. See target_type."),
  target_type: z.enum(LOCATOR_TYPES).default("label")
    .describe("Locator strategy for the <select>. `label` is usually cleanest for forms."),
  role: z.enum(ROLES).optional().describe("ARIA role when target_type='role'."),
  exact: z.boolean().default(false).describe("Exact match for text/role/label/placeholder."),
  by: z.enum(["value", "label", "index"]).default("value")
    .describe("How to interpret `values`: option `value` attribute, visible `label`, or zero-based `index`."),
  values: z.array(z.string().max(1_024)).min(1).max(64)
    .describe("Option(s) to select. For a single-select pass one; for <select multiple> pass several."),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeSelectOptionHandler(browser: BrowserApi) {
  return async (a: {
    target: string; target_type: LocatorType; role?: string; exact?: boolean;
    by: "value" | "label" | "index"; values: string[]; tab_id?: string;
  }) => {
    const selected = await browser.selectOption(a.target, a.target_type, a.by, a.values, a.tab_id, { role: a.role, exact: a.exact });
    return {
      content: [{ type: "text" as const, text: `Selected by ${a.by} in (${a.target_type}) ${a.target}: ${selected.join(", ") || "(none)"}` }],
      data: { selected, by: a.by },
    };
  };
}

// --- browser_check ---

export const checkSchema = {
  target: z.string().max(2_048).describe("Checkbox or radio to set. See target_type."),
  target_type: z.enum(LOCATOR_TYPES).default("label").describe("Locator strategy. `label` is usually cleanest."),
  role: z.enum(ROLES).optional().describe("ARIA role when target_type='role'."),
  exact: z.boolean().default(false).describe("Exact match for text/role/label/placeholder."),
  checked: z.boolean().default(true).describe("true → check (default), false → uncheck. Idempotent (no-op if already in that state)."),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeCheckHandler(browser: BrowserApi) {
  return async (a: { target: string; target_type: LocatorType; role?: string; exact?: boolean; checked: boolean; tab_id?: string }) => {
    await browser.setChecked(a.target, a.target_type, a.checked, a.tab_id, { role: a.role, exact: a.exact });
    return { content: [{ type: "text" as const, text: `${a.checked ? "Checked" : "Unchecked"} (${a.target_type}): ${a.target}` }] };
  };
}

// --- browser_drag ---

export const dragSchema = {
  source: z.string().max(2_048).describe("Element to drag. See source_type."),
  source_type: z.enum(LOCATOR_TYPES).default("text").describe("Locator strategy for `source`."),
  source_role: z.enum(ROLES).optional().describe("ARIA role when source_type='role'."),
  target: z.string().max(2_048).describe("Drop target. See target_type."),
  target_type: z.enum(LOCATOR_TYPES).default("text").describe("Locator strategy for `target`."),
  target_role: z.enum(ROLES).optional().describe("ARIA role when target_type='role'."),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export function makeDragHandler(browser: BrowserApi) {
  return async (a: {
    source: string; source_type: LocatorType; source_role?: string;
    target: string; target_type: LocatorType; target_role?: string; tab_id?: string;
  }) => {
    await browser.drag(a.source, a.source_type, a.target, a.target_type, a.tab_id, { role: a.source_role }, { role: a.target_role });
    return { content: [{ type: "text" as const, text: `Dragged (${a.source_type}) ${a.source} → (${a.target_type}) ${a.target}` }] };
  };
}
