import { z } from "zod";
import type { BrowserApi, LocatorType } from "../browser.js";
import { LOCATOR_TYPES, ROLES } from "./locators.js";

const fieldSchema = z.object({
  target: z.string().max(2_048).describe("Field locator. See target_type."),
  target_type: z.enum(LOCATOR_TYPES).default("label").describe("Locator strategy. `label` is usually cleanest for forms."),
  role: z.enum(ROLES).optional().describe("ARIA role when target_type='role'."),
  exact: z.boolean().default(false).describe("Exact match for text/role/label/placeholder."),
  value: z.string().max(10_000).optional().describe("Text to fill (input/textarea/contenteditable)."),
  checked: z.boolean().optional().describe("Set a checkbox/radio (idempotent)."),
  options: z.array(z.string().max(1_024)).min(1).max(64).optional().describe("Select option value(s) in a native <select>."),
}).refine(
  (f) => [f.value !== undefined, f.checked !== undefined, f.options !== undefined].filter(Boolean).length === 1,
  { message: "each field must set exactly one of `value`, `checked`, or `options`" },
);

export const fillFormSchema = {
  fields: z.array(fieldSchema).min(1).max(64)
    .describe("Fields to fill, applied in order. Each sets exactly one of value/checked/options."),
  submit: z.union([
    z.boolean(),
    z.object({
      target: z.string().max(2_048),
      target_type: z.enum(LOCATOR_TYPES).default("text"),
      role: z.enum(ROLES).optional(),
    }),
  ]).optional().describe("After filling: true presses Enter on the last field; an object clicks that submit element."),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};

type Field = {
  target: string; target_type: LocatorType; role?: string; exact?: boolean;
  value?: string; checked?: boolean; options?: string[];
};

export function makeFillFormHandler(browser: BrowserApi) {
  return async (a: {
    fields: Field[];
    submit?: boolean | { target: string; target_type: LocatorType; role?: string };
    tab_id?: string;
  }) => {
    const done: string[] = [];
    let last: Field | undefined;

    for (let i = 0; i < a.fields.length; i++) {
      const f = a.fields[i];
      const opts = { role: f.role, exact: f.exact };
      try {
        if (f.value !== undefined) {
          await browser.type(f.target, f.value, false, a.tab_id, f.target_type, opts);
          done.push(`${f.target}=text`);
        } else if (f.checked !== undefined) {
          await browser.setChecked(f.target, f.target_type, f.checked, a.tab_id, opts);
          done.push(`${f.target}=${f.checked ? "checked" : "unchecked"}`);
        } else if (f.options !== undefined) {
          await browser.selectOption(f.target, f.target_type, "value", f.options, a.tab_id, opts);
          done.push(`${f.target}=select`);
        }
        last = f;
      } catch (e) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `fill_form: filled ${done.length}/${a.fields.length}, failed on field ${i} (${f.target_type}:${f.target}): ${(e as Error).message}`,
          }],
        };
      }
    }

    let submitted = "";
    if (a.submit === true && last) {
      await browser.press("Enter", last.target, last.target_type, a.tab_id, { role: last.role, exact: last.exact });
      submitted = " + Enter";
    } else if (a.submit && typeof a.submit === "object") {
      await browser.click(a.submit.target, a.submit.target_type, a.tab_id, { role: a.submit.role });
      submitted = ` + submit(${a.submit.target})`;
    }

    return { content: [{ type: "text" as const, text: `Filled ${done.length} field${done.length === 1 ? "" : "s"}${submitted}: ${done.join(", ")}` }] };
  };
}
