import { z } from "zod";
import { browser } from "../browser.js";

export const clickSchema = {
  target: z
    .string()
    .describe(
      "Visible text of the element to click (e.g. \"Sign in\"), or a CSS selector when target_type=\"selector\".",
    ),
  target_type: z
    .enum(["text", "selector"])
    .default("text")
    .describe(
      "How to interpret target: \"text\" matches visible text (default, preferred), \"selector\" uses a CSS selector.",
    ),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export async function clickHandler({
  target,
  target_type,
  tab_id,
}: {
  target: string;
  target_type: "text" | "selector";
  tab_id?: string;
}) {
  await browser.click(target, target_type, tab_id);
  return { content: [{ type: "text" as const, text: `Clicked (${target_type}): ${target}` }] };
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
}

export const backSchema = {
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export async function backHandler({ tab_id }: { tab_id?: string }) {
  const info = await browser.back(tab_id);
  const text = info.no_history
    ? `Already at earliest history entry — ${info.url}`
    : `Back → ${info.url}`;
  return { content: [{ type: "text" as const, text }] };
}

export const forwardSchema = {
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};
export async function forwardHandler({ tab_id }: { tab_id?: string }) {
  const info = await browser.forward(tab_id);
  const text = info.no_history
    ? `Already at latest history entry — ${info.url}`
    : `Forward → ${info.url}`;
  return { content: [{ type: "text" as const, text }] };
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
export async function waitHandler({
  selector,
  state,
  timeout,
  tab_id,
}: {
  selector: string;
  state: "visible" | "hidden" | "attached" | "detached";
  timeout: number;
  tab_id?: string;
}) {
  const page = browser.getPage(tab_id);
  await page.locator(selector).waitFor({ state, timeout });
  return {
    content: [{ type: "text" as const, text: `Element ${selector} is ${state}` }],
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
export async function evaluateHandler({
  expression,
  tab_id,
}: {
  expression: string;
  tab_id?: string;
}) {
  const page = browser.getPage(tab_id);
  const result = await page.evaluate(expression);
  const text =
    result === undefined ? "undefined" : JSON.stringify(result, null, 2);
  return { content: [{ type: "text" as const, text }] };
}
