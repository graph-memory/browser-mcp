# browser-mcp

MCP server that gives Claude (or any MCP client) a full browser — open pages, read content, click, type, scroll, take screenshots, and manage tabs. Powered by Playwright with stealth mode and a persistent cookie/localStorage profile.

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

| Tool | Description |
|------|-------------|
| `browser_open` | Open a URL in a new tab or navigate an existing one |
| `browser_read` | Extract page content as markdown, text, or raw HTML |
| `browser_find` | Search for text on the page, returns snippets with CSS selectors |
| `browser_click` | Click by visible text (preferred) or CSS selector |
| `browser_type` | Fill an input/textarea; optionally submit with Enter |
| `browser_scroll` | Scroll up/down by pixels, or jump to top/bottom |
| `browser_back` | Navigate back |
| `browser_forward` | Navigate forward |
| `browser_reload` | Reload the current page |
| `browser_tabs_list` | List all open tabs |
| `browser_tab_switch` | Switch active tab |
| `browser_tab_close` | Close a tab |
| `browser_open_visible` | Open a non-headless window for manual login/CAPTCHA |
| `browser_screenshot` | Take a PNG screenshot (viewport or full page) |

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
