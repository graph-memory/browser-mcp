# Changelog

## 0.4.0 — Chromium launch-arg passthrough + timezone emulation

Three additive launch knobs for fingerprint / anti-bot tuning, all off by
default (empty = no change to current behavior):

- **`--args` / `BROWSER_MCP_ARGS`** — extra Chromium launch args appended to
  Playwright's defaults, whitespace-separated (comma-bearing args like
  `--disable-features=A,B` stay intact). E.g.
  `--args "--disable-blink-features=AutomationControlled"`.
- **`--ignore-default-args` / `BROWSER_MCP_IGNORE_DEFAULT_ARGS`** — named
  Playwright default launch args to drop (e.g. `--enable-automation`).
- **`--timezone` / `BROWSER_MCP_TIMEZONE`** — emulated IANA timezone
  (`timezoneId`), so a proxied session reports a timezone consistent with the
  exit IP's geo instead of leaking the host's.

All three feed `launchPersistentContext`. New exported `list()` config helper
(whitespace-split) with unit tests.

**Dependencies:** playwright `1.60 → 1.61.1` (bump the Docker base image tag in
lockstep — it pins the bundled browser revision); `nanoid`, `tsx`, `@types/node`
patch bumps.

## 0.3.0 — Stateless REST API + OpenAPI, 11 new tools, per-session state, configurable resources

**36 tools (25 → 36).** A second HTTP surface — `/api/v1/*` — exposes the
same tools as plain JSON POST so scripts in any language can drive the same
live browser an MCP agent uses, with **structured JSON** (not LLM-formatted
text) on the wire. An OpenAPI 3.1 spec is generated from the tool registry;
a Node JS/TS client lives in a new companion workspace package. 11 new MCP
tools, 2 tool extensions, per-session active-tab + snapshot store, several
operational knobs exposed, security hardening, and a small breaking change
to locator defaults. 470 tests across 48 files.

### New tools (11)

- **`browser_press`** — press a key or chord (`Enter`, `Control+A`,
  `Meta+C`). With `target`, focuses that element first; otherwise sends to
  the page.
- **`browser_hover`** — hover an element to reveal menus / tooltips /
  hover-only controls. Same locator strategies as `browser_click`.
- **`browser_select_option`** — pick option(s) in a native `<select>` by
  `value` (default), visible `label`, or zero-based `index`. Works for
  `<select multiple>`.
- **`browser_check`** — set a checkbox / radio idempotently (unlike `click`
  which toggles): `checked: true|false` ensures the target state.
- **`browser_drag`** — HTML5 drag-and-drop. Specify `source` and `target`
  with their own locator strategies.
- **`browser_fill_form`** — batch-fill multiple fields in one call (`fields`
  applied in order; each sets exactly one of `value` / `checked` /
  `options`). Aborts on the first failing field and reports which.
- **`browser_storage`** — get / set / remove / clear keys in the active
  tab's `localStorage` or `sessionStorage`. localStorage persists in the
  named profile.
- **`browser_handle_dialog`** — set policy for the next native dialog
  (`alert` / `confirm` / `prompt`) before triggering it. Without this,
  dialogs are auto-dismissed.
- **`browser_set_geolocation`** — set emulated coordinates (pair with
  `browser_permissions` to grant `geolocation`).
- **`browser_console_log`** — inspect recent browser console output (ring
  buffer of last 500 per profile): `console.log/info/warn/error/debug` plus
  uncaught page errors (level `pageerror`). Filter by `tab_id`, `level`,
  `text_regex`.
- **`browser_network_body`** — return a captured HTTP response body. Texty /
  JSON only, last 50, size-capped. Filter by `url_regex` + `method`;
  `index` counts back from the most recent match.

### Extended tools (2)

- **`browser_wait`** gains a `condition` mode — polls a JS expression via
  `page.waitForFunction` (mutually exclusive with `selector` / `state`).
  Lets you wait for `window.__ready === true` etc.
- **`browser_configure`** gains `extra_headers: Record<string,string>` —
  merged into `context.setExtraHTTPHeaders` (in addition to internal UA /
  Accept-Language).

### Stateless REST API (`/api/v1`)

