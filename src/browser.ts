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

    // Don't leak supervisor-internal env (API key, host, caps) into Chromium.
    // Chromium doesn't need any of BROWSER_MCP_* to function; keeping the API
    // key out is just good hygiene for apps that might fingerprint the env.
    const childEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) => !k.startsWith("BROWSER_MCP_") && v !== undefined,
      ),
    ) as Record<string, string>;

    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.headless,
      channel: config.channel,
      viewport,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      javaScriptEnabled: config.javaScript,
      env: childEnv,
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

  async click(target: string, targetType: LocatorType, tabId?: string, opts?: LocatorOpts): Promise<void> {
    const page = this.getPage(tabId);
    const loc = resolveLocator(page, target, targetType, opts).first();
    await loc.click({ timeout: 10_000 });
    await this.settle(page);
  }

  async type(
    selector: string,
    text: string,
    submit: boolean,
    tabId?: string,
    targetType: LocatorType = "selector",
    opts?: LocatorOpts,
  ): Promise<void> {
    const page = this.getPage(tabId);
    const loc = resolveLocator(page, selector, targetType, opts).first();
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

  /** Public accessor for BrowserContext; used by permission / network tools. */
  async getContext(): Promise<BrowserContext> {
    return this.ensureContext();
  }

  /**
   * Accessibility snapshot via CDP. Playwright 1.40+ no longer exposes
   * `page.accessibility.snapshot()`, so we pull the AX tree directly from
   * Chrome DevTools Protocol. Result is more reliable for LLM interaction
   * than scraping Markdown — roles, names, states come from the platform
   * accessibility API.
   */
  async a11ySnapshot(opts: {
    tabId?: string;
    selector?: string;
    maxDepth?: number;
    interestingOnly?: boolean;
  }): Promise<AxNode | null> {
    const page = this.getPage(opts.tabId);
    const ctx = await this.ensureContext();
    const cdp = await ctx.newCDPSession(page);
    try {
      await cdp.send("Accessibility.enable");

      let rawNodes: AxCdpNode[];
      if (opts.selector) {
        const handle = await page.$(opts.selector);
        if (!handle) throw new Error(`selector not found: ${opts.selector}`);
        const { root } = await cdp.send("DOM.getDocument");
        const { nodeId } = await cdp.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector: opts.selector,
        });
        if (!nodeId) throw new Error(`selector not found in DOM: ${opts.selector}`);
        const { node } = await cdp.send("DOM.describeNode", { nodeId });
        const backendNodeId = node.backendNodeId;
        if (backendNodeId === undefined) throw new Error("cannot resolve backendNodeId");
        const res = await cdp.send("Accessibility.getPartialAXTree", {
          backendNodeId,
          fetchRelatives: true,
        });
        rawNodes = res.nodes as AxCdpNode[];
      } else {
        const res = await cdp.send("Accessibility.getFullAXTree");
        rawNodes = res.nodes as AxCdpNode[];
      }

      const tree = cdpAxToTree(rawNodes, opts.interestingOnly ?? true);
      if (!tree) return null;
      if (opts.maxDepth !== undefined) return truncateAx(tree, opts.maxDepth);
      return tree;
    } finally {
      await cdp.detach().catch(() => {});
    }
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

// --- Locator strategies (role/label/text/placeholder/testid/selector) ---

export type LocatorType = "text" | "role" | "label" | "placeholder" | "testid" | "selector";

export type LocatorOpts = {
  role?: string;                // ARIA role when targetType === "role"
  exact?: boolean;              // exact match for text/role/label/placeholder
};

type LocatorFactory = import("playwright").Page;

/**
 * Resolve a human-friendly target description into a Playwright Locator.
 * Centralizes the selector-strategy switch used by click/type/expect.
 */
