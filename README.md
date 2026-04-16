# browser-mcp

MCP server that gives Claude (or any MCP client) a full browser — open pages, read content, click, type, scroll, take screenshots, manage tabs, and emulate devices. Powered by Playwright with stealth mode and persistent cookie/localStorage profiles.

> **Disclaimer:** This tool automates browser interactions and may violate the terms of service or acceptable use policies of websites it accesses. You are solely responsible for how you use it and which sites you interact with. The authors assume no liability for any consequences arising from its use.

## Quick start

```bash
npx @graphmemory/browser-mcp   # download, install Chromium, and start on http://127.0.0.1:7777/mcp
```

Or install globally:

```bash
npm install -g @graphmemory/browser-mcp
browser-mcp --port 8080 --api-key my-secret
```

From source:

```bash
git clone https://github.com/graph-memory/browser-mcp.git
cd browser-mcp
npm install
npm run build
npm start
```

### Claude Code config

Add to your MCP settings:

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

With API key authentication:

```json
{
  "mcpServers": {
    "browser": {
      "type": "http",
      "url": "http://127.0.0.1:7777/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-key"
      }
    }
  }
}
```

## Named profiles

Each MCP endpoint URL can include a profile name that isolates cookies, localStorage, and browser state:

```
http://127.0.0.1:7777/mcp            → "default" profile
http://127.0.0.1:7777/mcp/test1      → "test1" profile
http://127.0.0.1:7777/mcp/my-scraper → "my-scraper" profile
```

Profile names must match `^[a-zA-Z0-9_-]{1,64}$` (letters, digits, dashes, underscores; 1-64 chars).

Profiles are stored at `~/.browser-mcp/profiles/<name>/` (override base dir with `--profile-dir` or `BROWSER_MCP_PROFILE_DIR`).

Multiple MCP sessions on the same profile share one browser instance. When the last session on a profile expires, the browser shuts down automatically.

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

## CLI options

All settings follow the priority: **CLI flag > environment variable > default**.

```bash
browser-mcp [options]

Options:
  -p, --port <number>              HTTP port (default: 7777)
  -H, --host <address>             Bind address (default: 127.0.0.1)
  --headless                       Run in headless mode (default)
  --no-headless                    Run in visible mode
  --stealth                        Enable stealth plugin (default)
  --no-stealth                     Disable stealth plugin
  --channel <name>                 Chromium channel: chrome, msedge, etc. (default: chrome)
  --viewport <WxH>                 Default viewport size (default: 1280x900)
  --device-scale-factor <number>   Device pixel ratio, e.g. 2 for retina (default: 1)
  --mobile                         Enable mobile emulation (isMobile + hasTouch)
  --no-mobile                      Disable mobile emulation (default)
  --user-agent <string>            Default User-Agent string
  --locale <lang>                  Default Accept-Language locale, e.g. en-US
  --color-scheme <mode>            Default color scheme: light, dark, no-preference
  --javascript                     Enable JavaScript (default)
  --no-javascript                  Disable JavaScript
  --proxy <url>                    Proxy server URL
  --proxy-bypass <domains>         Comma-separated domains to bypass proxy
  --proxy-username <user>          Proxy auth username
  --proxy-password <pass>          Proxy auth password
  --max-chars <number>             Max characters returned by browser_read (default: 50000)
  --max-html-bytes <number>        Cap raw HTML size before parsing (default: 10000000)
  --tab-ttl <seconds>              Auto-close inactive tabs after N seconds (default: 600)
  --settle-ms <ms>                 Quiet-window duration for request-counting settle (default: 500)
  --settle-timeout-ms <ms>         Hard timeout for settle after navigation/click (default: 3000)
  --session-ttl <seconds>          Session TTL in seconds (default: 1800)
  --profile-dir <path>             Base directory for browser profiles (default: ~/.browser-mcp/profiles)
  --api-key <key>                  API key for Bearer token authentication
```

Example:

```bash
npm start -- --port 8080 --no-stealth --viewport 1920x1080 --device-scale-factor 2

# with authentication
npm start -- --api-key my-secret-key
# or
BROWSER_MCP_API_KEY=my-secret-key npm start
```

## Tools

### `browser_open`

Open a URL in a new tab, or navigate an existing tab if `tab_id` is given. Waits for DOMContentLoaded plus a short request-idle settle. Does **not** return page content — call `browser_read` afterwards. Returns HTTP status, final URL, title, and tab_id.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string (URL) | yes | Absolute URL to navigate to |
| `tab_id` | string | no | If set, navigate this existing tab instead of opening a new one |

### `browser_read`

