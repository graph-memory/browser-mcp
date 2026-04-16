import { chromium as vanillaChromium, type BrowserContext, type Page } from "playwright";
import { chromium as extraChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { nanoid } from "nanoid";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "./config.js";

const BASE_PROFILE_DIR = config.profileDir || join(homedir(), ".browser-mcp", "profiles");
const DEFAULT_PROFILE = "default";

if (config.stealth) extraChromium.use(StealthPlugin());
const chromium = config.stealth ? extraChromium : vanillaChromium;

const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function validateProfileName(name: string): string {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Must match ${PROFILE_NAME_RE} (1-64 chars, alphanumeric, dash, underscore).`,
    );
  }
  return name;
}

export type TabInfo = { tab_id: string; title: string; url: string; status?: number };

export class BrowserManager {
  private context: BrowserContext | null = null;
  private tabs = new Map<string, Page>();
  private pageToId = new Map<Page, string>();
  private lastUsed = new Map<string, number>();
  private currentTabId: string | null = null;
  private headless: boolean;
  private sweepTimer: NodeJS.Timeout | null = null;
  readonly profileName: string;
  readonly profileDir: string;

  constructor(profileName?: string) {
    this.profileName = profileName ? validateProfileName(profileName) : DEFAULT_PROFILE;
    this.profileDir = join(BASE_PROFILE_DIR, this.profileName);
    this.headless = config.headless;
  }

  // Overrides for context-level settings (applied on next ensureContext)
  private _overrides: {
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
    userAgent?: string;
    locale?: string;
    colorScheme?: "light" | "dark" | "no-preference";
  } = {};

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;

    const viewport = this._overrides.viewport ?? config.viewport;
    const deviceScaleFactor = this._overrides.deviceScaleFactor ?? config.deviceScaleFactor;
    const isMobile = this._overrides.isMobile ?? config.mobile;
    const hasTouch = this._overrides.hasTouch ?? config.mobile;
    const userAgent = this._overrides.userAgent ?? config.userAgent;
    const locale = this._overrides.locale ?? config.locale;
    const colorScheme = this._overrides.colorScheme ?? config.colorScheme;

    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      channel: config.channel,
      viewport,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      javaScriptEnabled: config.javaScript,
      ...(userAgent && { userAgent }),
      ...(locale && { locale }),
      ...(colorScheme && { colorScheme }),
      ...(config.proxy && {
        proxy: {
          server: config.proxy,
          ...(config.proxyBypass && { bypass: config.proxyBypass }),
          ...(config.proxyUsername && { username: config.proxyUsername }),
          ...(config.proxyPassword && { password: config.proxyPassword }),
        },
      }),
    });
    if (locale) {
      this._extraHeaders["Accept-Language"] = locale;
      await this.context.setExtraHTTPHeaders({ ...this._extraHeaders });
    }
    for (const page of this.context.pages()) {
      this.registerPage(page);
    }
    this.context.on("page", (p) => this.registerPage(p, false));
    this.startSweeper();
    return this.context;
  }

  private registerPage(page: Page, setActive = true): string {
    const id = nanoid(8);
    this.tabs.set(id, page);
    this.pageToId.set(page, id);
    this.lastUsed.set(id, Date.now());
    if (setActive) this.currentTabId = id;
    page.on("close", () => {
      this.tabs.delete(id);
      this.pageToId.delete(page);
      this.lastUsed.delete(id);
      if (this.currentTabId === id) {
        const next = this.tabs.keys().next();
        this.currentTabId = next.done ? null : next.value;
      }
    });
    return id;
  }

  private startSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    this.sweepTimer.unref?.();
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    const tabTtlMs = config.tabTtlSec * 1000;
    const stale: string[] = [];
    for (const [id, ts] of this.lastUsed) {
      if (id === this.currentTabId) continue;
      if (now - ts > tabTtlMs) stale.push(id);
    }
    for (const id of stale) {
      const page = this.tabs.get(id);
      if (page) await page.close().catch(() => {});
    }
  }

  async openTab(url: string): Promise<TabInfo> {
    const ctx = await this.ensureContext();
    const page = await ctx.newPage();
    const id = this.pageToId.get(page) ?? this.registerPage(page);
    this.currentTabId = id;
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.settle(page);
    return { tab_id: id, title: await page.title(), url: page.url(), status: resp?.status() };
  }

  async navigate(url: string, tabId?: string): Promise<TabInfo> {
    if (!tabId) return this.openTab(url);
    const page = this.getPage(tabId);
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.settle(page);
    this.currentTabId = tabId;
    return { tab_id: tabId, title: await page.title(), url: page.url(), status: resp?.status() };
  }

  async listTabs(): Promise<TabInfo[]> {
    const out: TabInfo[] = [];
    for (const [tab_id, page] of this.tabs) {
      out.push({ tab_id, title: await page.title(), url: page.url() });
    }
    return out;
  }

  async closeTab(tabId: string): Promise<void> {
    const page = this.getPage(tabId);
    await page.close();
  }

  switchTab(tabId: string): void {
    this.getPage(tabId);
    this.currentTabId = tabId;
  }

  get activeTabId(): string | null {
    return this.currentTabId;
  }

  getPage(tabId?: string): Page {
    const id = tabId ?? this.currentTabId;
    if (!id) throw new Error("No active tab. Call browser_open first.");
    const page = this.tabs.get(id);
    if (!page) throw new Error(`Tab ${id} not found`);
    this.lastUsed.set(id, Date.now());
    return page;
  }

  async settle(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await new Promise<void>((resolve) => {
      let inflight = 0;
      let settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const hardTimer = setTimeout(done, config.settleTimeoutMs);
      function done() {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        if (idleTimer) clearTimeout(idleTimer);
        page.removeListener("request", onReq);
        page.removeListener("requestfinished", onEnd);
        page.removeListener("requestfailed", onEnd);
        resolve();
      }
      function resetIdle() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = inflight === 0 ? setTimeout(done, config.settleMs) : null;
      }
      function onReq() {
        inflight++;
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      }
      function onEnd() {
        inflight = Math.max(0, inflight - 1);
        resetIdle();
      }
      page.on("request", onReq);
      page.on("requestfinished", onEnd);
      page.on("requestfailed", onEnd);
      resetIdle();
    });
  }

  async click(target: string, targetType: "text" | "selector", tabId?: string): Promise<void> {
    const page = this.getPage(tabId);
    if (targetType === "selector") {
      await page.locator(target).first().click({ timeout: 10_000 });
    } else {
      await page.getByText(target, { exact: false }).first().click({ timeout: 10_000 });
    }
    await this.settle(page);
  }

  async type(selector: string, text: string, submit: boolean, tabId?: string): Promise<void> {
    const page = this.getPage(tabId);
    const loc = page.locator(selector).first();
    const isContentEditable = await loc.evaluate(
      (el) =>
        el instanceof HTMLElement &&
        el.isContentEditable &&
        !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement),
    );
    if (isContentEditable) {
      await loc.evaluate((el, t) => {
        (el as HTMLElement).textContent = t;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, text);
    } else {
      await loc.fill(text, { timeout: 10_000 });
    }
    if (submit) {
      await loc.press("Enter");
      await this.settle(page);
    }
  }

  async scroll(
    direction: "up" | "down" | "top" | "bottom",
    amount: number,
    tabId?: string,
  ): Promise<{ scrollY: number; scrollHeight: number; viewportHeight: number }> {
    const page = this.getPage(tabId);
    return await page.evaluate(
      ({ direction, amount }) => {
        if (direction === "top") window.scrollTo(0, 0);
        else if (direction === "bottom") window.scrollTo(0, document.body.scrollHeight);
        else window.scrollBy(0, direction === "down" ? amount : -amount);
        return {
          scrollY: Math.round(window.scrollY),
          scrollHeight: document.body.scrollHeight,
          viewportHeight: window.innerHeight,
        };
      },
      { direction, amount },
    );
  }

  async back(tabId?: string): Promise<TabInfo & { no_history?: boolean }> {
    const page = this.getPage(tabId);
    const resp = await page.goBack({ waitUntil: "domcontentloaded" });
    if (resp !== null) await this.settle(page);
    return {
      tab_id: tabId ?? this.currentTabId!,
      title: await page.title(),
      url: page.url(),
      ...(resp === null && { no_history: true }),
    };
  }

  async forward(tabId?: string): Promise<TabInfo & { no_history?: boolean }> {
    const page = this.getPage(tabId);
    const resp = await page.goForward({ waitUntil: "domcontentloaded" });
    if (resp !== null) await this.settle(page);
    return {
      tab_id: tabId ?? this.currentTabId!,
      title: await page.title(),
      url: page.url(),
      ...(resp === null && { no_history: true }),
    };
  }

  async reload(tabId?: string): Promise<TabInfo> {
    const page = this.getPage(tabId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await this.settle(page);
    return { tab_id: tabId ?? this.currentTabId!, title: await page.title(), url: page.url() };
  }

  async find(query: string, limit: number, tabId?: string): Promise<
    Array<{ snippet: string; selector: string; tag: string }>
  > {
    const page = this.getPage(tabId);
    return await page.evaluate(
      ({ query, limit }) => {
        const q = query.toLowerCase();
        const results: Array<{ snippet: string; selector: string; tag: string }> = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const cssPath = (el: Element): string => {
          const parts: string[] = [];
          let node: Element | null = el;
          while (node && node.nodeType === 1 && parts.length < 5) {
            let part = node.tagName.toLowerCase();
            if (node.id) {
              part += `#${CSS.escape(node.id)}`;
              parts.unshift(part);
              break;
            }
            const parent = node.parentElement;
            if (parent) {
              const siblings = [...parent.children].filter((c) => c.tagName === node!.tagName);
              if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
            }
            parts.unshift(part);
            node = node.parentElement;
          }
          return parts.join(" > ");
        };
        let n: Node | null;
        while ((n = walker.nextNode())) {
          const text = (n.textContent ?? "").trim();
          if (!text || text.length < 2) continue;
          if (!text.toLowerCase().includes(q)) continue;
          const el = n.parentElement;
          if (!el) continue;
          const idx = text.toLowerCase().indexOf(q);
          const start = Math.max(0, idx - 40);
          const end = Math.min(text.length, idx + q.length + 40);
          results.push({
            snippet: (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : ""),
            selector: cssPath(el),
            tag: el.tagName.toLowerCase(),
          });
          if (results.length >= limit) break;
        }
        return results;
      },
      { query, limit },
    );
  }

  async openVisible(url: string): Promise<TabInfo> {
    await this.shutdown();
    this.headless = false;
    const ctx = await this.ensureContext();
    ctx.once("close", () => {
      this.context = null;
      this.tabs.clear();
      this.pageToId.clear();
      this.lastUsed.clear();
      this.currentTabId = null;
      this.headless = config.headless;
    });
    const existing = ctx.pages()[0];
    const page = existing ?? (await ctx.newPage());
    const id = this.pageToId.get(page) ?? this.registerPage(page);
    this.currentTabId = id;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return { tab_id: id, title: await page.title(), url: page.url() };
  }

  async screenshot(fullPage: boolean, tabId?: string): Promise<Buffer> {
    const page = this.getPage(tabId);
    return await page.screenshot({ fullPage, type: "png" });
  }

  async setViewport(width: number, height: number, tabId?: string): Promise<void> {
    const page = this.getPage(tabId);
    await page.setViewportSize({ width, height });
  }

  async setUserAgent(ua: string): Promise<void> {
    const ctx = await this.ensureContext();
    this._extraHeaders["User-Agent"] = ua;
    await ctx.setExtraHTTPHeaders({ ...this._extraHeaders });
    // Override navigator.userAgent for all future pages
    await ctx.addInitScript(`Object.defineProperty(navigator, 'userAgent', { get: () => ${JSON.stringify(ua)} })`);
    // Apply to all existing pages
    for (const page of ctx.pages()) {
      await page.evaluate((u) => {
        Object.defineProperty(navigator, "userAgent", { get: () => u });
      }, ua).catch(() => {});
    }
  }

  async setLocale(locale: string): Promise<void> {
    const ctx = await this.ensureContext();
    this._extraHeaders["Accept-Language"] = locale;
    await ctx.setExtraHTTPHeaders({ ...this._extraHeaders });
  }

  async setColorScheme(scheme: "light" | "dark" | "no-preference", tabId?: string): Promise<void> {
    const page = this.getPage(tabId);
    await page.emulateMedia({ colorScheme: scheme });
  }

  private _extraHeaders: Record<string, string> = {};

  /**
   * Restart the browser context with new context-level settings.
   * All open tabs are lost. Use for deviceScaleFactor, isMobile, hasTouch.
   */
  async reconfigure(overrides: {
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
    userAgent?: string;
    locale?: string;
    colorScheme?: "light" | "dark" | "no-preference";
  }): Promise<void> {
    Object.assign(this._overrides, overrides);
    this._extraHeaders = {};
    await this.shutdown();
    await this.ensureContext();
  }

  async shutdown(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.tabs.clear();
      this.pageToId.clear();
      this.lastUsed.clear();
      this.currentTabId = null;
    }
  }
}
