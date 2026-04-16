import { chromium as vanillaChromium, type BrowserContext, type Page } from "playwright";
import { chromium as extraChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { nanoid } from "nanoid";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_PROFILE_DIR = join(homedir(), ".browser-mcp", "profile");
const DEFAULT_TAB_TTL_MS = (Number(process.env.BROWSER_MCP_TAB_TTL_SEC) || 600) * 1000;
const SWEEP_INTERVAL_MS = 60_000;

const STEALTH = process.env.BROWSER_MCP_STEALTH !== "0";
const CHANNEL = process.env.BROWSER_MCP_CHANNEL ?? "chrome";
const DEFAULT_HEADLESS = process.env.BROWSER_MCP_HEADLESS !== "0";

if (STEALTH) extraChromium.use(StealthPlugin());
const chromium = STEALTH ? extraChromium : vanillaChromium;

export type TabInfo = { tab_id: string; title: string; url: string; status?: number };

class BrowserManager {
  private context: BrowserContext | null = null;
  private tabs = new Map<string, Page>();
  private lastUsed = new Map<string, number>();
  private currentTabId: string | null = null;
  private profileDir: string;
  private headless: boolean;
  private tabTtlMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(opts: { profileDir?: string; headless?: boolean; tabTtlMs?: number } = {}) {
    this.profileDir = opts.profileDir ?? DEFAULT_PROFILE_DIR;
    this.headless = opts.headless ?? DEFAULT_HEADLESS;
    this.tabTtlMs = opts.tabTtlMs ?? DEFAULT_TAB_TTL_MS;
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      channel: CHANNEL,
      viewport: { width: 1280, height: 900 },
    });
    for (const page of this.context.pages()) {
      this.registerPage(page);
    }
    this.context.on("page", (p) => this.registerPage(p));
    this.startSweeper();
    return this.context;
  }

  private registerPage(page: Page): string {
    const id = nanoid(8);
    this.tabs.set(id, page);
    this.lastUsed.set(id, Date.now());
    this.currentTabId = id;
    page.on("close", () => {
      this.tabs.delete(id);
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
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    const stale: string[] = [];
    for (const [id, ts] of this.lastUsed) {
      if (id === this.currentTabId) continue;
      if (now - ts > this.tabTtlMs) stale.push(id);
    }
    for (const id of stale) {
      const page = this.tabs.get(id);
      if (page) await page.close().catch(() => {});
    }
  }

  async openTab(url: string): Promise<TabInfo> {
    const ctx = await this.ensureContext();
    const page = await ctx.newPage();
    const id = [...this.tabs.entries()].find(([, p]) => p === page)?.[0] ?? this.registerPage(page);
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

  getPage(tabId?: string): Page {
    const id = tabId ?? this.currentTabId;
    if (!id) throw new Error("No active tab. Call browser_open first.");
    const page = this.tabs.get(id);
    if (!page) throw new Error(`Tab ${id} not found`);
    this.lastUsed.set(id, Date.now());
    return page;
  }

  async settle(page: Page): Promise<void> {
    try {
      await page.waitForLoadState("networkidle", { timeout: 5_000 });
    } catch {
      // best-effort
    }
  }

  async click(target: string, tabId?: string): Promise<void> {
    const page = this.getPage(tabId);
    const byText = page.getByText(target, { exact: false }).first();
    if (await byText.count()) {
      await byText.click({ timeout: 10_000 });
    } else {
      await page.locator(target).first().click({ timeout: 10_000 });
    }
    await this.settle(page);
  }

  async type(selector: string, text: string, submit: boolean, tabId?: string): Promise<void> {
    const page = this.getPage(tabId);
    const loc = page.locator(selector).first();
    await loc.fill(text, { timeout: 10_000 });
    if (submit) {
      await loc.press("Enter");
      await this.settle(page);
    }
  }

  async scroll(direction: "up" | "down" | "top" | "bottom", amount: number, tabId?: string): Promise<void> {
    const page = this.getPage(tabId);
    await page.evaluate(
      ({ direction, amount }) => {
        if (direction === "top") window.scrollTo(0, 0);
        else if (direction === "bottom") window.scrollTo(0, document.body.scrollHeight);
        else window.scrollBy(0, direction === "down" ? amount : -amount);
      },
      { direction, amount },
    );
  }

  async back(tabId?: string): Promise<TabInfo> {
    const page = this.getPage(tabId);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await this.settle(page);
    return { tab_id: tabId ?? this.currentTabId!, title: await page.title(), url: page.url() };
  }

  async forward(tabId?: string): Promise<TabInfo> {
    const page = this.getPage(tabId);
    await page.goForward({ waitUntil: "domcontentloaded" });
    await this.settle(page);
    return { tab_id: tabId ?? this.currentTabId!, title: await page.title(), url: page.url() };
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
              part += `#${node.id}`;
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
            snippet: (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : ""),
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
      this.lastUsed.clear();
      this.currentTabId = null;
      this.headless = DEFAULT_HEADLESS;
    });
    const existing = ctx.pages()[0];
    const page = existing ?? (await ctx.newPage());
    const id =
      [...this.tabs.entries()].find(([, p]) => p === page)?.[0] ?? this.registerPage(page);
    this.currentTabId = id;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return { tab_id: id, title: await page.title(), url: page.url() };
  }

  async screenshot(fullPage: boolean, tabId?: string): Promise<Buffer> {
    const page = this.getPage(tabId);
    return await page.screenshot({ fullPage, type: "png" });
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
      this.lastUsed.clear();
      this.currentTabId = null;
    }
  }
}

export const browser = new BrowserManager();