export function resolveLocator(
  page: LocatorFactory,
  target: string,
  type: LocatorType,
  opts: LocatorOpts = {},
): ReturnType<LocatorFactory["locator"]> {
  switch (type) {
    case "selector":
      return page.locator(target);
    case "text":
      return page.getByText(target, { exact: opts.exact ?? false });
    case "role": {
      // Playwright's getByRole requires a role name; we take it from opts.role
      // (preferred) or default to "button" since that's the most common click target.
      const role = (opts.role as Parameters<LocatorFactory["getByRole"]>[0]) ?? "button";
      return page.getByRole(role, { name: target, exact: opts.exact ?? false });
    }
    case "label":
      return page.getByLabel(target, { exact: opts.exact ?? false });
    case "placeholder":
      return page.getByPlaceholder(target, { exact: opts.exact ?? false });
    case "testid":
      return page.getByTestId(target);
    default:
      return page.locator(target);
  }
}

// --- Accessibility snapshot types & helpers ---

/** Raw CDP AXNode shape. Not all fields are used. */
type AxCdpValue = { type: string; value?: unknown };
type AxCdpProp = { name: string; value: AxCdpValue };
type AxCdpNode = {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
  role?: AxCdpValue;
  name?: AxCdpValue;
  value?: AxCdpValue;
  description?: AxCdpValue;
  properties?: AxCdpProp[];
};

// Roles that are always noise for LLM consumers. InlineTextBox duplicates
// StaticText's text. StaticText under a parent with the same name (e.g. a link)
// also dupes. We strip InlineTextBox unconditionally when interestingOnly is
// set, and collapse single-child StaticText chains.
const ALWAYS_NOISY_ROLES = new Set(["InlineTextBox"]);

function cdpAxToTree(nodes: AxCdpNode[], interestingOnly: boolean): AxNode | null {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  // Find root: a node whose parent isn't in the map, or with no parentId.
  const root = nodes.find((n) => !n.parentId || !byId.has(n.parentId));
  if (!root) return null;

  const build = (raw: AxCdpNode): AxNode | null => {
    const role = raw.role?.value as string | undefined;
    if (interestingOnly && role && ALWAYS_NOISY_ROLES.has(role)) return null;

    if (interestingOnly && raw.ignored) {
      // Skip ignored, but keep descendants — flatten children up.
      const kids: AxNode[] = [];
      for (const cid of raw.childIds ?? []) {
        const cn = byId.get(cid);
        if (!cn) continue;
        const b = build(cn);
        if (b) kids.push(b);
      }
      // If ignored node has one child, collapse to that child; otherwise drop.
      if (kids.length === 1) return kids[0];
      if (kids.length > 1) return { role: "group", children: kids };
      return null;
    }

    const node: AxNode = { role: role ?? "generic" };

    const name = raw.name?.value as string | undefined;
    if (name) node.name = name;
    const value = raw.value?.value;
    if (value !== undefined && value !== null) node.value = value as string | number;
    const description = raw.description?.value as string | undefined;
    if (description) node.description = description;

    for (const p of raw.properties ?? []) {
      const v = p.value?.value;
      switch (p.name) {
        case "disabled": if (v) node.disabled = true; break;
        case "required": if (v) node.required = true; break;
        case "readonly": if (v) node.readonly = true; break;
        case "focused": if (v) node.focused = true; break;
        case "selected": if (v) node.selected = true; break;
        case "expanded":
          if (v !== undefined) node.expanded = Boolean(v); break;
        case "checked":
          if (v !== undefined) node.checked = v === "mixed" ? "mixed" : Boolean(v); break;
        case "pressed":
          if (v !== undefined) node.pressed = v === "mixed" ? "mixed" : Boolean(v); break;
        case "level":
          if (typeof v === "number") node.level = v; break;
        case "invalid":
          if (typeof v === "string" && v !== "false") node.invalid = v; break;
        case "valuemin":
          if (typeof v === "number") node.valuemin = v; break;
        case "valuemax":
          if (typeof v === "number") node.valuemax = v; break;
        case "valuetext":
          if (typeof v === "string") node.valuetext = v; break;
        case "roledescription":
          if (typeof v === "string") node.roledescription = v; break;
        case "haspopup":
          if (typeof v === "string" && v !== "false") node.haspopup = v; break;
        case "orientation":
          if (typeof v === "string") node.orientation = v; break;
        case "multiline":
          if (v) node.multiline = true; break;
        case "multiselectable":
          if (v) node.multiselectable = true; break;
        case "autocomplete":
          if (typeof v === "string" && v !== "none") node.autocomplete = v; break;
        case "modal":
          if (v) node.modal = true; break;
        case "keyshortcuts":
          if (typeof v === "string") node.keyshortcuts = v; break;
      }
    }

    const kids: AxNode[] = [];
    for (const cid of raw.childIds ?? []) {
      const cn = byId.get(cid);
      if (!cn) continue;
      const b = build(cn);
      if (b) kids.push(b);
    }
    if (kids.length) node.children = kids;
    return node;
  };

  const tree = build(root);
  return tree ? (interestingOnly ? collapseRedundantText(tree) : tree) : null;
}

