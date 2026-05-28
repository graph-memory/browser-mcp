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
