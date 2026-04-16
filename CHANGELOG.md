# Changelog

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
