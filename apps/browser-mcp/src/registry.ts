import type { ZodRawShape } from "zod";
import type { BrowserApi } from "./browser.js";
import type { ToolResult } from "./tool-runtime.js";
import { openSchema, makeOpenHandler } from "./tools/open.js";
import { readSchema, makeReadHandler } from "./tools/read.js";
import {
  tabsListSchema, makeTabsListHandler,
  tabSwitchSchema, makeTabSwitchHandler,
  tabCloseSchema, makeTabCloseHandler,
} from "./tools/tabs.js";
import {
  clickSchema, makeClickHandler,
  typeSchema, makeTypeHandler,
  scrollSchema, makeScrollHandler,
  backSchema, makeBackHandler,
  forwardSchema, makeForwardHandler,
  reloadSchema, makeReloadHandler,
  findSchema, makeFindHandler,
  waitSchema, makeWaitHandler,
  evaluateSchema, makeEvaluateHandler,
} from "./tools/interact.js";
import {
  openVisibleSchema, makeOpenVisibleHandler,
  screenshotSchema, makeScreenshotHandler,
} from "./tools/visual.js";
import { configureSchema, makeConfigureHandler } from "./tools/configure.js";
import { snapshotSchema, makeSnapshotHandler } from "./tools/snapshot.js";
import { expectSchema, makeExpectHandler } from "./tools/expect.js";
import { permissionsSchema, makePermissionsHandler } from "./tools/permissions.js";
import { saveSchema, makeSaveHandler } from "./tools/save.js";
import { uploadSchema, makeUploadHandler } from "./tools/upload.js";
import { downloadSchema, makeDownloadHandler } from "./tools/download.js";
import { cookiesSchema, makeCookiesHandler } from "./tools/cookies.js";
import { networkSchema, makeNetworkHandler } from "./tools/network.js";
import { consoleSchema, makeConsoleHandler } from "./tools/console.js";
import { networkBodySchema, makeNetworkBodyHandler } from "./tools/network-body.js";
import { storageSchema, makeStorageHandler } from "./tools/storage.js";
import { dialogSchema, makeDialogHandler } from "./tools/dialog.js";
import { geolocationSchema, makeGeolocationHandler } from "./tools/geolocation.js";
import {
  pressSchema, makePressHandler,
  hoverSchema, makeHoverHandler,
  selectOptionSchema, makeSelectOptionHandler,
  checkSchema, makeCheckHandler,
  dragSchema, makeDragHandler,
} from "./tools/actions.js";
import { fillFormSchema, makeFillFormHandler } from "./tools/fill-form.js";

/**
 * A tool definition: name, description, the zod raw shape for its arguments,
 * and a factory that binds a handler to a BrowserApi (a per-session view).
 *
 * This is the single source of truth for the tool surface. Both transports
 * build from it: `buildServer` registers each with the MCP SDK, and the REST
 * router mounts each as `POST /api/v1/tools/<name>`.
 */
export type ToolDef = {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  // Per-tool arg types are enforced at each handler's definition; the registry
  // is intentionally loose here so the heterogeneous handlers fit one array.
  makeHandler: (browser: BrowserApi) => (args: any) => Promise<ToolResult>;
};