A second HTTP surface beside `/mcp`. Every call is an independent POST;
no session handshake. `?profile=<name>` selects which shared live browser
to drive — the **same profile** an MCP agent uses → same cookies, tabs,
and network log. Pass `tab_id` in the body to target a specific tab.

- `POST /api/v1/tools/<tool>?profile=<name>` — run a tool; body = same JSON
  args as the MCP tool.
- `GET  /api/v1/tools` — discovery (names + descriptions).
- `GET  /api/v1/openapi.json` — OpenAPI 3.1 spec served live (auth-gated).
- `DELETE /api/v1/profiles/<name>` — release a profile holder (the browser
  is shut down only if no MCP session still holds it; ref-count).

**Response envelope** — HTTP status reflects the *transport* layer only:

```jsonc
// 200 — success
{ "ok": true, "data": { /* structured object, shape per tool */ },
  "content": [{ "type": "text", "text": "…" }] }
// 200 — tool-level failure (mirrors how MCP carries tool errors inside 200)
{ "ok": false, "error": { "message": "FAIL …" },
  "data": { /* tool-specific failure shape */ }, "content": [ … ] }
```

Non-2xx is reserved for transport problems: **400** invalid args (zod
`issues` included) or bad profile, **401** missing/invalid Bearer, **403**
Origin not allowed, **404** unknown tool, **415** non-JSON body, **503**
session cap reached. The same auth / Origin / Content-Type / body-size
guards and the `max_sessions` cap apply to `/api` as to `/mcp` (shared
gate).

Internally the REST side is sessionless to the caller but keeps one
**in-memory profile holder** per profile (one entry in the shared sessions
map, keyed `rest:<profile>`) that reuses the shared `BrowserManager` and a
per-tool handler cache. The holder is created synchronously on first call
— no `await` between `sessions.get` and `sessions.set` — so two concurrent
first-touch calls can't race-spawn two managers on one profile dir. Reaped
on the same `session_ttl` as MCP sessions.

### OpenAPI 3.1

