import { z } from "zod";
import type { BrowserApi } from "../browser.js";

export const tabsListSchema = {};
export function makeTabsListHandler(browser: BrowserApi) {
  return async () => {
    const tabs = await browser.listTabs();
    const active = browser.activeTabId;
    const text = tabs.length
      ? tabs.map((t) => `${t.tab_id === active ? "→ " : "  "}${t.tab_id}  ${t.title}  ${t.url}`).join("\n")
      : "(no tabs open)";
    return { content: [{ type: "text" as const, text }], data: { tabs, active } };
  };
}

export const tabSwitchSchema = {
  tab_id: z.string().describe("Tab to make active (from browser_tabs_list)"),
};
export function makeTabSwitchHandler(browser: BrowserApi) {
  return async ({ tab_id }: { tab_id: string }) => {
    browser.switchTab(tab_id);
    return { content: [{ type: "text" as const, text: `Switched to ${tab_id}` }], data: { tab_id } };
  };
}

export const tabCloseSchema = {
  tab_id: z.string().describe("Tab to close"),
};
export function makeTabCloseHandler(browser: BrowserApi) {
  return async ({ tab_id }: { tab_id: string }) => {
    await browser.closeTab(tab_id);
    return { content: [{ type: "text" as const, text: `Closed ${tab_id}` }], data: { tab_id, closed: true } };
  };
}
