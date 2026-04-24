FROM node:24-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src/ src/
RUN npm ci --ignore-scripts && npm run build

FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    # Playwright Chromium dependencies
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 libwayland-client0 \
    # Fonts
    fonts-liberation fonts-noto-color-emoji \
    # tini as PID 1 to reap any Chromium zombies left behind
    tini \
    # CA bundle for outbound HTTPS
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r browser && useradd -r -g browser -m -d /home/browser browser

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && chown -R browser:browser /app

USER browser

RUN npx playwright install chromium

COPY --from=build --chown=browser:browser /app/dist/ dist/

ENV BROWSER_MCP_HOST=0.0.0.0
ENV BROWSER_MCP_CHANNEL=chromium
EXPOSE 7777

# Unauthenticated access to /mcp on 0.0.0.0 = RCE-by-proxy. The server enforces
# the same check at startup and refuses to run without BROWSER_MCP_API_KEY
# (override with --allow-insecure if you really mean it).

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7777/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/index.js"]
