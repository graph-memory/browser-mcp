FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    # Playwright Chromium dependencies
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 libwayland-client0 \
    # Fonts
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
RUN npx playwright install chromium

COPY dist/ dist/

ENV BROWSER_MCP_HOST=0.0.0.0
ENV BROWSER_MCP_CHANNEL=chromium
EXPOSE 7777

ENTRYPOINT ["node", "dist/index.js"]
