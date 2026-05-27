import { z } from "zod";
import { TOOLS } from "./registry.js";
import type { ToolResult } from "./tool-runtime.js";

/**
 * Pure pieces of the REST surface — no browser/session lifecycle here, so they
 * are unit-testable with a fake handler map. The stateful wiring (profile
 * holders, guards, body reading) lives in `handleRest` inside createApp.
 */

export type RestHandlers = Map<string, (args: unknown) => Promise<ToolResult>>;

export type RestEnvelope =
  | { ok: true; data?: unknown; content: ToolResult["content"] }
  | { ok: false; error: { message: string; issues?: unknown }; data?: unknown; content?: ToolResult["content"] };

export type RunToolResult = { status: number; body: RestEnvelope };

const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

/** First text block of a tool result — used as the REST error message. */
function firstText(content: ToolResult["content"]): string | undefined {
  for (const c of content) if (c.type === "text") return c.text;
  return undefined;
}

/**
 * Run one tool by name against a pre-built per-session handler map.
 *
 * HTTP status reflects the TRANSPORT only:
 *   404 — unknown tool
 *   400 — arguments fail zod validation (caught before the handler runs)
 *   200 — the tool ran; success OR a tool-level `isError` both return 200, with
 *         the outcome in the body (`ok: false` mirrors how MCP carries tool
 *         errors inside a 200 response).
 */
export async function runTool(
  name: string,
  rawArgs: unknown,
  handlers: RestHandlers,
): Promise<RunToolResult> {
  const tool = toolByName.get(name);
  const handler = handlers.get(name);
  if (!tool || !handler) {
    return { status: 404, body: { ok: false, error: { message: `unknown tool: ${name}` } } };
  }

  const parsed = z.object(tool.inputSchema).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      status: 400,
      body: { ok: false, error: { message: "invalid arguments", issues: parsed.error.issues } },
    };
  }

  // Pass the PARSED value so zod defaults (e.g. target_type:"text") are applied,
  // exactly as the MCP path gets them.
  const result = await handler(parsed.data);
  if (result.isError) {
    return {
      status: 200,
      body: {
        ok: false,
        error: { message: firstText(result.content) ?? "tool error" },
        data: result.data,
        content: result.content,
      },
    };
  }
  return { status: 200, body: { ok: true, data: result.data, content: result.content } };
}

/** Discovery payload for GET /api/v1/tools. Input schemas are added in the OpenAPI phase. */
export function toolsDiscovery(): { tools: Array<{ name: string; description: string }> } {
  return { tools: TOOLS.map((t) => ({ name: t.name, description: t.description })) };
}

export type ApiRoute =
  | { kind: "tool"; name: string }
  | { kind: "tools" }
  | { kind: "release"; profile: string }
  | { kind: "method_not_allowed" }
  | null;

/** Match an /api/v1 request to a route. Returns null for unknown /api paths (→ 404). */
export function parseApiRoute(method: string, pathname: string): ApiRoute {
  if (pathname === "/api/v1/tools") {
    return method === "GET" ? { kind: "tools" } : { kind: "method_not_allowed" };
  }
  const tool = pathname.match(/^\/api\/v1\/tools\/([^/]+)$/);
  if (tool) {
    return method === "POST" ? { kind: "tool", name: decodeURIComponent(tool[1]) } : { kind: "method_not_allowed" };
  }
  // Proactively release a profile holder (otherwise reaped by idle-TTL).
  const profile = pathname.match(/^\/api\/v1\/profiles\/([^/]+)$/);
  if (profile) {
    return method === "DELETE" ? { kind: "release", profile: decodeURIComponent(profile[1]) } : { kind: "method_not_allowed" };
  }
  return null;
}
