import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import {
  resolveWritePath,
  resolveReadPath,
  downloadSandbox,
  uploadSandbox,
} from "../../src/lib/path-sandbox.js";

describe("path-sandbox", () => {
  let base: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "browser-mcp-sandbox-test-"));
    saved.SANDBOX = process.env.BROWSER_MCP_SANDBOX_DIR;
    saved.WRITE = process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH;
    saved.UP = process.env.BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH;
    process.env.BROWSER_MCP_SANDBOX_DIR = base;
    delete process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH;
    delete process.env.BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH;
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
    if (saved.SANDBOX === undefined) delete process.env.BROWSER_MCP_SANDBOX_DIR;
    else process.env.BROWSER_MCP_SANDBOX_DIR = saved.SANDBOX;
    if (saved.WRITE === undefined) delete process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH;
    else process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH = saved.WRITE;
    if (saved.UP === undefined) delete process.env.BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH;
    else process.env.BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH = saved.UP;
  });

  describe("downloadSandbox / uploadSandbox", () => {
    it("return profile-scoped paths under the base", () => {
      expect(downloadSandbox("default")).toBe(resolvePath(base, "downloads", "default"));
      expect(downloadSandbox("named")).toBe(resolvePath(base, "downloads", "named"));
      expect(uploadSandbox("named")).toBe(resolvePath(base, "uploads", "named"));
    });

    it("empty profileName falls back to 'default'", () => {
      expect(downloadSandbox("")).toBe(resolvePath(base, "downloads", "default"));
      expect(uploadSandbox("")).toBe(resolvePath(base, "uploads", "default"));
    });
  });

  describe("resolveWritePath — default (sandboxed)", () => {
    it("relative path resolves inside the sandbox", () => {
      const out = resolveWritePath("report.pdf", "p1");
      expect(out).toBe(resolvePath(base, "downloads", "p1", "report.pdf"));
    });

    it("absolute path inside the sandbox is allowed", () => {
      const abs = resolvePath(base, "downloads", "p1", "sub", "f.html");
      expect(resolveWritePath(abs, "p1")).toBe(abs);
    });

    it("rejects absolute path outside the sandbox", () => {
      expect(() => resolveWritePath("/etc/passwd", "p1")).toThrow(/escapes the download sandbox/);
      expect(() => resolveWritePath("/Users/prih/.zshrc", "p1")).toThrow();
    });

    it("rejects traversal via ..", () => {
      expect(() => resolveWritePath("../../../../etc/passwd", "p1")).toThrow(/escapes the download sandbox/);
    });

    it("profile scoping prevents cross-profile write", () => {
      const other = resolvePath(base, "downloads", "other-profile", "evil.txt");
      expect(() => resolveWritePath(other, "p1")).toThrow(/escapes the download sandbox/);
    });

    it("creates the sandbox directory on first call", () => {
      resolveWritePath("x.pdf", "brandnew");
      // mkdirSync(recursive) should have created it; a second call works too.
      expect(() => resolveWritePath("y.pdf", "brandnew")).not.toThrow();
    });
  });

  describe("resolveWritePath — with BROWSER_MCP_ALLOW_ANY_WRITE_PATH=1", () => {
    beforeEach(() => { process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH = "1"; });

    it("permits absolute paths outside the sandbox", () => {
      const anywhere = resolvePath(base, "elsewhere", "foo.pdf");
      expect(resolveWritePath(anywhere, "p1")).toBe(anywhere);
    });

    it("permits /etc-style paths", () => {
      // We don't actually write, just resolve — assert no throw.
      expect(() => resolveWritePath("/tmp/anywhere.pdf", "p1")).not.toThrow();
    });
  });

  describe("resolveReadPath — default (sandboxed uploads)", () => {
    it("relative path resolves inside the upload sandbox", () => {
      const out = resolveReadPath("upload.txt", "p1");
      expect(out).toBe(resolvePath(base, "uploads", "p1", "upload.txt"));
    });

    it("rejects path outside the upload sandbox", () => {
      expect(() => resolveReadPath("/etc/passwd", "p1")).toThrow(/escapes the upload sandbox/);
      expect(() => resolveReadPath("/Users/prih/.ssh/id_rsa", "p1")).toThrow();
    });

    it("rejects traversal", () => {
      expect(() => resolveReadPath("../../../../etc/passwd", "p1")).toThrow();
    });
  });

  describe("resolveReadPath — with BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH=1", () => {
    beforeEach(() => { process.env.BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH = "1"; });

    it("permits arbitrary absolute paths", () => {
      expect(resolveReadPath("/tmp/anything.txt", "p1")).toBe(resolvePath("/tmp/anything.txt"));
    });
  });

  describe("opt-in env values", () => {
    it("'0' does NOT opt-in for writes", () => {
      process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH = "0";
      expect(() => resolveWritePath("/etc/passwd", "p1")).toThrow();
    });

    it("empty string does NOT opt-in for writes", () => {
      process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH = "";
      expect(() => resolveWritePath("/etc/passwd", "p1")).toThrow();
    });

    it("any non-'0' non-empty value opts in", () => {
      process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH = "true";
      expect(() => resolveWritePath("/tmp/x.pdf", "p1")).not.toThrow();
    });
  });
});
