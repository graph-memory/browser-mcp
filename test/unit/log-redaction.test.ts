import { describe, it, expect } from "vitest";
import { redactToolArgs } from "../../src/app.js";

describe("redactToolArgs", () => {
  it("returns primitives/undefined unchanged", () => {
    expect(redactToolArgs("browser_open", undefined)).toBeUndefined();
    expect(redactToolArgs("browser_open", null)).toBeNull();
    expect(redactToolArgs("browser_open", "x")).toBe("x");
    expect(redactToolArgs("browser_open", 42)).toBe(42);
  });

  it("browser_type — redacts the `text` field", () => {
    const out = redactToolArgs("browser_type", {
      target: "Password",
      target_type: "label",
      text: "MyS3cr3tP@ssw0rd",
    }) as Record<string, unknown>;
    expect(out.text).toBe("«redacted»");
    expect(out.target).toBe("Password");
    expect(out.target_type).toBe("label");
  });

  it("browser_cookies — redacts each cookie's value", () => {
    const out = redactToolArgs("browser_cookies", {
      action: "set",
      cookies: [
        { name: "session", value: "eyJhbGciOi…JWT-full", domain: ".x.com" },
        { name: "pref",    value: "dark",                 url: "https://x.com" },
      ],
    }) as { action: string; cookies: Array<Record<string, unknown>> };
    expect(out.action).toBe("set");
    expect(out.cookies[0].value).toBe("«redacted»");
    expect(out.cookies[0].name).toBe("session");
    expect(out.cookies[0].domain).toBe(".x.com");
    expect(out.cookies[1].value).toBe("«redacted»");
  });

  it("browser_cookies — does nothing when no cookies field (e.g. action='get')", () => {
    const out = redactToolArgs("browser_cookies", { action: "get" }) as Record<string, unknown>;
    expect(out).toEqual({ action: "get" });
  });

  it("browser_evaluate — replaces expression with a length marker", () => {
    const expr = "document.cookie + ';' + localStorage.getItem('token')";
    const out = redactToolArgs("browser_evaluate", { expression: expr }) as Record<string, unknown>;
    expect(out.expression).toBe(`«redacted ${expr.length}ch»`);
  });

  it("browser_save — redacts path", () => {
    const out = redactToolArgs("browser_save", { format: "pdf", path: "/Users/prih/.zshrc" }) as Record<string, unknown>;
    expect(out.path).toBe("«redacted»");
    expect(out.format).toBe("pdf");
  });

  it("browser_upload — summarises files", () => {
    const out = redactToolArgs("browser_upload", {
      target: "#up",
      files: ["/etc/passwd", "/Users/x/.ssh/id_rsa", "/tmp/x"],
    }) as Record<string, unknown>;
    expect(out.files).toBe("«3 files»");
    expect(out.target).toBe("#up");
  });

  it("browser_download_wait — redacts save_to", () => {
    const out = redactToolArgs("browser_download_wait", {
      action: "click",
      target: "Download",
      save_to: "/Users/prih/.config/Claude/claude_desktop_config.json",
    }) as Record<string, unknown>;
    expect(out.save_to).toBe("«redacted»");
    expect(out.action).toBe("click");
  });

  it("unrelated tool — passes through untouched", () => {
    const args = { url: "https://example.com", tab_id: "abc" };
    expect(redactToolArgs("browser_open", args)).toEqual(args);
  });
});