Read the current (or specified) tab. `mode=markdown` (default) extracts the main article via Readability and returns Markdown. `mode=text` returns body innerText. `mode=html` returns raw HTML. Use `selector` to narrow to a specific element.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `mode` | `"markdown"` \| `"text"` \| `"html"` | no | `"markdown"` | Extraction mode |
| `selector` | string | no | — | CSS selector to narrow extraction to a specific element |
| `max_chars` | integer | no | `50000` | Cap output length in characters (overridable globally via `BROWSER_MCP_MAX_CHARS`) |
| `tab_id` | string | no | active tab | Tab to read from |

### `browser_find`

Find text occurrences on the current page. Returns up to `limit` snippets, each with surrounding context and a stable CSS selector suitable for `browser_click` / `browser_type`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Substring to search for in the page's visible text (case-insensitive) |
| `limit` | integer (1-50) | no | `10` | Maximum number of matches to return |
| `tab_id` | string | no | active tab | Tab to search in |

### `browser_click`

Click an element. By default matches visible text (`target_type="text"`, preferred). Set `target_type="selector"` to use a CSS selector. Waits for navigation/request-idle after the click.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `target` | string | yes | — | Visible text of the element (e.g. `"Sign in"`), or a CSS selector when `target_type="selector"` |
| `target_type` | `"text"` \| `"selector"` | no | `"text"` | How to interpret `target` |
| `tab_id` | string | no | active tab | Tab to act on |

### `browser_type`

Fill a CSS-selected input/textarea with text. If `submit=true`, presses Enter after typing (e.g. to submit a form). Uses fill semantics — existing value is replaced.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | string | yes | — | CSS selector of the input/textarea/contenteditable to fill |
| `text` | string | yes | — | Text to type. Existing value is replaced |
| `submit` | boolean | no | `false` | Press Enter after typing |
| `tab_id` | string | no | active tab | Tab to act on |

### `browser_scroll`

Scroll the current tab. `up`/`down` scroll by `amount` pixels; `top`/`bottom` jump to the page edges. Returns the scroll position (pixels, percentage) so the caller knows where on the page it is.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `direction` | `"up"` \| `"down"` \| `"top"` \| `"bottom"` | no | `"down"` | Scroll direction |
| `amount` | integer | no | `800` | Pixels to scroll when direction is `up`/`down` (ignored for `top`/`bottom`) |
| `tab_id` | string | no | active tab | Tab to act on |

### `browser_back`

Navigate back in the tab's history.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tab_id` | string | no | Tab to act on; defaults to the active tab |

### `browser_forward`

Navigate forward in the tab's history.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tab_id` | string | no | Tab to act on; defaults to the active tab |

### `browser_reload`

Reload the current page.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tab_id` | string | no | Tab to act on; defaults to the active tab |

### `browser_wait`

Wait for an element to reach a given state. Useful for SPAs that load content asynchronously.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | string | yes | — | CSS selector to wait for |
| `state` | `"visible"` \| `"hidden"` \| `"attached"` \| `"detached"` | no | `"visible"` | Element state to wait for |
| `timeout` | integer | no | `10000` | Max wait time in milliseconds |
| `tab_id` | string | no | active tab | Tab to act on |

### `browser_evaluate`

Execute a JavaScript expression in the page context and return the JSON-serialized result. Useful for reading `localStorage`, cookies, `window.__NEXT_DATA__`, or extracting data not visible in the DOM.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `expression` | string | yes | JavaScript expression to evaluate (must return a JSON-serializable value) |
| `tab_id` | string | no | Tab to act on; defaults to the active tab |

### `browser_tabs_list`

List all open tabs with their `tab_id`, title, and URL. The active tab is marked with `->`. No parameters.

### `browser_tab_switch`

Make the given tab the active one for subsequent tool calls.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tab_id` | string | yes | Tab to make active (from `browser_tabs_list`) |

### `browser_tab_close`

