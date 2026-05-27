/**
 * Shared locator/role vocabularies for the interaction tools (click, type,
 * press, hover, select_option, check, drag, expect, download, fill_form).
 * Centralized so the `target_type` and `role` enums stay identical across tools
 * instead of drifting per-file. `resolveLocator` (browser.ts) maps each
 * `target_type` 1:1 onto a Playwright locator: text→getByText, role→getByRole
 * (name=target; role defaults to "button" when omitted), label→getByLabel,
 * placeholder→getByPlaceholder, testid→getByTestId, selector→locator (CSS).
 * `exact` (substring vs exact match) applies to text/role/label/placeholder
 * only; testid/selector ignore it.
 *
 * Tools share these enums but DO diverge in a few places — all intentional, not
 * drift:
 *  - Default `target_type`: most tools default to "text" (click/type/press/
 *    hover/drag/expect/download). The form-oriented tools default to "label",
 *    the cleanest handle for form controls: select_option, check, and fill_form
 *    fields (a fill_form `submit` button locator still defaults to "text",
 *    matching click).
 *  - browser_upload keeps its OWN narrower set (selector/label/testid) and no
 *    role/exact — file inputs are rarely addressable by role/text.
 *  - browser_drag takes two locators, so it uses `source_*`/`target_*` prefixes
 *    instead of a single `role`, and omits `exact`.
 *  - browser_download omits `exact` (download targets are click-like links).
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
