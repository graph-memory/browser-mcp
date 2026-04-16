# browser-mcp

MCP server that gives Claude (or any MCP client) a full browser — open pages, read content, click, type, scroll, take screenshots, and manage tabs. Powered by Playwright with stealth mode and a persistent cookie/localStorage profile.

> **Disclaimer:** This tool automates browser interactions and may violate the terms of service or acceptable use policies of websites it accesses. You are solely responsible for how you use it and which sites you interact with. The authors assume no liability for any consequences arising from its use.

## Quick start

```bash
npm install
npm run build
npm start        # listens on http://127.0.0.1:7777/mcp
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

## Tools

### `browser_open`

Open a URL in a new tab, or navigate an existing tab if `tab_id` is given. Waits for DOMContentLoaded plus a short network-idle settle. Does **not** return page content — call `browser_read` afterwards. Returns HTTP status, final URL, title, and tab_id.

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
| `limit` | integer (1–50) | no | `10` | Maximum number of matches to return |
| `tab_id` | string | no | active tab | Tab to search in |

### `browser_click`

Click an element. Pass the visible label to click by text (preferred — less fragile), or a CSS selector if there is no unique text. Waits for navigation/network-idle after the click.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | yes | Visible text of the element (e.g. `"Sign in"`). Falls back to CSS selector if no text match is found |
| `tab_id` | string | no | Tab to act on; defaults to the active tab |

### `browser_type`

Fill a CSS-selected input/textarea with text. If `submit=true`, presses Enter after typing (e.g. to submit a form). Uses fill semantics — existing value is replaced.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `selector` | string | yes | — | CSS selector of the input/textarea/contenteditable to fill |
| `text` | string | yes | — | Text to type. Existing value is replaced |
| `submit` | boolean | no | `false` | Press Enter after typing |
| `tab_id` | string | no | active tab | Tab to act on |

### `browser_scroll`

Scroll the current tab. `up`/`down` scroll by `amount` pixels; `top`/`bottom` jump to the page edges.

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

### `browser_tabs_list`

List all open tabs with their `tab_id`, title, and URL. No parameters.

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

Take a PNG screenshot of the current tab. Default: viewport (1280x900). `full_page=true` captures the entire scrollable page.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `full_page` | boolean | no | `false` | `false`: viewport only. `true`: entire scrollable page |
| `tab_id` | string | no | active tab | Tab to capture |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROWSER_MCP_PORT` | `7777` | HTTP port |
| `BROWSER_MCP_HOST` | `127.0.0.1` | Bind address |
| `BROWSER_MCP_STEALTH` | `1` | Enable stealth plugin (`0` to disable) |
| `BROWSER_MCP_CHANNEL` | `chrome` | Chromium channel (`chrome`, `msedge`, etc.) |
| `BROWSER_MCP_HEADLESS` | `1` | Run headless (`0` for visible) |
| `BROWSER_MCP_TAB_TTL_SEC` | `600` | Auto-close inactive tabs after N seconds |
| `BROWSER_MCP_MAX_CHARS` | `50000` | Max characters returned by `browser_read` |

## How it works

- Uses Playwright with a **persistent browser profile** at `~/.browser-mcp/profile` — cookies and localStorage survive restarts
- **Stealth mode** via `playwright-extra` + `puppeteer-extra-plugin-stealth` to avoid bot detection
- `browser_read` with `mode=markdown` runs Mozilla Readability to extract the main article, then converts to Markdown via Turndown
- Inactive tabs are automatically closed after the TTL expires (default 10 min)
- `browser_open_visible` shuts down the headless browser and reopens in a visible window for manual interaction (login, CAPTCHA); closing the window returns to headless mode

## Development

```bash
npm run dev      # run with tsx (no build step)
npm run build    # compile TypeScript to dist/
```

## License

[Elastic License 2.0 (ELv2)](LICENSE)
