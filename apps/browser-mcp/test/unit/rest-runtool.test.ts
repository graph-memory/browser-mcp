import { describe, it, expect } from "vitest";
import { runTool, parseApiRoute, toolsDiscovery, type RestHandlers } from "../../src/rest.js";
import type { ToolResult } from "../../src/tool-runtime.js";

function handlersWith(name: string, fn: (args: unknown) => Promise<ToolResult>): RestHandlers {
  return new Map([[name, fn]]);
}

describe("runTool — transport status mapping", () => {
  it("404 for an unknown tool", async () => {
    const r = await runTool("browser_nope", {}, new Map());
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
  });

  it("400 when args fail zod validation (browser_open requires a url)", async () => {
    const handlers = handlersWith("browser_open", async () => ({ content: [{ type: "text", text: "x" }] }));
    const r = await runTool("browser_open", {}, handlers);
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    if (!r.body.ok) expect(r.body.error.issues).toBeDefined();
  });

  it("200 ok:true with data when the tool succeeds", async () => {
    const handlers = handlersWith("browser_open", async (args) => ({
      content: [{ type: "text", text: "opened" }],
      data: { echoed: args },
    }));
    const r = await runTool("browser_open", { url: "https://example.com" }, handlers);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    if (r.body.ok) expect(r.body.data).toEqual({ echoed: { url: "https://example.com" } });
  });

  it("200 ok:false (NOT 4xx) when the tool returns isError — e.g. a failed assertion", async () => {
    const handlers = handlersWith("browser_open", async () => ({
      isError: true,
      content: [{ type: "text", text: "boom" }],
    }));
    const r = await runTool("browser_open", { url: "https://example.com" }, handlers);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    if (!r.body.ok) expect(r.body.error.message).toBe("boom");
  });

  it("passes PARSED args (zod defaults applied) to the handler", async () => {
    let received: Record<string, unknown> | undefined;
    const handlers = handlersWith("browser_click", async (args) => {
      received = args as Record<string, unknown>;
      return { content: [{ type: "text", text: "ok" }] };
    });
    await runTool("browser_click", { target: "Sign in" }, handlers);
    expect(received?.target_type).toBe("text"); // default from clickSchema
  });

  it("treats a missing body as empty args", async () => {
    const handlers = handlersWith("browser_tabs_list", async () => ({ content: [{ type: "text", text: "(no tabs)" }] }));
    const r = await runTool("browser_tabs_list", undefined, handlers);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("parseApiRoute", () => {
  it("GET /api/v1/tools → discovery", () => {
    expect(parseApiRoute("GET", "/api/v1/tools")).toEqual({ kind: "tools" });
  });
  it("POST /api/v1/tools/<name> → tool", () => {
    expect(parseApiRoute("POST", "/api/v1/tools/browser_open")).toEqual({ kind: "tool", name: "browser_open" });
  });
  it("DELETE /api/v1/profiles/<name> → release", () => {
    expect(parseApiRoute("DELETE", "/api/v1/profiles/work")).toEqual({ kind: "release", profile: "work" });
  });
  it("wrong method → method_not_allowed", () => {
    expect(parseApiRoute("GET", "/api/v1/tools/browser_open")).toEqual({ kind: "method_not_allowed" });
    expect(parseApiRoute("POST", "/api/v1/tools")).toEqual({ kind: "method_not_allowed" });
    expect(parseApiRoute("GET", "/api/v1/profiles/work")).toEqual({ kind: "method_not_allowed" });
  });
  it("unknown /api path → null (→ 404)", () => {
    expect(parseApiRoute("GET", "/api/v1/whatever")).toBeNull();
    expect(parseApiRoute("POST", "/api/v1/tools/a/b")).toBeNull();
  });
});

describe("toolsDiscovery", () => {
  it("lists all 36 tools with name + description", () => {
    const d = toolsDiscovery();
    expect(d.tools).toHaveLength(36);
    expect(d.tools.every((t) => t.name.length > 0 && t.description.length > 0)).toBe(true);
    expect(d.tools.map((t) => t.name)).toContain("browser_open");
  });
});
