# @graphmemory/browser-client

A tiny, **dependency-free** JS/TS client for the [browser-mcp](../../README.md) stateless
REST API (`/api/v1`). Drive the *same live browser* an MCP agent uses — from a plain Node script —
and get **structured JSON** back, without the MCP handshake.

Node 18+ (uses the global `fetch`). Targeted at server-side scripts; for browser-tab usage the
server needs a matching `--cors-origin` and CORS preflight support (not provided by default).

## Install

```bash
npm install @graphmemory/browser-client
```

## Usage

```ts
import { BrowserClient } from "@graphmemory/browser-client";

const b = new BrowserClient({
  baseUrl: "http://127.0.0.1:7777",
  apiKey: process.env.BROWSER_MCP_API_KEY, // only if the server requires auth
  profile: "work",                          // the shared browser to drive (default: "default")
});

// Ergonomic shortcuts for common tools:
const opened = await b.open("https://example.com");
console.log(opened.data);                   // structured TabInfo: { tab_id, url, title, status }

const page = await b.read({ mode: "markdown" });
console.log(page.data?.content);            // the article as Markdown (structured, not scraped text)

// Any tool by name (full surface) — args match the MCP tool schema:
const log = await b.tool("browser_network_log", { min_status: 400 });
console.log(log.data);                      // { entries: [...], total }
```

### Working alongside an agent

The client is **stateless**: each call is an independent POST. `profile` selects which shared
browser to drive — use the same profile name as the agent and you share its cookies, tabs, and
network log. Tabs are shared and addressable; pass an explicit `tab_id` to act on a specific one
(your "active tab" is independent of the agent's):

```ts
const { data } = await b.tool("browser_tabs_list", {});
const tabId = data.tabs[0].tab_id;
await b.read({ tab_id: tabId });
```

## Error handling

- **Tool-level outcomes** (a failed `browser_expect`, an element not found, …) resolve normally
  with `{ ok: false, error }` — HTTP is still 200.
- **Transport errors** (bad args → 400, auth → 401, unknown tool → 404, cap → 503) throw a
  `BrowserClientError` carrying `.status` and `.body`.

```ts
import { BrowserClientError } from "@graphmemory/browser-client";

const r = await b.tool("browser_expect", { assertion: "visible", target: "#x" });
if (!r.ok) console.warn("assertion failed:", r.error.message);

try {
  await b.open("not-a-url");
} catch (e) {
  if (e instanceof BrowserClientError) console.error(e.status, e.body);
}
```

## API

- `new BrowserClient({ baseUrl, apiKey?, profile?, fetch? })`
- `tool<Name>(name, args?, { profile? })` → `ToolEnvelope` — call any tool. Both the tool name and
  `args` are type-checked against the OpenAPI spec (see *Types* below).
- Shortcuts: `open(url, opts?)`, `read(opts?)`, `click(target, opts?)`, `type(target, text, opts?)`,
  `snapshot(opts?)`, `evaluate(expression, opts?)`, `tabsList(opts?)`. Each shortcut's `opts` type
  is derived from the same schema (e.g. `open` accepts `Omit<ToolArgs<"browser_open">, "url">`).
- `listTools()` → `{ tools: [{ name, description }] }`
- `openapi()` → the OpenAPI 3.1 document.
- `releaseProfile(profile?)` → proactively close a profile's browser (else it's reaped on idle TTL).

Errors: tool-level failures resolve with `{ ok: false }` (HTTP 200). Transport failures (400/401/
404/403/415/503) throw `BrowserClientError` with `.status` and `.body`.

## Tool catalogue

