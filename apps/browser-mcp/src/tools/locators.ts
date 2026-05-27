/**
 * Shared locator/role vocabularies for the interaction tools (click, type,
 * expect, download). Centralized so the `target_type` and `role` enums stay
 * identical across tools instead of drifting per-file.
 *
 * Note: browser_upload deliberately uses a narrower locator set
 * (selector/label/testid) — file inputs are rarely addressable by role/text —
 * so it keeps its own list.
 */

export const LOCATOR_TYPES = ["text", "role", "label", "placeholder", "testid", "selector"] as const;

export const ROLES = [
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
