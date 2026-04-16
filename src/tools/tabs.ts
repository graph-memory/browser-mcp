import { z } from "zod";
import { browser } from "../browser.js";

export const tabsListSchema = {};
export async function tabsListHandler() {
  const tabs = await browser.listTabs();
  const active = browser.activeTabId;
  const text = tabs.length
    ? tabs.map((t) => `${t.tab_id === active ? "→ " : "  "}${t.tab_id}  ${t.title}  ${t.url}`).join("\n")
    : "(no tabs open)";
  return { content: [{ type: "text" as const, text }] };
}

export const tabSwitchSchema = {
  tab_id: z.string().describe("Tab to make active (from browser_tabs_list)"),
};
export async function tabSwitchHandler({ tab_id }: { tab_id: string }) {
  browser.switchTab(tab_id);
  return { content: [{ type: "text" as const, text: `Switched to ${tab_id}` }] };
}

export const tabCloseSchema = {
  tab_id: z.string().describe("Tab to close"),
};
export async function tabCloseHandler({ tab_id }: { tab_id: string }) {
  await browser.closeTab(tab_id);
  return { content: [{ type: "text" as const, text: `Closed ${tab_id}` }] };
}
