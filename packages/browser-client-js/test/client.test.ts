import { describe, it, expect, vi } from "vitest";
import { BrowserClient, BrowserClientError } from "../src/index.js";

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("BrowserClient", () => {
  it("POSTs tool calls with the profile query, json + bearer headers, and a json body", async () => {
    const f = mockFetch(200, { ok: true, data: { tab_id: "t1" }, content: [] });
    const c = new BrowserClient({ baseUrl: "http://h:7777/", apiKey: "k", profile: "work", fetch: f as unknown as typeof fetch });
    const r = await c.open("https://example.com");
    expect(r.ok).toBe(true);

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://h:7777/api/v1/tools/browser_open?profile=work");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer k");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ url: "https://example.com" });
  });

  it("resolves with the envelope (ok:false) for a tool-level failure on HTTP 200", async () => {
    const f = mockFetch(200, { ok: false, error: { message: "boom" }, content: [] });
    const c = new BrowserClient({ baseUrl: "http://h", fetch: f as unknown as typeof fetch });
    const r = await c.tool("browser_expect", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("boom");
  });

  it("throws BrowserClientError on a transport error (4xx) and carries status + body", async () => {
    const f = mockFetch(400, { ok: false, error: { message: "invalid arguments" } });
    const c = new BrowserClient({ baseUrl: "http://h", fetch: f as unknown as typeof fetch });
    await expect(c.open("nope")).rejects.toMatchObject({
      name: "BrowserClientError",
      status: 400,
    });
    await expect(c.open("nope")).rejects.toBeInstanceOf(BrowserClientError);
  });

  it("lets a per-call profile override the default", async () => {
    const f = mockFetch(200, { ok: true, content: [] });
    const c = new BrowserClient({ baseUrl: "http://h", profile: "a", fetch: f as unknown as typeof fetch });
    await c.tool("browser_read", {}, { profile: "b" });
    expect(f.mock.calls[0][0]).toContain("profile=b");
  });

  it("omits the auth header when no apiKey is set", async () => {
    const f = mockFetch(200, { ok: true, content: [] });
    const c = new BrowserClient({ baseUrl: "http://h", fetch: f as unknown as typeof fetch });
    await c.read();
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
  });

  it("listTools and releaseProfile hit the right endpoints/methods", async () => {
    const f = mockFetch(200, { tools: [] });
    const c = new BrowserClient({ baseUrl: "http://h", fetch: f as unknown as typeof fetch });
    await c.listTools();
    expect(f.mock.calls[0][0]).toBe("http://h/api/v1/tools");

    const f2 = mockFetch(200, { ok: true, released: true });
    const c2 = new BrowserClient({ baseUrl: "http://h", fetch: f2 as unknown as typeof fetch });
    const out = await c2.releaseProfile("work");
    expect(f2.mock.calls[0][0]).toBe("http://h/api/v1/profiles/work");
    expect((f2.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    expect(out.released).toBe(true);
  });
});
