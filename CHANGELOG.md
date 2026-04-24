# Changelog

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