Close a tab by its ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tab_id` | string | yes | Tab to close |

### `browser_open_visible`

Open a URL in a **visible** (non-headless) Chrome window for manual interaction: signing in, solving a CAPTCHA, or inspecting a page. Cookies/localStorage are saved to the persistent profile. The user closes the window when done — subsequent tools return to the default headless mode.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string (URL) | yes | URL to open in the visible window |

### `browser_screenshot`

Take a PNG screenshot of the current tab. Default: viewport only. `full_page=true` captures the entire scrollable page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `full_page` | boolean | no | `false` | `false`: viewport only. `true`: entire scrollable page |
| `tab_id` | string | no | active tab | Tab to capture |

### `browser_configure`

Change browser settings at runtime. All parameters are optional — pass only what you want to change.

Some settings (viewport, color scheme, user-agent, locale) apply instantly without losing state. Others (device scale factor, mobile mode, device presets) require a browser context restart — **all open tabs are closed** and a warning is included in the response.

#### Per-tab settings (no restart)

| Parameter | Type | Description |
|-----------|------|-------------|
| `viewport_preset` | `"mobile"` \| `"tablet"` \| `"desktop"` \| `"desktop-hd"` \| `"desktop-2k"` | Viewport preset. Ignored if `viewport_width`/`viewport_height` or `device_preset` are set |
| `viewport_width` | integer | Custom viewport width. Must be set together with `viewport_height` |
| `viewport_height` | integer | Custom viewport height. Must be set together with `viewport_width` |
| `color_scheme` | `"light"` \| `"dark"` \| `"no-preference"` | Emulated `prefers-color-scheme` |
| `tab_id` | string | Tab to apply viewport/color_scheme to; defaults to active tab |

#### Context-wide settings (no restart)

| Parameter | Type | Description |
|-----------|------|-------------|
| `user_agent` | string | Custom User-Agent string. Overrides `ua_preset` |
| `ua_preset` | `"chrome-desktop"` \| `"chrome-mobile"` \| `"safari-desktop"` \| `"safari-mobile"` \| `"firefox-desktop"` | User-Agent preset. Ignored if `user_agent` or `device_preset` is set |
| `locale` | string | Accept-Language locale (e.g. `"en-US"`, `"ru-RU"`, `"ja-JP"`) |

#### Context-level settings (restart required)

| Parameter | Type | Description |
|-----------|------|-------------|
| `device_preset` | string | Full device emulation (see table below). Overrides viewport, scale, UA, mobile/touch |
| `device_scale_factor` | number | Device pixel ratio (e.g. `2` for retina, `3` for iPhone) |
| `is_mobile` | boolean | Enable mobile mode (`isMobile` + `hasTouch`) |

#### Device presets

| Preset | Viewport | Scale | Mobile | Touch |
|--------|----------|-------|--------|-------|
| `iphone-15` | 393x852 | 3x | yes | yes |
| `iphone-se` | 375x667 | 2x | yes | yes |
| `ipad` | 820x1180 | 2x | yes | yes |
| `ipad-pro` | 1024x1366 | 2x | yes | yes |
| `pixel-8` | 412x915 | 2.625x | yes | yes |
| `galaxy-s24` | 360x780 | 3x | yes | yes |
| `desktop-retina` | 1280x900 | 2x | no | no |

#### Viewport presets

| Preset | Size |
|--------|------|
| `mobile` | 375x812 |
| `tablet` | 768x1024 |
| `desktop` | 1280x900 |
| `desktop-hd` | 1920x1080 |
| `desktop-2k` | 2560x1440 |

## Environment variables

All environment variables can be overridden by CLI flags (CLI takes priority).

| Variable | Default | CLI flag | Description |
|----------|---------|----------|-------------|
| `BROWSER_MCP_PORT` | `7777` | `-p, --port` | HTTP port |
| `BROWSER_MCP_HOST` | `127.0.0.1` | `-H, --host` | Bind address |
| `BROWSER_MCP_STEALTH` | `1` | `--[no-]stealth` | Enable stealth plugin (`0` to disable) |
| `BROWSER_MCP_CHANNEL` | `chrome` | `--channel` | Chromium channel (`chrome`, `msedge`, etc.) |
| `BROWSER_MCP_HEADLESS` | `1` | `--[no-]headless` | Run headless (`0` for visible) |
| `BROWSER_MCP_VIEWPORT` | `1280x900` | `--viewport` | Default viewport size (WxH format) |
| `BROWSER_MCP_DEVICE_SCALE_FACTOR` | `1` | `--device-scale-factor` | Device pixel ratio |
| `BROWSER_MCP_MOBILE` | `0` | `--[no-]mobile` | Enable mobile emulation (`1` to enable) |
| `BROWSER_MCP_USER_AGENT` | — | `--user-agent` | Default User-Agent string |
| `BROWSER_MCP_LOCALE` | — | `--locale` | Default Accept-Language locale |
| `BROWSER_MCP_COLOR_SCHEME` | — | `--color-scheme` | Default color scheme (`light`, `dark`, `no-preference`) |
| `BROWSER_MCP_JAVASCRIPT` | `1` | `--[no-]javascript` | Enable JavaScript (`0` to disable) |
| `BROWSER_MCP_TAB_TTL_SEC` | `600` | `--tab-ttl` | Auto-close inactive tabs after N seconds |
| `BROWSER_MCP_MAX_CHARS` | `50000` | `--max-chars` | Max characters returned by `browser_read` |
| `BROWSER_MCP_MAX_HTML_BYTES` | `10000000` | `--max-html-bytes` | Cap raw HTML size before parsing (protects against OOM) |
| `BROWSER_MCP_SETTLE_MS` | `500` | `--settle-ms` | Quiet-window duration (ms) for request-counting settle |
| `BROWSER_MCP_SETTLE_TIMEOUT_MS` | `3000` | `--settle-timeout-ms` | Hard timeout (ms) for settle after navigation/click |
| `BROWSER_MCP_SESSION_TTL_SEC` | `1800` | `--session-ttl` | Session TTL in seconds |
| `BROWSER_MCP_PROFILE_DIR` | `~/.browser-mcp/profiles` | `--profile-dir` | Base directory for browser profiles |
| `BROWSER_MCP_API_KEY` | — | `--api-key` | API key for Bearer token authentication. If set, all requests must include `Authorization: Bearer <key>` header |
| `BROWSER_MCP_PROXY` | — | `--proxy` | Proxy server URL (e.g. `http://proxy:8080`, `socks5://proxy:1080`) |
| `BROWSER_MCP_PROXY_BYPASS` | — | `--proxy-bypass` | Comma-separated list of domains to bypass proxy |
| `BROWSER_MCP_PROXY_USERNAME` | — | `--proxy-username` | Proxy auth username |
| `BROWSER_MCP_PROXY_PASSWORD` | — | `--proxy-password` | Proxy auth password |

