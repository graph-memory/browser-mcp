import { z } from "zod";
import { browser } from "../browser.js";

export const clickSchema = {
  target: z
    .string()
    .describe(
      "Visible text of the element to click (preferred, e.g. \"Sign in\"). Falls back to treating the value as a CSS selector if no text match is found.",
    ),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export async function clickHandler({ target, tab_id }: { target: string; tab_id?: string }) {
  await browser.click(target, tab_id);
  return { content: [{ type: "text" as const, text: `Clicked: ${target}` }] };
}

export const typeSchema = {
  selector: z
    .string()
    .describe("CSS selector of the input/textarea/contenteditable to fill"),
  text: z.string().describe("Text to type. Existing value is replaced (fill semantics)."),
  submit: z
    .boolean()
    .default(false)
    .describe("Press Enter after typing (e.g. to submit a search or login form)"),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export async function typeHandler({
  selector,
  text,
  submit,
  tab_id,
}: {
  selector: string;
  text: string;
  submit: boolean;
  tab_id?: string;
}) {
  await browser.type(selector, text, submit, tab_id);
  return { content: [{ type: "text" as const, text: `Typed into ${selector}${submit ? " + Enter" : ""}` }] };
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
export async function scrollHandler({
  direction,
  amount,
  tab_id,
}: {
  direction: "up" | "down" | "top" | "bottom";
  amount: number;
  tab_id?: string;
}) {
  await browser.scroll(direction, amount, tab_id);
  return { content: [{ type: "text" as const, text: `Scrolled ${direction}` }] };
}

export const backSchema = {
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export async function backHandler({ tab_id }: { tab_id?: string }) {
  const info = await browser.back(tab_id);
  return { content: [{ type: "text" as const, text: `Back → ${info.url}` }] };
}

export const forwardSchema = {
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export async function forwardHandler({ tab_id }: { tab_id?: string }) {
  const info = await browser.forward(tab_id);
  return { content: [{ type: "text" as const, text: `Forward → ${info.url}` }] };
}

export const reloadSchema = {
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export async function reloadHandler({ tab_id }: { tab_id?: string }) {
  const info = await browser.reload(tab_id);
  return { content: [{ type: "text" as const, text: `Reloaded → ${info.url}` }] };
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
export async function findHandler({
  query,
  limit,
  tab_id,
}: {
  query: string;
  limit: number;
  tab_id?: string;
}) {
  const hits = await browser.find(query, limit, tab_id);
  if (!hits.length) {
    return { content: [{ type: "text" as const, text: `No matches for "${query}"` }] };
  }
  const text = hits
    .map((h, i) => `${i + 1}. [${h.tag}] ${h.snippet}\n   selector: ${h.selector}`)
    .join("\n");
  return { content: [{ type: "text" as const, text }] };
}
