import { z } from "zod";
import type { BrowserManager } from "../browser.js";

export const dialogSchema = {
  action: z.enum(["accept", "dismiss"]).default("accept")
    .describe("How to respond to the next native dialog: accept (OK) or dismiss (Cancel)."),
  prompt_text: z.string().max(4_096).optional()
    .describe("Text to enter into a window.prompt() before accepting. Ignored for alert/confirm."),
  persist: z.boolean().default(false)
    .describe("false (default) = apply to the next dialog only, then revert to auto-dismiss; true = apply to all dialogs until changed."),
};

export function makeDialogHandler(browser: BrowserManager) {
  return async (a: { action: "accept" | "dismiss"; prompt_text?: string; persist: boolean }) => {
    browser.setDialogPolicy(a.action, a.prompt_text, a.persist);
    const scope = a.persist ? "all subsequent dialogs" : "the next dialog";
    const txt = a.action === "accept" && a.prompt_text !== undefined ? ` (prompt text: "${a.prompt_text}")` : "";
    return { content: [{ type: "text" as const, text: `Will ${a.action} ${scope}${txt}. Trigger the dialog (e.g. click) now.` }] };
  };
}