export const TOOLS: ToolDef[] = [
  {
    name: "browser_open",
    description:
      "Open a URL in a new tab, or navigate an existing tab if tab_id is given. Waits for DOMContentLoaded plus a short request-idle settle. Does NOT return page content — call browser_read afterwards. Returns HTTP status, final URL, title, and tab_id.",
    inputSchema: openSchema,
    makeHandler: makeOpenHandler,
  },
  {
    name: "browser_read",
    description:
      "Read the current (or specified) tab. mode=markdown (default) extracts the main article via Readability and returns Markdown; mode=text returns body innerText; mode=html returns raw HTML. Use selector to narrow to an element. Output is capped at max_chars (default 50000, overridable globally via BROWSER_MCP_MAX_CHARS).",
    inputSchema: readSchema,
    makeHandler: makeReadHandler,
  },
  {
    name: "browser_tabs_list",
    description: "List all open tabs with their tab_id, title, and URL. The active tab is marked with →.",
    inputSchema: tabsListSchema,
    makeHandler: makeTabsListHandler,
  },
  {
    name: "browser_tab_switch",
    description: "Make the given tab the active one for subsequent tool calls.",
    inputSchema: tabSwitchSchema,
    makeHandler: makeTabSwitchHandler,
  },
  {
    name: "browser_tab_close",
    description: "Close a tab by tab_id.",
    inputSchema: tabCloseSchema,
    makeHandler: makeTabCloseHandler,
  },
  {
    name: "browser_click",
    description:
      "Click an element. target_type picks the locator strategy (most reliable first): " +
      "`role` (e.g. target=\"Sign in\" + role=\"button\"), `label` (form fields by <label>), " +
      "`text` (visible text, default), `placeholder`, `testid`, `selector` (CSS escape hatch). " +
      "Playwright auto-waits for the element to be visible/enabled/stable; we also wait for " +
      "network idle after the click.",
    inputSchema: clickSchema,
    makeHandler: makeClickHandler,
  },
  {
    name: "browser_type",
    description:
      "Fill an input/textarea/contenteditable with text. target_type picks the locator strategy " +
      "(default `text`); `label` is usually most robust for forms (e.g. target=\"Email\"), " +
      "`selector` is the CSS escape hatch. If submit=true, presses Enter after typing. Auto-waits " +
      "for the field to be actionable before filling.",
    inputSchema: typeSchema,
    makeHandler: makeTypeHandler,
  },
  {
    name: "browser_press",
    description:
      "Press a key or chord (Playwright syntax: \"Enter\", \"Tab\", \"Escape\", \"ArrowDown\", " +
      "\"Control+A\", \"Meta+C\"). With `target`, focuses that element first; otherwise sends to the page.",
    inputSchema: pressSchema,
    makeHandler: makePressHandler,
  },
  {
    name: "browser_hover",
    description:
      "Hover the mouse over an element (to reveal menus, tooltips, or hover-only controls). " +
      "Same locator strategies as browser_click.",
    inputSchema: hoverSchema,
    makeHandler: makeHoverHandler,
  },
  {
    name: "browser_select_option",
    description:
      "Select option(s) in a native <select> by value (default), visible label, or zero-based index. " +
      "More reliable than clicking options. For <select multiple> pass several values.",
    inputSchema: selectOptionSchema,
    makeHandler: makeSelectOptionHandler,
  },
  {
    name: "browser_check",
    description:
      "Set a checkbox or radio to checked/unchecked. Idempotent (unlike browser_click, which toggles): " +
      "checked=true ensures checked, checked=false ensures unchecked, no-op if already in that state.",
    inputSchema: checkSchema,
    makeHandler: makeCheckHandler,
  },
  {
    name: "browser_drag",
    description:
      "Drag one element onto another (HTML5 drag-and-drop / sortable lists). Specify source and target " +
      "with their own locator strategies.",
    inputSchema: dragSchema,
    makeHandler: makeDragHandler,
  },
  {
    name: "browser_fill_form",
    description:
      "Fill a whole form in one call. `fields` is applied in order; each field sets exactly one of " +
      "`value` (text), `checked` (checkbox/radio), or `options` (native <select> by value). " +
      "Aborts on the first failing field (reports which). `submit: true` presses Enter on the last " +
      "field; `submit: { target }` clicks a submit button afterwards.",
    inputSchema: fillFormSchema,
    makeHandler: makeFillFormHandler,
  },
  {
    name: "browser_scroll",
    description:
      "Scroll the current tab: direction=up|down scrolls by `amount` pixels (default 800); top/bottom jump to the page edges.",
    inputSchema: scrollSchema,
    makeHandler: makeScrollHandler,
  },
  {
    name: "browser_back",
    description: "Navigate back in the tab's history.",
    inputSchema: backSchema,
    makeHandler: makeBackHandler,
  },
  {
    name: "browser_forward",
    description: "Navigate forward in the tab's history.",
    inputSchema: forwardSchema,
    makeHandler: makeForwardHandler,
  },
  {
    name: "browser_reload",
    description: "Reload the current page.",
    inputSchema: reloadSchema,
    makeHandler: makeReloadHandler,
  },
  {
    name: "browser_find",
    description:
      "Find text occurrences on the current page. Returns up to `limit` snippets (default 10), each with surrounding context and a best-effort CSS selector for browser_click/browser_type — the selector is depth-capped and may not be unique on complex DOM, so prefer role/label/text locators when possible.",
    inputSchema: findSchema,
    makeHandler: makeFindHandler,
  },
  {
    name: "browser_wait",
    description:
      "Wait for an element to reach a given state. Useful for SPAs that load content asynchronously. Returns when the element matches the state or the timeout expires.",
    inputSchema: waitSchema,
    makeHandler: makeWaitHandler,
  },
  {
    name: "browser_evaluate",
    description:
      "Execute a JavaScript expression in the page context and return the JSON-serialized result. Useful for reading localStorage, cookies, window variables, or extracting data not visible in the DOM.",
    inputSchema: evaluateSchema,
    makeHandler: makeEvaluateHandler,
  },
  {
    name: "browser_open_visible",
    description:
      "Open a URL in a VISIBLE (non-headless) Chrome window for manual interaction: signing in, solving a CAPTCHA, or inspecting a page yourself. Cookies/localStorage are saved to the persistent profile. Returns immediately — the user closes the window when done, and subsequent tools return to the default (headless) mode.",
    inputSchema: openVisibleSchema,
    makeHandler: makeOpenVisibleHandler,
  },
  {
    name: "browser_screenshot",
    description:
      "Take a PNG screenshot of the current tab. Default: viewport. full_page=true captures the entire scrollable page.",
    inputSchema: screenshotSchema,
    makeHandler: makeScreenshotHandler,
  },
  {
    name: "browser_snapshot",
    description:
      "Return an accessibility snapshot of the page — a compact tree of semantic elements " +
      "(role, name, value, state) based on the platform a11y API. More reliable than Markdown " +
      "for interacting with SPAs, form-heavy pages, or custom components without stable selectors. " +
      "Pair with browser_click using target_type=\"role\" or target_type=\"label\" for robust " +
      "interaction. Supports `selector` to scope to a subtree, `max_depth` to cut tokens, and " +
      "`format` ('yaml' compact by default, 'json' raw).",
    inputSchema: snapshotSchema,
    makeHandler: makeSnapshotHandler,
  },
  {
    name: "browser_expect",
    description:
      "Assert a condition on the current page. Retries up to `timeout_ms` before failing, " +
      "so you don't need a separate browser_wait for flaky conditions. Supports element " +
      "state (visible/hidden/enabled/disabled), text (text_equals / text_contains / text_matches), " +
      "form input (value_equals), element count, page URL / title. Returns PASS or FAIL with " +
      "both expected and actual values in the error body.",
    inputSchema: expectSchema,
    makeHandler: makeExpectHandler,
  },
  {
    name: "browser_permissions",
    description:
      "Grant (or clear) browser permissions like camera, microphone, geolocation, notifications, " +
      "clipboard read/write. Use before navigating to a site that will prompt the user. " +
      "`grant: \"all\"` grants every supported permission; `\"none\"` clears all grants; " +
      "an array picks specific ones. Applies to the current tab's origin by default.",
    inputSchema: permissionsSchema,
    makeHandler: makePermissionsHandler,
  },
  {
    name: "browser_save",
    description:
      "Save the current page to disk. Formats: 'pdf' (Chromium's print-to-PDF, headless only), " +
      "'mhtml' (single-file archive with all resources inlined — excellent for offline analysis), " +
      "or 'html' (raw page HTML). Parent directories are created automatically.",
    inputSchema: saveSchema,
    makeHandler: makeSaveHandler,
  },
  {
    name: "browser_upload",
    description:
      "Upload one or more files to an <input type=\"file\"> element. Paths are validated to " +
      "exist before the call is made. For <input multiple>, pass several files; otherwise one. " +
      "Locator strategies: selector (CSS), label (<label>-associated), testid (data-testid).",
    inputSchema: uploadSchema,
    makeHandler: makeUploadHandler,
  },
  {
    name: "browser_download_wait",
    description:
      "Trigger a download and capture the resulting file. action='click' clicks a button/link; " +
      "action='navigate' sends the tab to a direct download URL. The file is saved to `save_to`; " +
      "if that ends with '/' or is an existing directory, the server-suggested filename is used.",
    inputSchema: downloadSchema,
    makeHandler: makeDownloadHandler,
  },
  {
    name: "browser_cookies",
    description:
      "Read, write, or clear cookies in the current browser profile. action='get' returns a list " +
      "(optionally scoped to URLs). action='set' adds/updates cookies from the `cookies` array — " +
      "each entry needs either (domain+path) or a single url. action='clear' wipes all cookies.",
    inputSchema: cookiesSchema,
    makeHandler: makeCookiesHandler,
  },
  {
    name: "browser_network_log",
    description:
      "Inspect recent network requests (ring buffer of last 500 across all tabs in the profile). " +
      "Filter by tab_id, URL regex, HTTP method, min_status (e.g. 400 for errors only), or " +
      "failed_only. Each entry shows time, status, method, URL, resource type, and duration. " +
      "Useful to debug SPA behaviour: what API calls fired, what failed, what returned 4xx/5xx.",
    inputSchema: networkSchema,
    makeHandler: makeNetworkHandler,
  },
  {
    name: "browser_console_log",
    description:
      "Inspect recent browser console output (ring buffer of last 500 across all tabs in the profile): " +
      "console.log/info/warn/error/debug plus uncaught page errors (level 'pageerror'). " +
      "Filter by tab_id, level, or text_regex. Great for debugging SPA errors the UI swallowed.",
    inputSchema: consoleSchema,
    makeHandler: makeConsoleHandler,
  },
  {
    name: "browser_network_body",
    description:
      "Return a captured HTTP response body (what an XHR/fetch returned). Only small texty/JSON " +
      "responses are captured (last 50, size-capped). Filter by url_regex and method; index counts " +
      "back from the most recent match (0 = latest).",
    inputSchema: networkBodySchema,
    makeHandler: makeNetworkBodyHandler,
  },
  {
    name: "browser_storage",
    description:
      "Read/write the active tab's localStorage or sessionStorage (per-origin). action=get returns a " +
      "key (or all keys), set writes key+value, remove deletes a key, clear wipes the store. " +
      "localStorage persists in the named profile.",
    inputSchema: storageSchema,
    makeHandler: makeStorageHandler,
  },
  {
    name: "browser_handle_dialog",
    description:
      "Set how the next native dialog (alert/confirm/prompt) is handled — call this BEFORE the action " +
      "that triggers it. action=accept (OK) or dismiss (Cancel); prompt_text fills a prompt; persist=true " +
      "applies to all dialogs. Without this, dialogs are auto-dismissed.",
    inputSchema: dialogSchema,
    makeHandler: makeDialogHandler,
  },
  {
    name: "browser_set_geolocation",
    description:
      "Set the emulated geolocation coordinates for the browser context. Pair with browser_permissions " +
      "(grant 'geolocation') so the page's navigator.geolocation can read them.",
    inputSchema: geolocationSchema,
    makeHandler: makeGeolocationHandler,
  },
  {
    name: "browser_configure",
    description:
      "Change browser settings at runtime. All parameters are optional — pass only what you want to change. Viewport and color_scheme apply to the current (or specified) tab. User-agent and locale apply to the whole browser context (all tabs).",
    inputSchema: configureSchema,
    makeHandler: makeConfigureHandler,
  },
];
