/**
 * @graphmemory/browser-client — a tiny, dependency-free client for the
 * browser-mcp stateless REST API (`/api/v1`).
 *
 * Stateless: every call is an independent POST. `profile` selects which shared
 * live browser to drive (the same profile an MCP agent uses); pass `tab_id` in
 * args to target a specific tab. Node 18+ (uses the global `fetch`).
 */

/** A content block (text, or base64 image for screenshots), mirrored from MCP. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** The JSON envelope every tool call resolves to. `ok:false` is a tool-level
 *  failure (e.g. a failed assertion) — still an HTTP 200. */
export type ToolEnvelope<T = unknown> =
  | { ok: true; data?: T; content: ContentBlock[] }
  | { ok: false; error: { message: string; issues?: unknown }; data?: T; content?: ContentBlock[] };

/** Thrown on a transport-layer failure (4xx/5xx): bad args, auth, unknown tool, cap. */
export class BrowserClientError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "BrowserClientError";
    this.status = status;
    this.body = body;
  }
}

export interface BrowserClientOptions {
  /** Base URL of the browser-mcp server, e.g. "http://127.0.0.1:7777". */
  baseUrl: string;
  /** Bearer token, required only if the server was started with an API key. */
  apiKey?: string;
  /** Default profile (shared browser) to target. Defaults to "default". */
  profile?: string;
  /** Override fetch (for tests or custom agents). Defaults to the global fetch. */
  fetch?: typeof fetch;
}

type CallOpts = { profile?: string };

export class BrowserClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly profile: string;
  private readonly _fetch: typeof fetch;

  constructor(opts: BrowserClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.profile = opts.profile ?? "default";
    this._fetch = opts.fetch ?? globalThis.fetch;
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h["content-type"] = "application/json";
    if (this.apiKey) h["authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async toJson(res: Response): Promise<unknown> {
    return res.json().catch(() => ({}));
  }

  /**
   * Call any tool by name. Resolves with the 200 envelope (where `ok` may be
   * false for a tool-level failure); throws BrowserClientError on a transport
   * error (4xx/5xx).
   */
  async tool<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
    opts: CallOpts = {},
  ): Promise<ToolEnvelope<T>> {
    const profile = opts.profile ?? this.profile;
    const url = `${this.baseUrl}/api/v1/tools/${encodeURIComponent(name)}?profile=${encodeURIComponent(profile)}`;
    const res = await this._fetch(url, { method: "POST", headers: this.headers(true), body: JSON.stringify(args) });
    const body = await this.toJson(res);
    if (!res.ok) {
      const message = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
      throw new BrowserClientError(message, res.status, body);
    }
    return body as ToolEnvelope<T>;
  }

  /** List the available tools (names + descriptions). */
  async listTools(): Promise<{ tools: Array<{ name: string; description: string }> }> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/tools`, { headers: this.headers(false) });
    if (!res.ok) throw new BrowserClientError(`HTTP ${res.status}`, res.status, await this.toJson(res));
    return res.json() as Promise<{ tools: Array<{ name: string; description: string }> }>;
  }

  /** Fetch the OpenAPI 3.1 document describing the API. */
  async openapi(): Promise<unknown> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/openapi.json`, { headers: this.headers(false) });
    if (!res.ok) throw new BrowserClientError(`HTTP ${res.status}`, res.status, await this.toJson(res));
    return res.json();
  }

  /** Release a profile holder (closes its browser if no MCP session holds it). */
  async releaseProfile(profile: string = this.profile): Promise<{ ok: boolean; released: boolean }> {
    const res = await this._fetch(`${this.baseUrl}/api/v1/profiles/${encodeURIComponent(profile)}`, {
      method: "DELETE",
      headers: this.headers(false),
    });
    if (!res.ok) throw new BrowserClientError(`HTTP ${res.status}`, res.status, await this.toJson(res));
    return res.json() as Promise<{ ok: boolean; released: boolean }>;
  }

  // --- ergonomic shortcuts for common tools (thin wrappers over tool()) ---

  open(url: string, opts: { tab_id?: string } & CallOpts = {}) {
    const { profile, ...args } = opts;
    return this.tool("browser_open", { url, ...args }, { profile });
  }

  read(opts: { mode?: "markdown" | "text" | "html"; selector?: string; tab_id?: string } & CallOpts = {}) {
    const { profile, ...args } = opts;
    return this.tool("browser_read", args, { profile });
  }

  click(target: string, opts: { target_type?: string; role?: string; tab_id?: string } & CallOpts = {}) {
    const { profile, ...args } = opts;
    return this.tool("browser_click", { target, ...args }, { profile });
  }

  type(target: string, text: string, opts: { target_type?: string; submit?: boolean; tab_id?: string } & CallOpts = {}) {
    const { profile, ...args } = opts;
    return this.tool("browser_type", { target, text, ...args }, { profile });
  }

  snapshot(opts: { tab_id?: string; format?: "yaml" | "json"; selector?: string } & CallOpts = {}) {
    const { profile, ...args } = opts;
    return this.tool("browser_snapshot", args, { profile });
  }

  evaluate(expression: string, opts: { tab_id?: string } & CallOpts = {}) {
    const { profile, ...args } = opts;
    return this.tool("browser_evaluate", { expression, ...args }, { profile });
  }

  tabsList(opts: CallOpts = {}) {
    return this.tool("browser_tabs_list", {}, opts);
  }
}