/**
 * When a node's `name` already contains the full text of a single StaticText
 * child, drop the child — it's noise for LLM consumers. E.g.
 *   - link "Home"
 *     - StaticText "Home"
 * becomes just
 *   - link "Home".
 */
function collapseRedundantText(node: AxNode): AxNode {
  if (!node.children || node.children.length === 0) return node;
  const kids = node.children
    .map(collapseRedundantText)
    .filter((c) => !(c.role === "StaticText" && c.name && c.name === node.name && !c.children));
  return kids.length ? { ...node, children: kids } : (() => { const { children, ...rest } = node; return rest; })();
}


export type AxNode = {
  role: string;
  name?: string;
  value?: string | number;
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  checked?: boolean | "mixed";
  pressed?: boolean | "mixed";
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
  children?: AxNode[];
};

function truncateAx(node: AxNode, maxDepth: number): AxNode {
  if (maxDepth < 0 || !node.children || node.children.length === 0) {
    const { children, ...rest } = node;
    return maxDepth < 0 ? rest : node;
  }
  if (maxDepth === 0) {
    const { children, ...rest } = node;
    return { ...rest, children: [{ role: "…", name: `${children.length} hidden child${children.length === 1 ? "" : "ren"}` }] };
  }
  return { ...node, children: node.children.map((c) => truncateAx(c, maxDepth - 1)) };
}

/**
 * Format an AxNode tree as compact YAML-ish output that's easy to read and
 * cheap on tokens. Each node is one line:
 *
 *   - button "Sign in"
 *     - img "logo"
 *
 * Boolean/value attributes are appended in [brackets].
 */
export function renderAxNode(node: AxNode, indent = 0): string {
  const lines: string[] = [];
  walk(node, indent, lines);
  return lines.join("\n");
}

function walk(node: AxNode, indent: number, lines: string[]): void {
  const pad = "  ".repeat(indent);
  const name = node.name ? ` "${node.name.replace(/"/g, '\\"')}"` : "";
  const attrs = axAttrs(node);
  const attrStr = attrs.length ? ` [${attrs.join(", ")}]` : "";
  lines.push(`${pad}- ${node.role}${name}${attrStr}`);
  if (node.children) for (const c of node.children) walk(c, indent + 1, lines);
}

function axAttrs(node: AxNode): string[] {
  const out: string[] = [];
  if (node.value !== undefined) out.push(`value=${JSON.stringify(node.value)}`);
  if (node.checked !== undefined) out.push(`checked=${node.checked}`);
  if (node.pressed !== undefined) out.push(`pressed=${node.pressed}`);
  if (node.selected) out.push("selected");
  if (node.disabled) out.push("disabled");
  if (node.required) out.push("required");
  if (node.readonly) out.push("readonly");
  if (node.expanded !== undefined) out.push(`expanded=${node.expanded}`);
  if (node.focused) out.push("focused");
  if (node.level !== undefined) out.push(`level=${node.level}`);
  if (node.invalid) out.push(`invalid=${node.invalid}`);
  return out;
}
