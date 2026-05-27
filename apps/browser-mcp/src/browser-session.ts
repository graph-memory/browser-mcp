import type {
  BrowserManager, TabInfo, AxNode, LocatorType, LocatorOpts,
  ConsoleLevel, ConsoleLogEntry, NetLogEntry, NetBodyEntry,
} from "./browser.js";

/**
 * Per-session view over a shared (per-profile) BrowserManager.
 *
 * Multiple MCP sessions on the same profile share one BrowserContext (so a
 * login in one is visible in another), but each session keeps its OWN active
 * tab and its OWN named-snapshot store. Without this, session B's
 * `browser_open` would silently change the tab that session A's next
 * tab_id-less call acts on, and `store_as` names would collide.
 *
 * Tab-defaulting methods resolve `tab_id ?? this.currentTabId` to a concrete id
 * and pass it to the manager, so the manager's own active-tab fallback is never
 * consulted for a session.
 */
export class BrowserSession {
  private currentTabId: string | null = null;
  private snapshots = new Map<string, AxNode>();

  constructor(private readonly mgr: BrowserManager) {}

  get profileName(): string { return this.mgr.profileName; }
  get profileDir(): string { return this.mgr.profileDir; }
  get manager(): BrowserManager { return this.mgr; }

  /** Resolve to a concrete tab id for this session, or throw. */
  private resolve(tabId?: string): string {
    // An explicit tab_id is the caller's responsibility — if it's gone, let the
    // manager surface a precise "Tab <id> not found".
    if (tabId) return tabId;
    const id = this.currentTabId;
    if (!id) throw new Error("No active tab. Call browser_open first.");
    // Our remembered active tab may have been closed by another session on this
    // profile or reaped by the TTL sweeper — neither path syncs back to us. Heal
    // the stale id and report a clean "no active tab" rather than the confusing
    // "Tab <id> not found" the manager would otherwise throw.
    if (!this.mgr.hasTab(id)) {
      this.currentTabId = null;
      throw new Error("No active tab. Call browser_open first.");
    }
    return id;
  }

  // --- tabs / navigation (own active tab) ---
  async navigate(url: string, tabId?: string): Promise<TabInfo> {
    const info = await this.mgr.navigate(url, tabId);
    this.currentTabId = info.tab_id;
    return info;
  }
  async listTabs(): Promise<TabInfo[]> { return this.mgr.listTabs(); }
  async closeTab(tabId: string): Promise<void> {
    await this.mgr.closeTab(tabId);
    if (this.currentTabId === tabId) this.currentTabId = null;
  }
  switchTab(tabId: string): void {
    this.mgr.getPage(tabId); // validate it exists (throws otherwise)
    this.currentTabId = tabId;
  }
  get activeTabId(): string | null {
    // Forget a tab that was closed elsewhere so the reported active tab stays truthful.
    if (this.currentTabId && !this.mgr.hasTab(this.currentTabId)) this.currentTabId = null;
    return this.currentTabId;
  }
  getPage(tabId?: string) { return this.mgr.getPage(this.resolve(tabId)); }

  async openVisible(url: string): Promise<TabInfo> {
    const info = await this.mgr.openVisible(url);
    this.currentTabId = info.tab_id;
    return info;
  }

