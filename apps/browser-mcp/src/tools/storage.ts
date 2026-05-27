import { z } from "zod";
import type { BrowserApi } from "../browser.js";
import { config } from "../config.js";
import { truncate } from "../render.js";

export const storageSchema = {
  action: z.enum(["get", "set", "remove", "clear"])
    .describe("get (a key, or all if `key` omitted), set (`key`+`value`), remove (`key`), or clear all."),
  area: z.enum(["local", "session"]).default("local")
    .describe("Which store: localStorage (default, persists in the profile) or sessionStorage."),
  key: z.string().max(1_024).optional().describe("Storage key. Required for set/remove; optional for get."),
  value: z.string().max(100_000).optional().describe("Value to store. Required for set."),
  tab_id: z.string().optional().describe("Tab whose origin to use; defaults to the active tab. Storage is per-origin."),
};

export function makeStorageHandler(browser: BrowserApi) {
  return async (a: {
    action: "get" | "set" | "remove" | "clear";
    area: "local" | "session";
    key?: string;
    value?: string;
    tab_id?: string;
  }) => {
    if (a.action === "set" && (a.key === undefined || a.value === undefined)) {
      return { isError: true, content: [{ type: "text" as const, text: "`key` and `value` are required for action='set'" }] };
    }
    if (a.action === "remove" && a.key === undefined) {
      return { isError: true, content: [{ type: "text" as const, text: "`key` is required for action='remove'" }] };
    }

    const result = await browser.storage(a.action, a.area, a.key, a.value, a.tab_id);

    if (a.action === "get") {
      const entries = Object.entries(result as Record<string, string | null>);
      if (entries.length === 0) return { content: [{ type: "text" as const, text: `(${a.area}Storage empty)` }] };
      const body = entries.map(([k, v]) => `${k} = ${v}`).join("\n");
      return { content: [{ type: "text" as const, text: truncate(body, config.maxChars) }] };
    }
    const verb = a.action === "set" ? `Set ${a.key}` : a.action === "remove" ? `Removed ${a.key}` : "Cleared";
    return { content: [{ type: "text" as const, text: `${verb} in ${a.area}Storage` }] };
  };
}
