import { z } from "zod";
import type { BrowserManager } from "../browser.js";

export const tabsListSchema = {};
export function makeTabsListHandler(browser: BrowserManager) {
  return async () => {
    const tabs = await browser.listTabs();
    const active = browser.activeTabId;
    const text = tabs.length
      ? tabs.map((t) => `${t.tab_id === active ? "→ " : "  "}${t.tab_id}  ${t.title}  ${t.url}`).join("\n")
      : "(no tabs open)";
    return { content: [{ type: "text" as const, text }] };
  };
}

export const tabSwitchSchema = {
  tab_id: z.string().describe("Tab to make active (from browser_tabs_list)"),
};
export function makeTabSwitchHandler(browser: BrowserManager) {
  return async ({ tab_id }: { tab_id: string }) => {
    browser.switchTab(tab_id);
    return { content: [{ type: "text" as const, text: `Switched to ${tab_id}` }] };
  };
}

export const tabCloseSchema = {
  tab_id: z.string().describe("Tab to close"),
};
export function makeTabCloseHandler(browser: BrowserManager) {
  return async ({ tab_id }: { tab_id: string }) => {
    await browser.closeTab(tab_id);
    return { content: [{ type: "text" as const, text: `Closed ${tab_id}` }] };
  };
}