## How it works

- Uses Playwright with **persistent browser profiles** at `~/.browser-mcp/profiles/<name>/` — cookies and localStorage survive restarts
- Each URL path (`/mcp/<profile>`) maps to an isolated browser profile; `/mcp` uses the `default` profile
- Multiple MCP sessions on the same profile share one browser; the browser shuts down when the last session expires
- **Stealth mode** via `playwright-extra` + `puppeteer-extra-plugin-stealth` to avoid bot detection
- `browser_read` with `mode=markdown` runs Mozilla Readability to extract the main article, then converts to Markdown via Turndown
- `browser_configure` changes viewport, user-agent, locale, color scheme, and device emulation at runtime; context-level changes (device scale, mobile mode) trigger an automatic browser restart
- Inactive tabs are automatically closed after the TTL expires (default 10 min)
- Sessions expire after inactivity (default 30 min, configurable via `--session-ttl`)
- `browser_open_visible` shuts down the headless browser and reopens in a visible window for manual interaction (login, CAPTCHA); closing the window returns to headless mode
- Optional **API key authentication** via `--api-key` or `BROWSER_MCP_API_KEY` — when set, all requests must include `Authorization: Bearer <key>`
- Configuration priority: CLI flags > environment variables > defaults

## Docker

Run with Docker:

```bash
docker build -t browser-mcp .
docker run -p 7777:7777 browser-mcp
docker run -p 7777:7777 -e BROWSER_MCP_API_KEY=secret browser-mcp
```

Or with docker-compose:

```bash
docker compose up
# with API key
BROWSER_MCP_API_KEY=secret docker compose up
```

Pre-built images from GitHub Container Registry:

```bash
docker run -p 7777:7777 ghcr.io/graph-memory/browser-mcp:latest
```

The container runs Chromium as a dedicated non-root `browser` user. Browser profiles are persisted in a Docker volume (`browser`) at `/home/browser/.browser-mcp`. The image uses Playwright's bundled Chromium (`BROWSER_MCP_CHANNEL=chromium` is set automatically).

Note: `browser_open_visible` does not work in Docker (no display server). Use it only in local/desktop setups.

## CI/CD

The project includes GitHub Actions workflows:

- **CI** (`.github/workflows/ci.yml`) — builds on every push/PR to `main`, builds and verifies on Node 24
- **Publish** (`.github/workflows/publish.yml`) — publishes to npm on git tag `v*`. Requires `NPM_TOKEN` secret
- **Docker** (`.github/workflows/docker.yml`) — builds and pushes Docker image to `ghcr.io` on push to `main` and on tags

### Release process

```bash
# bump version
npm version patch   # or minor / major

# push with tag
git push && git push --tags
```

This triggers both npm publish and Docker image build automatically.

## Development

```bash
npm run dev      # run with tsx (no build step)
npm run build    # compile TypeScript to dist/
```

## License

[Elastic License 2.0 (ELv2)](LICENSE)
