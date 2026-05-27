import { describe, it, expect } from "vitest";
import { z } from "zod";
import { cookiesSchema } from "../../src/tools/cookies.js";
import { fillFormSchema } from "../../src/tools/fill-form.js";
import { typeSchema } from "../../src/tools/interact.js";
import { expectSchema } from "../../src/tools/expect.js";
import { downloadSchema } from "../../src/tools/download.js";

// Schema-level validation lives at the MCP transport boundary (registerTool runs
// zod before the handler). Handlers are unit-tested directly and bypass zod, so
// schema refinements get their own coverage here.

describe("cookiesSchema — cookie identity refine", () => {
  const schema = z.object(cookiesSchema);

  it("accepts a cookie scoped by url", () => {
    const r = schema.safeParse({
      action: "set",
      cookies: [{ name: "a", value: "1", url: "https://example.com/" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a cookie scoped by domain + path", () => {
    const r = schema.safeParse({
      action: "set",
      cookies: [{ name: "a", value: "1", domain: "example.com", path: "/" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a cookie with neither url nor domain+path", () => {
    const r = schema.safeParse({
      action: "set",
      cookies: [{ name: "a", value: "1" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain("either `url`");
    }
  });

  it("rejects a cookie with domain but no path", () => {
    const r = schema.safeParse({
      action: "set",
      cookies: [{ name: "a", value: "1", domain: "example.com" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("fillFormSchema — field exactly-one refine", () => {
  const schema = z.object(fillFormSchema);

  it("accepts a field with just a value", () => {
    expect(schema.safeParse({ fields: [{ target: "Email", value: "x" }] }).success).toBe(true);
  });

  it("accepts a field with just checked", () => {
    expect(schema.safeParse({ fields: [{ target: "Agree", checked: true }] }).success).toBe(true);
  });

  it("rejects a field with two properties (value + checked)", () => {
    const r = schema.safeParse({ fields: [{ target: "x", value: "a", checked: true }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain("exactly one");
  });

  it("rejects a field with none of value/checked/options", () => {
    expect(schema.safeParse({ fields: [{ target: "x" }] }).success).toBe(false);
  });
});

describe("locator defaults — target_type defaults to 'text' (F2)", () => {
  it("type defaults target_type to text", () => {
    const p = z.object(typeSchema).parse({ target: "Email", text: "x" });
    expect(p.target_type).toBe("text");
  });
  it("expect defaults target_type to text", () => {
    const p = z.object(expectSchema).parse({ assertion: "visible", target: "Sign in" });
    expect(p.target_type).toBe("text");
  });
  it("download defaults target_type to text", () => {
    const p = z.object(downloadSchema).parse({ save_to: "out/" });
    expect(p.target_type).toBe("text");
  });
  it("type no longer accepts a legacy `selector` key (F7)", () => {
    const parsed = z.object(typeSchema).parse({ target: "#x", target_type: "selector", text: "y", selector: "#legacy" } as Record<string, unknown>);
    expect("selector" in parsed).toBe(false);
  });
});