All 36 tools are reachable through `b.tool(name, args)`. Use `b.listTools()` for the live
catalogue with descriptions, or [`GET /api/v1/openapi.json`](../../apps/browser-mcp/openapi.json)
for parameter schemas. The [server README](../../README.md#tools-reference) has the full reference
with parameter tables.

**Navigation**
| Tool | Purpose |
|---|---|
| `browser_open` | Open a URL in a new tab (or navigate an existing tab). |
| `browser_back` / `browser_forward` / `browser_reload` | History navigation. |
| `browser_open_visible` | Open a URL in a visible window for manual interaction (sign-in, CAPTCHA). |
| `browser_scroll` | Scroll the current tab. |

**Reading content**
| Tool | Purpose |
|---|---|
| `browser_read` | Page as Markdown (default), text, or HTML; optional `selector` to scope. |
| `browser_snapshot` | Accessibility tree (compact YAML/JSON; supports diffing via `store_as`/`diff_against`). |
| `browser_find` | Search visible text; returns snippets + best-effort selectors. |
| `browser_evaluate` | Run a JS expression in the page; returns the JSON-serialized result. |

**Tabs**
| Tool | Purpose |
|---|---|
| `browser_tabs_list` | List open tabs. |
| `browser_tab_switch` | Make a tab active. |
| `browser_tab_close` | Close a tab. |

**Interacting**
| Tool | Purpose |
|---|---|
| `browser_click` | Click an element (locators: text/role/label/placeholder/testid/selector). |
| `browser_type` | Fill an input/textarea/contenteditable. |
| `browser_press` | Press a key or chord (`Enter`, `Control+A`, …). |
| `browser_hover` | Hover an element to reveal menus/tooltips. |
| `browser_select_option` | Select option(s) in a native `<select>` by value/label/index. |
| `browser_check` | Set a checkbox/radio (idempotent — unlike `click`). |
| `browser_drag` | HTML5 drag-and-drop. |
| `browser_fill_form` | Batch-fill multiple fields and optionally submit. |

**Waiting & asserting**
| Tool | Purpose |
|---|---|
| `browser_wait` | Wait for a selector state or a JS condition. |
| `browser_expect` | Assert a condition (visible/text/value/url/title/count); retries until timeout. |

**Capture & files**
| Tool | Purpose |
|---|---|
| `browser_screenshot` | PNG screenshot (viewport or full page); base64 in the `content` block. |
| `browser_save` | Save the page as PDF / MHTML / HTML to the **server's** filesystem. |
| `browser_upload` | Upload file(s) to an `<input type="file">` (paths on the server). |
| `browser_download_wait` | Trigger a download and capture the resulting file. |

**Browser state (per profile)**
| Tool | Purpose |
|---|---|
| `browser_cookies` | get / set / clear cookies in the profile. |
| `browser_storage` | localStorage / sessionStorage get / set / remove / clear. |

**Browser config & permissions**
| Tool | Purpose |
|---|---|
| `browser_configure` | Viewport, UA, locale, color scheme, mobile preset, extra HTTP headers, … |
| `browser_permissions` | Grant camera / microphone / geolocation / clipboard / notifications. |
| `browser_set_geolocation` | Set the emulated coordinates (pair with `browser_permissions`). |
| `browser_handle_dialog` | Policy for the next native `alert` / `confirm` / `prompt`. |

**Network & console inspection**
| Tool | Purpose |
|---|---|
| `browser_network_log` | Ring buffer of recent requests (filter by tab / URL regex / status / method). |
| `browser_console_log` | Ring buffer of `console.log/info/warn/error/debug` + `pageerror`. |
| `browser_network_body` | Captured response bodies (small JSON/text only, last 50). |

> Tools that operate on the **server's filesystem** (`browser_save`, `browser_upload`,
> `browser_download_wait`) read/write paths on the host running the daemon, not the script's
> machine — sandboxed by the same IO guards as the MCP surface.

## Types

Argument types are generated from the server's OpenAPI spec by `openapi-typescript` — committed
under `src/generated/openapi.ts`. The package exports:

- `ToolName` — the union of all 36 tool names.
- `ToolArgs<Name>` — the argument shape for a given tool, taken straight from the spec.

```ts
import type { ToolName, ToolArgs } from "@graphmemory/browser-client";
type OpenArgs = ToolArgs<"browser_open">;  // { url: string; tab_id?: string }
```

To regenerate after the server adds/changes a tool:

```bash
cd apps/browser-mcp && npm run openapi   # emits apps/browser-mcp/openapi.json
cd ../../packages/browser-client-js && npm run gen   # regenerates src/generated/openapi.ts
```
