import { describe, it, expect } from "vitest";
import { z } from "zod";
import { cookiesSchema } from "../../src/tools/cookies.js";
import { fillFormSchema } from "../../src/tools/fill-form.js";

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