`src/openapi.ts` derives the spec from the tool registry using zod v4's
native `z.toJSONSchema` (one POST path per tool, `io: "input"` semantics,
`$schema` dialect marker stripped). Cross-field `.refine` constraints
(`browser_cookies` "url OR domain+path", `browser_fill_form` "exactly one
of value/checked/options") don't serialise to JSON Schema — they live in
each tool's `description` and are enforced server-side with a 400 on
violation. Per-tool **output** schemas are not in v1 (the `data` channel
is generic). The spec is served live and also emitted as a static
`apps/browser-mcp/openapi.json` artifact (`npm run openapi`) so clients
can codegen without running the server.

### JS/TS client — `@graphmemory/browser-client` 0.1.0

A new workspace package at `packages/browser-client-js/`. Zero runtime
dependencies (uses the global `fetch`, Node 18+). Generic
`tool<Name>(name, args, { profile? })` is type-checked end-to-end against
the OpenAPI spec — misspelled tool names and bad arguments fail at compile
time — and ergonomic shortcuts (`open` / `read` / `click` / `type` /
`snapshot` / `evaluate` / `tabsList`) derive their `opts` types from the
same schema. `listTools()`, `openapi()`, and `releaseProfile()` round out
the surface. Argument types are generated with `openapi-typescript`
(devDep only, committed under `src/generated/openapi.ts`). Tool-level
failures resolve with `{ ok: false }`; transport failures (4xx/5xx) throw
`BrowserClientError` carrying `.status` and `.body`.

### Structured `data` channel on tool handlers

`ToolResult` gains an optional `data?: unknown`. Data-returning handlers
now attach the structured object they already compute — `browser_read`
→ `{ url, mode, content }`; `browser_network_log` / `browser_console_log`
→ `{ entries, total }`; `browser_tabs_list` → `{ tabs, active }`;
`browser_snapshot` → `{ snapshot }` or `{ diff }`;
`browser_open` / `back` / `forward` / `reload` → the `TabInfo`;
`browser_expect` → `{ ok, assertion, expected, actual }`;
`browser_evaluate` → `{ result }`; cookies/storage/network-body etc. The
MCP transport ignores the extra field (no behaviour change for agents);
the REST layer returns it as the response `data`.

### Per-session state (active tab + snapshot store)

`BrowserManager` (per profile, shared) now owns only the shared resources
— `BrowserContext`, tabs, cookies, netLog / console / body rings. Each MCP
client and the REST profile holder get a thin **`BrowserSession`** facade
(`src/browser-session.ts`) with their own `currentTabId` and named-snapshot
store. Two concurrent agents on the same profile no longer clobber each
other's "current tab"; `store_as` / `diff_against` are isolated per
session. A stale active tab — one closed by another session or reaped by
the TTL sweeper — self-heals to a clean "No active tab. Call browser_open
first." rather than "Tab ... not found".

### Configurable resources (Tier 1–3)

Knobs that used to be hard-coded, all env-only:

| Env | Default | What |
|---|---|---|
| `BROWSER_MCP_ACTION_TIMEOUT_MS` | `10000` | Per-action Playwright timeout (click/type/press/hover/select/check/drag). |
| `BROWSER_MCP_NAV_TIMEOUT_MS`    | `30000` | `page.goto` / navigation timeout. |
| `BROWSER_MCP_NET_RING`          | `500`   | Network log ring capacity per profile. |
| `BROWSER_MCP_CONSOLE_RING`      | `500`   | Console log ring capacity per profile. |
| `BROWSER_MCP_BODY_RING`         | `50`    | Captured-response-body ring capacity per profile. |
| `BROWSER_MCP_BODY_MAX_BYTES`    | `262144` | Max bytes per captured response body. |
| `BROWSER_MCP_MAX_REQUEST_BYTES` | `1048576` | Max accepted HTTP request body (raising this **weakens** the guard). |

The `network_log` / `console_log` `limit` zod caps are coupled to their
ring sizes so a client can't ask for more than the ring can hold.

### Security

- **Log redaction extended** to the new tools:
  `browser_fill_form.fields[].value`, `browser_configure.extra_headers`
  (values), `browser_storage.value`, `browser_handle_dialog.prompt_text`.
- **Passive response-body capture opt-out.** `browser_network_body`
  captures small texty/JSON bodies passively (≤256 KiB by default, ring of
  50). Set `BROWSER_MCP_BODY_RING=0` to disable capture entirely.
- **Storage output capped** at `BROWSER_MCP_MAX_CHARS` so a huge
  localStorage doesn't blow up an MCP response.
- **`/api` covered by the shared guard gate** — same auth (Bearer +
  timing-safe), Origin allowlist, Content-Type, body-size, and
  `max_sessions` cap as `/mcp`. `insecureStartupProblem()` now mentions
  `/api` too.
- **Transitive vuln patches** via lockfile-only `npm audit fix`
  (fast-uri 3.1.0 → 3.1.2 high; hono / qs / ip-address /
  express-rate-limit moderate). No package.json bumps.

### HTTP + session lifecycle

- **`Session` discriminated union** (`{ kind: "mcp", server, transport, …
  } | { kind: "rest", view, handlers, … }`); `cleanupSession` and
  `shutdownApp` branch on `kind` so the REST holder's lack of
  transport/server is honest in the lifecycle. Both kinds share
  `max_sessions` and the 60 s reaper interval; the browser is shut down
  only when no entry of either kind still references the profile.
- **Single tool registry.** `src/registry.ts` exports `TOOLS: ToolDef[]` as
  the source of truth for both MCP `buildServer` and REST `runTool`.
  Adding a tool is one edit in one place.
- **Bounded shutdown.** `BrowserContext.close()` in `shutdown()` is now
  raced with an 8 s timeout so a wedged Chromium can't hang the
  supervisor's SIGTERM path or test teardown.

### Quality + fixes

- **`browser_cookies set` validates each entry** has either `url` or both
  `domain` and `path` (zod `.refine` at the array element); returns
  `isError` (400 on REST) instead of letting Playwright complain
  cryptically.
- **`browser_scroll` reports "page fits viewport"** instead of "100%" when
  the content is shorter than the viewport — distinguishes "scrolled to
  bottom of a long page" from "nothing to scroll".
- **Validation failures return `isError`**, not thrown exceptions, for
  `type` / `download_wait` / `cookies set` / `upload` — uniform error
  shape across tools, matches what the MCP SDK expects.
- **Sandbox path descriptions corrected** in tool docs (`browser_save`,
  `browser_download_wait`, `browser_upload`) — the example paths now
  match the actual sandbox roots.
- **Dropped dead `cookies.tab_id`** parameter; **viewport dims required as
  a pair** (width and height) — schemas tightened.

### Tests

- **470 tests across 48 files** (was 361 / 31). Phase additions: a tool
  registry test (names + shape), pure `runTool` status-mapping unit, an
  OpenAPI generator unit (all 36 schemas convert), full REST surface
  integration (happy path / 400 / 404 / 405 / lifecycle / cross-surface
  ref-count / OpenAPI endpoint), a dedicated REST guards file (401 / 415
  / 403 / 503), per-tool structured-`data` assertions in the mock-handler
  suite, and BrowserSession delegation tests.
- **Coverage** (`vitest.config.ts` thresholds 90 / 85 / 80 / 90): current
  92.1 / 85.8 / 89.1 / 93.9.
- `vitest.config.ts` migrated to top-level `maxWorkers: 4` (Vitest 4
  deprecated `poolOptions.forks.maxForks`); CI gained step-level timeouts
  so a wedged `npx playwright install` can't run for hours.

### Repo layout

- Converted to an **npm workspace.** The server now lives under
  `apps/browser-mcp/`; the JS client and any future shared packages under
  `packages/` (currently `packages/browser-client-js/`). Root-level
  scripts delegate into the app with `-w`, so `npm run build` /
  `npm test` still work from the repo root.

### Docs

- New **REST API (for scripts)** section in the README: model, endpoints
  table, response envelope, status codes, curl + JS examples, limitations.
- Architecture section documents the two-surface model: the single tool
  registry, the shared `BrowserManager` + ref-count across MCP and REST,
  the per-profile REST holder lifecycle, and the shared guard gate.
- Companion client README with a tool catalogue grouped by purpose, a
  typed-surface example showing tsc catching misspellings, and
  instructions to regenerate types when the server adds a tool.
- Tools reference gained a **Locator conventions** subsection explicitly
  documenting the per-tool divergences (form tools default to `label`;
  `upload` uses a narrower set; `drag` has `source_` / `target_` prefixes;
  `download` lacks `exact`).
- README counts kept in sync (tools, tests, files).

### Breaking changes

- **`target_type` default unified to `text`.** `browser_type`,
  `browser_expect`, and `browser_download_wait` previously required (or
  defaulted to) a different locator type. They now default to `text` like
  `browser_click` — pass an explicit `target_type: "selector"` (or `role`,
  `label`, …) if you were relying on the old behaviour.
- **Legacy `selector` alias removed from `browser_type`.** The deprecated
  `selector` parameter — a stand-in for `target` when `target_type` was
  unset — is gone. `target` is now required.

The MCP wire surface itself stays additive otherwise — every 0.2.0 client
keeps working without changes outside the locator-default tweak above.

### Companion package

- **`@graphmemory/browser-client` 0.1.0** — new workspace package at
  `packages/browser-client-js/`. Initial release; separately versioned.

---

## 0.2.0 — Accessibility snapshots, 7 new tools, security hardening, full test suite

**25 tools total (18 → 25).** Accessibility-tree snapshots via CDP, role-
and label-based locators, assertions with retry, file IO, network inspection,
cookies, permissions. Security defaults tightened across the board. Full
vitest harness with 361 tests.

### New tools (7)

- **`browser_snapshot`** — accessibility-tree snapshot of the page via Chrome
  DevTools Protocol. Returns a compact YAML-ish tree of semantic elements
  (role, name, value, state). More reliable than Markdown on SPAs. Supports
  `selector` to scope a subtree, `max_depth`, `compact` (strip decorative /
  landmark-only nodes), `store_as` + `diff_against` for before/after diffs
  with `added` / `removed` / `changed` lists.
- **`browser_expect`** — assert a condition on the page with retry up to
  `timeout_ms` (no separate `browser_wait` needed). 13 assertions:
  `visible`, `hidden`, `enabled`, `disabled`, `text_equals`, `text_contains`,
  `text_matches`, `value_equals`, `count`, `url_equals`, `url_matches`,
  `title_equals`, `title_matches`.
- **`browser_permissions`** — grant or clear browser permissions (camera,
  microphone, geolocation, notifications, clipboard r/w, payment-handler,
  etc.) per-origin or globally, before the browser would otherwise prompt.
- **`browser_save`** — save the current page as `pdf` (headless only),
  `mhtml` (single-file archive), or `html`. Parent directories created
  automatically.
- **`browser_upload`** — attach one or more files to `<input type="file">`,
  including multi-file inputs. Paths validated before the call.
- **`browser_download_wait`** — trigger a download via click or navigation
  and capture the resulting file to disk; server-suggested filename when
  `save_to` ends with `/`.
- **`browser_cookies`** — read / write / clear cookies in the browser
  profile. `get` lists (optionally scoped to URLs), `set` adds from an
  array, `clear` wipes all.
- **`browser_network_log`** — inspect recent requests (ring buffer of last
  500 per profile, across tabs). Filter by `tab_id`, `url_regex`, `method`,
  `min_status`, `failed_only`.

### Role- and label-based locators

`browser_click`, `browser_type`, `browser_expect`, `browser_download_wait`
all accept `target_type: role | label | text | placeholder | testid |
selector`. Playwright's role / label / placeholder / testid APIs are
preferred over CSS selectors — robust against markup changes. Full ARIA
role list validated at the schema level.

### Accessibility snapshot pipeline

- CDP-based (`Accessibility.enable` + `getFullAXTree` / `getPartialAXTree`)
  because Playwright 1.40+ removed `page.accessibility.snapshot()`.
- Noise filter: drops `InlineTextBox`, hoists ignored nodes' children.
- Post-pass: anonymous `listitem` / `cell` containers inherit their
  StaticText children as their `name` so they can be distinguished and
  diffed. Redundant StaticText children that duplicate the parent's name
  are collapsed.
- Compact mode: keeps only interactive roles (button, link, textbox,
  checkbox, option, menuitem, …) plus structural landmarks (heading,
  navigation, main, form, dialog, list, listitem, table, row, cell, …).
- Diff: path-based signature per node (role + name, value excluded so that
  textbox edits register as `changed` rather than remove+add). Siblings
  sharing the same signature lose ordering — best for "I clicked X, what
  appeared" use cases.

### `browser_read` — compact mode

New `compact` flag strips `nav`, `header`, `footer`, `aside`, `script`,
`style`, `svg`, `iframe`, and ARIA landmark chrome (`banner`, `navigation`,
`contentinfo`, `complementary`, `search`) before rendering. Defaults on for
`text` / `html` modes (they'd otherwise return boilerplate), off for
`markdown` (Readability already extracts the article). Helpful for
dashboards / SPAs where Readability bails out.

### HTTP + session lifecycle

- **App factory split.** Extracted `src/app.ts` exporting `createApp()` +
  `insecureStartupProblem()`. `src/index.ts` is now a thin bootstrap
  (listen + SIGINT). Enables end-to-end HTTP testing without side effects.
- **Session cap.** Hard limit on concurrent MCP sessions
  (`BROWSER_MCP_MAX_SESSIONS`, default 50). 503 on overflow.
- **Session reaper.** Idle sessions closed after
  `BROWSER_MCP_SESSION_TTL_SEC` (30 min default).
- **Multi-profile URL routing.** `/mcp/<profile>` creates / reuses a
  dedicated browser. Multiple sessions on the same profile share one
  `BrowserContext`; it shuts down when the last session expires.
- **Network ring buffer** in `BrowserManager` (capacity 500 per profile)
  fed by page `request` / `requestfinished` / `requestfailed` listeners.
- **Tab TTL.** Inactive tabs auto-closed after `BROWSER_MCP_TAB_TTL_SEC`
  (10 min default); currently-active tab spared.

### Security hardening

- **Refuse-to-start insecure.** Non-loopback bind without API key exits
  with code 2 and a loud error. Override with `--allow-insecure`.
- **CSRF defense.** POSTs must carry `Content-Type: application/json`;
  `Origin` header must match `BROWSER_MCP_CORS_ORIGIN` allowlist (default
  **empty** — only requests without `Origin`, i.e. native clients, allowed).
- **Origin: `null` fix.** Changed default allowlist from `"null"` to empty.
  Sandboxed iframes and `file://` pages send the literal string
  `Origin: null`, which previously bypassed CSRF on loopback without auth.
- **Timing-safe auth.** Bearer token compared with
  `crypto.timingSafeEqual`.
- **Body cap + slow-loris guard.** 1 MiB max body size; full body must
  arrive within 10 s (`BROWSER_MCP_READ_BODY_TIMEOUT_MS`).
- **URL allowlist** (`src/lib/url-safety.ts`) on `browser_open`,
  `browser_download_wait` (action=navigate), `browser_permissions` —
  rejects `file://`, `javascript:`, `data:`, `chrome:`, `view-source:`,
  `ftp:`, and private / loopback / link-local / ULA IPs. Opt-in via
  `BROWSER_MCP_ALLOW_FILE_URLS` and
  `BROWSER_MCP_ALLOW_PRIVATE_NETWORKS`.
- **Write sandbox** (`src/lib/path-sandbox.ts`) on `browser_save` and
  `browser_download_wait` — writes land in
  `~/.browser-mcp/downloads/<profile>/` by default. Opt-in
  `BROWSER_MCP_ALLOW_ANY_WRITE_PATH` disables the sandbox.
- **Upload sandbox** on `browser_upload` — reads from
  `~/.browser-mcp/uploads/<profile>/`. Opt-in
  `BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH` disables the sandbox.
- **`browser_evaluate` result cap.** Output truncated at
  `BROWSER_MCP_MAX_CHARS` (50 000 default) — a page returning a 1 GB array
  no longer OOMs the supervisor.
- **Log redaction.** `withLog` replaces sensitive fields
  (`browser_type.text`, `browser_cookies.cookies[].value`,
  `browser_evaluate.expression`, `browser_save.path`,
  `browser_download_wait.save_to`, `browser_upload.files`) with placeholder
  markers before writing to stderr.
- **Chromium env isolation.** `BROWSER_MCP_*` env vars filtered out before
  launch so page scripts can't fingerprint the supervisor configuration.

### Test suite

- vitest harness with `npm test` / `npm run test:watch` /
  `npm run test:coverage`.
- **361 tests across 31 files.** 17 unit files (pure helpers, AX-tree
  conversion, config, log, auth, netlog, locator routing, URL safety, path
  sandbox, log redaction, mock-driven tool edge cases, insecure-startup
  gate) + 14 integration files driving real headless Chromium against
  local HTML fixtures and an in-process HTTP test server.
- Coverage targets: 90% lines / 85% functions / 80% branches / 90%
  statements. Current: 93.6% / 85.6% / 85.4% / 91.9%. Ceiling is bounded by
  Playwright — code inside `page.evaluate(() => …)` runs in Chromium's V8
  and can't be instrumented by node-v8 coverage even when exercised
  end-to-end.

### Docker

- `tini` as PID 1 for zombie reaping when Chromium subprocesses die.
- Healthcheck via `/health` (Node `fetch` every 30 s).
- Docker-compose `BROWSER_MCP_API_KEY` is required (no fallback) — the
  image binds to `0.0.0.0` and the refuse-to-start guard fires without one.

### CI

- GitHub Actions `test` job runs the full suite with
  `npx playwright install --with-deps chromium` before `npm run
  test:coverage`. Coverage uploaded as a 14-day artifact.
- Publish workflow gated on the test suite so a broken tag can't ship.

### Docs

- README rewritten in the process-mcp style: Why / Quick start / Features /
  Tools reference / Configuration / Architecture / Security / Testing /
  Docker / Platform / Development / FAQ.
- Architecture section documents the HTTP layer, BrowserManager lifecycle,
  AX snapshot pipeline, diff algorithm, netlog ring, and shutdown sequence.

### Breaking changes

- **Default CORS origin changed from `"null"` to empty.** Clients that
  relied on `Origin: null` being accepted (sandboxed iframes, `file://`
  pages) must now opt in explicitly via
  `BROWSER_MCP_CORS_ORIGIN=null` — this is a documented CSRF vector and
  should only be enabled with an API key.
- **`browser_save` / `browser_download_wait` write sandbox.** Absolute
  paths outside `~/.browser-mcp/downloads/<profile>/` are rejected by
  default. Set `BROWSER_MCP_ALLOW_ANY_WRITE_PATH=1` to restore pre-0.2.0
  behaviour.
- **`browser_upload` read sandbox.** Files must live under
  `~/.browser-mcp/uploads/<profile>/` unless
  `BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH=1` is set.
- **`browser_open` URL allowlist.** `file://`, private IPs, and non-http(s)
  schemes are rejected unless `BROWSER_MCP_ALLOW_FILE_URLS=1` and/or
  `BROWSER_MCP_ALLOW_PRIVATE_NETWORKS=1` are set.

---

## 0.1.0 — Initial Release

MCP server that gives AI agents a full browser via the Model Context Protocol. Powered by Playwright with stealth mode and persistent profiles.

### Browser Tools (18 tools)

- **`browser_open`** — open URL in new tab or navigate existing tab, returns HTTP status/title/tab_id
- **`browser_read`** — extract page content as Markdown (via Readability + Turndown), plain text, or raw HTML
- **`browser_click`** — click by visible text (default) or CSS selector
- **`browser_type`** — fill inputs with text, optional Enter to submit
- **`browser_scroll`** — scroll up/down by pixels or jump to top/bottom
- **`browser_find`** — search visible text, returns snippets with CSS selectors for follow-up actions
- **`browser_wait`** — wait for element state (visible/hidden/attached/detached)
- **`browser_evaluate`** — execute arbitrary JavaScript in page context
- **`browser_back`** / **`browser_forward`** / **`browser_reload`** — history navigation
- **`browser_tabs_list`** / **`browser_tab_switch`** / **`browser_tab_close`** — tab management
- **`browser_screenshot`** — PNG screenshot, viewport or full page
- **`browser_open_visible`** — open visible Chrome window for manual login/CAPTCHA, cookies persist to profile
- **`browser_configure`** — change viewport, user-agent, locale, color scheme, device emulation at runtime

### Named Profiles

- URL-based profile isolation: `/mcp/profile-name` creates a separate browser with its own cookies/localStorage
- Profile names validated: `^[a-zA-Z0-9_-]{1,64}$`
- Multiple sessions on the same profile share one browser instance
- Browser shuts down automatically when last session expires

### Device Emulation

- **Device presets**: iphone-15, iphone-se, ipad, ipad-pro, pixel-8, galaxy-s24, desktop-retina
- **Viewport presets**: mobile (375x812), tablet (768x1024), desktop (1280x900), desktop-hd (1920x1080), desktop-2k (2560x1440)
- **User-Agent presets**: chrome-desktop, chrome-mobile, safari-desktop, safari-mobile, firefox-desktop
- Runtime color scheme emulation (light/dark)
- Device scale factor and mobile mode (with automatic context restart)

### Configuration

- CLI flags via commander with full `--help`
- Environment variables for all settings
- Priority: CLI flag > env var > default
- Key options: `--viewport`, `--device-scale-factor`, `--mobile`, `--user-agent`, `--locale`, `--color-scheme`, `--proxy`, `--api-key`

### Security

- Optional API key authentication via `--api-key` / `BROWSER_MCP_API_KEY` (Bearer token)
- Stealth mode via playwright-extra + puppeteer-extra-plugin-stealth (enabled by default)
- Proxy support with auth (HTTP, SOCKS5)

### Docker

- Production-ready Dockerfile based on node:24-slim
- Runs as non-root `browser` user
- Bundled Playwright Chromium (no external Chrome needed)
- docker-compose with persistent volume for browser profiles
- Multi-platform builds (amd64 + arm64)

### CI/CD

- GitHub Actions: build on push/PR, npm publish on tag, Docker image to ghcr.io
- npm provenance attestation
- Package: `@graphmemory/browser-mcp`

### Installation

```bash
npx @graphmemory/browser-mcp
# or
docker run -p 7777:7777 ghcr.io/graph-memory/browser-mcp:latest
```
