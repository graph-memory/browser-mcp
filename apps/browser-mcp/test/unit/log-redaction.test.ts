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

  it("browser_fill_form — redacts each field's typed value, keeps the rest", () => {
    const out = redactToolArgs("browser_fill_form", {
      fields: [
        { target: "Email", value: "a@b.co" },
        { target: "Password", value: "MyS3cr3t" },
        { target: "Agree", checked: true },
        { target: "Plan", options: ["pro"] },
      ],
      submit: true,
    }) as { fields: Array<Record<string, unknown>>; submit: boolean };
    expect(out.fields[0].value).toBe("«redacted»");
    expect(out.fields[0].target).toBe("Email");
    expect(out.fields[1].value).toBe("«redacted»");
    expect(out.fields[2].checked).toBe(true); // non-value fields untouched
    expect(out.fields[3].options).toEqual(["pro"]);
    expect(out.submit).toBe(true);
  });

  it("browser_configure — redacts extra_headers values, keeps names", () => {
    const out = redactToolArgs("browser_configure", {
      locale: "en-US",
      extra_headers: { Authorization: "Bearer sk-secret", "X-Trace": "abc" },
    }) as { locale: string; extra_headers: Record<string, string> };
    expect(out.locale).toBe("en-US");
    expect(out.extra_headers.Authorization).toBe("«redacted»");
    expect(out.extra_headers["X-Trace"]).toBe("«redacted»");
  });

  it("browser_configure — untouched when no extra_headers", () => {
    const out = redactToolArgs("browser_configure", { viewport_preset: "mobile" });
    expect(out).toEqual({ viewport_preset: "mobile" });
  });

  it("browser_storage — redacts value, keeps key/action", () => {
    const out = redactToolArgs("browser_storage", {
      action: "set", area: "local", key: "token", value: "eyJ…secret",
    }) as Record<string, unknown>;
    expect(out.value).toBe("«redacted»");
    expect(out.key).toBe("token");
    expect(out.action).toBe("set");
  });

  it("browser_handle_dialog — redacts prompt_text", () => {
    const out = redactToolArgs("browser_handle_dialog", {
      action: "accept", prompt_text: "secret answer",
    }) as Record<string, unknown>;
    expect(out.prompt_text).toBe("«redacted»");
    expect(out.action).toBe("accept");
  });

  it("unrelated tool — passes through untouched", () => {
    const args = { url: "https://example.com", tab_id: "abc" };
    expect(redactToolArgs("browser_open", args)).toEqual(args);
  });
});
