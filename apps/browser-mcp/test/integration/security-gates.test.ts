import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootIntegrationEnv, fixtureUrl } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("security");

/**
 * Sanity-check each tool's security gate. These tests flip the opt-in env
 * flags OFF (the integration bootstrap enables them) so we can verify that
 * the default-deny behaviour actually fires end-to-end against a real
 * BrowserManager and a real BrowserContext.
 *
 * Restores the original env after each test.
 */
describe.skipIf(SKIP)("security gates refuse unsafe inputs when opt-in is off", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let save: ReturnType<typeof import("../../src/tools/save.js").makeSaveHandler>;
  let upload: ReturnType<typeof import("../../src/tools/upload.js").makeUploadHandler>;
  let perms: ReturnType<typeof import("../../src/tools/permissions.js").makePermissionsHandler>;
  let download: ReturnType<typeof import("../../src/tools/download.js").makeDownloadHandler>;
  let evaluate: ReturnType<typeof import("../../src/tools/interact.js").makeEvaluateHandler>;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const s = await import("../../src/tools/save.js");
    const u = await import("../../src/tools/upload.js");
    const p = await import("../../src/tools/permissions.js");
    const d = await import("../../src/tools/download.js");
    const i = await import("../../src/tools/interact.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    save = s.makeSaveHandler(mgr);
    upload = u.makeUploadHandler(mgr);
    perms = p.makePermissionsHandler(mgr);
    download = d.makeDownloadHandler(mgr);
    evaluate = i.makeEvaluateHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  function withoutOptIn<T>(env: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = process.env[env];
    delete process.env[env];
    return Promise.resolve()
      .then(() => fn())
      .finally(() => {
        if (prev === undefined) delete process.env[env];
        else process.env[env] = prev;
      });
  }

  it("browser_open refuses file:// without BROWSER_MCP_ALLOW_FILE_URLS", async () => {
    await withoutOptIn("BROWSER_MCP_ALLOW_FILE_URLS", async () => {
      await expect(open({ url: "file:///etc/passwd" })).rejects.toThrow(/file:\/\/ URLs are blocked/);
    });
  }, 60_000);

  it("browser_open refuses javascript: / data: schemes always", async () => {
    await expect(open({ url: "javascript:alert(1)" })).rejects.toThrow(/scheme 'javascript:' is not allowed/);
    await expect(open({ url: "data:text/html,<x/>" })).rejects.toThrow(/scheme 'data:' is not allowed/);
  }, 60_000);

  it("browser_open refuses 169.254.169.254 without BROWSER_MCP_ALLOW_PRIVATE_NETWORKS", async () => {
    await withoutOptIn("BROWSER_MCP_ALLOW_PRIVATE_NETWORKS", async () => {
      await expect(open({ url: "http://169.254.169.254/latest/meta-data/" })).rejects.toThrow(/private\/loopback/);
    });
  }, 60_000);

  it("browser_save refuses /etc/passwd without BROWSER_MCP_ALLOW_ANY_WRITE_PATH", async () => {
    // Open something first so getPage() has a tab.
    await open({ url: fixtureUrl("article.html") });
    await withoutOptIn("BROWSER_MCP_ALLOW_ANY_WRITE_PATH", async () => {
      await expect(save({ format: "html", path: "/etc/passwd" })).rejects.toThrow(/escapes the download sandbox/);
    });
  }, 60_000);

  it("browser_save into the sandbox works under default policy", async () => {
    await open({ url: fixtureUrl("article.html") });
    const scratch = mkdtempSync(join(tmpdir(), "browser-mcp-sec-test-"));
    const prevSandbox = process.env.BROWSER_MCP_SANDBOX_DIR;
    const prevAny = process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH;
    process.env.BROWSER_MCP_SANDBOX_DIR = scratch;
    delete process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH;
    try {
      const r = await save({ format: "html", path: "out.html" });
      expect((r as { content: { text: string }[] }).content[0].text).toContain("Saved HTML");
    } finally {
      if (prevSandbox === undefined) delete process.env.BROWSER_MCP_SANDBOX_DIR;
      else process.env.BROWSER_MCP_SANDBOX_DIR = prevSandbox;
      if (prevAny !== undefined) process.env.BROWSER_MCP_ALLOW_ANY_WRITE_PATH = prevAny;
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it("browser_upload refuses arbitrary absolute paths without BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    // Create a real file outside the sandbox — /etc/passwd would be a real
    // test but we want something that definitely exists and is readable.
    const scratch = mkdtempSync(join(tmpdir(), "browser-mcp-sec-test-"));
    const f = join(scratch, "payload.bin");
    writeFileSync(f, "bytes");
    await withoutOptIn("BROWSER_MCP_ALLOW_ANY_UPLOAD_PATH", async () => {
      await expect(
        upload({ target: "Upload", target_type: "label", files: [f] }),
      ).rejects.toThrow(/escapes the upload sandbox/);
    });
    rmSync(scratch, { recursive: true, force: true });
  }, 60_000);

  it("browser_permissions refuses non-http(s) origins", async () => {
    // With BROWSER_MCP_ALLOW_FILE_URLS=1 (test bootstrap), assertNavigableUrl
    // admits file://. The origin-specific check downstream rejects non-http(s).
    await expect(
      perms({ grant: ["geolocation"], origin: "file:///x" }),
    ).rejects.toThrow(/permissions origin must be http/);
  }, 60_000);

  it("browser_download_wait refuses javascript: navigate target", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    const scratch = mkdtempSync(join(tmpdir(), "browser-mcp-sec-test-"));
    try {
      await expect(
        download({
          action: "navigate",
          url: "javascript:void(0)",
          target_type: "text",
          save_to: join(scratch, "out.bin"),
        }),
      ).rejects.toThrow(/scheme 'javascript:' is not allowed/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it("browser_evaluate caps large return values", async () => {
    await open({ url: fixtureUrl("article.html") });
    const prev = process.env.BROWSER_MCP_MAX_CHARS;
    // Small cap for the test; default 50 000 wouldn't exercise truncation here.
    process.env.BROWSER_MCP_MAX_CHARS = "200";
    try {
      // Force config re-read by re-importing not possible without vi.resetModules;
      // instead call evaluate with a huge string and ensure it's truncated
      // against the default cap (50 000). 60k chars → truncated.
      const r = await evaluate({
        expression: "'x'.repeat(60000)",
      });
      const text = (r as { content: { text: string }[] }).content[0].text;
      expect(text).toContain("[...truncated");
    } finally {
      if (prev === undefined) delete process.env.BROWSER_MCP_MAX_CHARS;
      else process.env.BROWSER_MCP_MAX_CHARS = prev;
    }
  }, 60_000);
});