  // --- interaction (default to this session's tab) ---
  click(target: string, t: LocatorType, tabId?: string, opts?: LocatorOpts) { return this.mgr.click(target, t, this.resolve(tabId), opts); }
  type(target: string, text: string, submit: boolean, tabId?: string, t: LocatorType = "text", opts?: LocatorOpts) { return this.mgr.type(target, text, submit, this.resolve(tabId), t, opts); }
  press(key: string, target: string | undefined, t: LocatorType, tabId?: string, opts?: LocatorOpts) { return this.mgr.press(key, target, t, this.resolve(tabId), opts); }
  hover(target: string, t: LocatorType, tabId?: string, opts?: LocatorOpts) { return this.mgr.hover(target, t, this.resolve(tabId), opts); }
  selectOption(target: string, t: LocatorType, by: "value" | "label" | "index", values: string[], tabId?: string, opts?: LocatorOpts) { return this.mgr.selectOption(target, t, by, values, this.resolve(tabId), opts); }
  setChecked(target: string, t: LocatorType, checked: boolean, tabId?: string, opts?: LocatorOpts) { return this.mgr.setChecked(target, t, checked, this.resolve(tabId), opts); }
  drag(source: string, st: LocatorType, target: string, tt: LocatorType, tabId?: string, so?: LocatorOpts, to?: LocatorOpts) { return this.mgr.drag(source, st, target, tt, this.resolve(tabId), so, to); }
  scroll(direction: "up" | "down" | "top" | "bottom", amount: number, tabId?: string) { return this.mgr.scroll(direction, amount, this.resolve(tabId)); }
  back(tabId?: string) { return this.mgr.back(this.resolve(tabId)); }
  forward(tabId?: string) { return this.mgr.forward(this.resolve(tabId)); }
  reload(tabId?: string) { return this.mgr.reload(this.resolve(tabId)); }
  find(query: string, limit: number, tabId?: string) { return this.mgr.find(query, limit, this.resolve(tabId)); }
  storage(action: "get" | "set" | "remove" | "clear", area: "local" | "session", key: string | undefined, value: string | undefined, tabId?: string) { return this.mgr.storage(action, area, key, value, this.resolve(tabId)); }

  // --- visual / snapshot ---
  screenshot(fullPage: boolean, tabId?: string) { return this.mgr.screenshot(fullPage, this.resolve(tabId)); }
  elementScreenshot(selector: string, tabId?: string) { return this.mgr.elementScreenshot(selector, this.resolve(tabId)); }
  a11ySnapshot(opts: { tabId?: string; selector?: string; maxDepth?: number; interestingOnly?: boolean }) {
    return this.mgr.a11ySnapshot({ ...opts, tabId: this.resolve(opts.tabId) });
  }
  storeSnapshot(id: string, snapshot: AxNode): void { this.snapshots.set(id, snapshot); }
  getStoredSnapshot(id: string): AxNode | undefined { return this.snapshots.get(id); }

  // --- per-tab config ---
  setViewport(w: number, h: number, tabId?: string) { return this.mgr.setViewport(w, h, this.resolve(tabId)); }
  setColorScheme(scheme: "light" | "dark" | "no-preference", tabId?: string) { return this.mgr.setColorScheme(scheme, this.resolve(tabId)); }

  // --- context-wide (shared across sessions) ---
  getContext() { return this.mgr.getContext(); }
  reconfigure(o: Parameters<BrowserManager["reconfigure"]>[0]) { return this.mgr.reconfigure(o); }
  setUserAgent(ua: string) { return this.mgr.setUserAgent(ua); }
  setLocale(locale: string) { return this.mgr.setLocale(locale); }
  setExtraHeaders(h: Record<string, string>) { return this.mgr.setExtraHeaders(h); }
  setGeolocation(lat: number, lon: number, acc?: number) { return this.mgr.setGeolocation(lat, lon, acc); }
  setDialogPolicy(action: "accept" | "dismiss", promptText: string | undefined, persist: boolean) { return this.mgr.setDialogPolicy(action, promptText, persist); }
  readNetLog(o: Parameters<BrowserManager["readNetLog"]>[0]): { entries: NetLogEntry[]; total: number } { return this.mgr.readNetLog(o); }
  readConsoleLog(o: { tabId?: string; level?: ConsoleLevel; limit?: number; textRegex?: string }): { entries: ConsoleLogEntry[]; total: number } { return this.mgr.readConsoleLog(o); }
  readNetworkBodies(o: { urlRegex?: string; method?: string }): NetBodyEntry[] { return this.mgr.readNetworkBodies(o); }
}
