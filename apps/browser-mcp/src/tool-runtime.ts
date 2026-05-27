import { logInfo, logError } from "./log.js";

/**
 * The result shape every tool handler returns. Shared by both transports:
 * the MCP layer maps it to a CallToolResult; the REST layer serializes it to
 * a JSON envelope.
 */
export type ToolResult = {
  isError?: boolean;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  /**
   * Structured payload for the REST surface. Handlers attach the object they
   * already compute (before text formatting). The MCP transport ignores it; the
   * REST router returns it as the response `data`. Optional — action-only tools
   * may omit it and the REST layer falls back to `{ ok, message }`.
   */
  data?: unknown;
};

/**
 * Shape-preserving arg redaction for log lines. Tool args are JSON-stringified
 * by logInfo and can carry passwords (browser_type.text), session cookies
 * (browser_cookies.cookies[].value), full JS expressions, and absolute
 * filesystem paths. Keep the shape (so "what was called" stays debuggable)
 * but blank out the values.
 *
 * Exported for tests.
 */
export function redactToolArgs(name: string, args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  const a = args as Record<string, unknown>;
  switch (name) {
    case "browser_type":
      return "text" in a ? { ...a, text: "«redacted»" } : a;
    case "browser_cookies":
      if (Array.isArray(a.cookies)) {
        return {
          ...a,
          cookies: a.cookies.map((c) =>
            c && typeof c === "object" ? { ...(c as Record<string, unknown>), value: "«redacted»" } : c,
          ),
        };
      }
      return a;
    case "browser_evaluate":
      return "expression" in a ? { ...a, expression: `«redacted ${String(a.expression).length}ch»` } : a;
    case "browser_save":
      return "path" in a ? { ...a, path: "«redacted»" } : a;
    case "browser_upload":
      return Array.isArray(a.files) ? { ...a, files: `«${a.files.length} files»` } : a;
    case "browser_download_wait":
      return "save_to" in a ? { ...a, save_to: "«redacted»" } : a;
    case "browser_fill_form":
      // fields[].value carries typed text (passwords/PII) — same as browser_type.text.
      if (Array.isArray(a.fields)) {
        return {
          ...a,
          fields: a.fields.map((f) =>
            f && typeof f === "object" && "value" in (f as Record<string, unknown>)
              ? { ...(f as Record<string, unknown>), value: "«redacted»" }
              : f,
          ),
        };
      }
      return a;
    case "browser_configure":
      // extra_headers values can be auth tokens (Authorization: Bearer …).
      if (a.extra_headers && typeof a.extra_headers === "object") {
        const redacted = Object.fromEntries(
          Object.keys(a.extra_headers as Record<string, unknown>).map((k) => [k, "«redacted»"]),
        );
        return { ...a, extra_headers: redacted };
      }
      return a;
    case "browser_storage":
      // value can be a session token; key kept for debuggability.
      return "value" in a ? { ...a, value: "«redacted»" } : a;
    case "browser_handle_dialog":
      return "prompt_text" in a ? { ...a, prompt_text: "«redacted»" } : a;
    default:
      return a;
  }
}

/**
 * Wrap a tool handler with structured logging + uniform error handling: logs
 * the (redacted) incoming args and elapsed time, and converts any thrown error
 * into an `{ isError: true }` result instead of propagating. Used by both the
 * MCP and REST transports so behaviour (and redaction) stays identical.
 */
export function withLog<A>(name: string, fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    logInfo(`→ ${name}`, redactToolArgs(name, args));
    const t0 = Date.now();
    try {
      const out = await fn(args);
      logInfo(`✓ ${name} (${Date.now() - t0}ms)`);
      return out;
    } catch (e) {
      logError(`${name} (${Date.now() - t0}ms)`, e);
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error in ${name}: ${msg}` }],
      };
    }
  };
}
