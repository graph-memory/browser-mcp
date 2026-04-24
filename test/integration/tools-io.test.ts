import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootIntegrationEnv, fixtureUrl, textOf, isToolError } from "./helpers.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("io");

describe.skipIf(SKIP)("tools/{save,upload,download} — file IO", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let save: ReturnType<typeof import("../../src/tools/save.js").makeSaveHandler>;
  let upload: ReturnType<typeof import("../../src/tools/upload.js").makeUploadHandler>;
  let download: ReturnType<typeof import("../../src/tools/download.js").makeDownloadHandler>;
  let outDir: string;

  beforeAll(async () => {
    ({ BrowserManager } = await import("../../src/browser.js"));
    const o = await import("../../src/tools/open.js");
    const s = await import("../../src/tools/save.js");
    const u = await import("../../src/tools/upload.js");
    const d = await import("../../src/tools/download.js");
    mgr = new BrowserManager(profileName);
    open = o.makeOpenHandler(mgr);
    save = s.makeSaveHandler(mgr);
    upload = u.makeUploadHandler(mgr);
    download = d.makeDownloadHandler(mgr);
    outDir = mkdtempSync(join(tmpdir(), "browser-mcp-io-"));
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }, 30_000);

  // --- save ---
  it("save html — writes HTML to disk", async () => {
    await open({ url: fixtureUrl("article.html") });
    const path = join(outDir, "page.html");
    const r = await save({ format: "html", path });
    expect(textOf(r)).toMatch(/^Saved HTML → /);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("Understanding Accessibility Trees");
  }, 60_000);

  it("save pdf — writes a non-empty PDF buffer in headless mode", async () => {
    await open({ url: fixtureUrl("article.html") });
    const path = join(outDir, "page.pdf");
    const r = await save({ format: "pdf", path });
    expect(textOf(r)).toMatch(/^Saved PDF → /);
    expect(existsSync(path)).toBe(true);
  }, 60_000);

  it("save pdf — full_page + landscape options", async () => {
    await open({ url: fixtureUrl("article.html") });
    const path = join(outDir, "page-lsf.pdf");
    const r = await save({ format: "pdf", path, full_page: true, landscape: true });
    expect(textOf(r)).toMatch(/^Saved PDF → /);
  }, 60_000);

  it("save mhtml — archives page via CDP", async () => {
    await open({ url: fixtureUrl("article.html") });
    const path = join(outDir, "page.mhtml");
    const r = await save({ format: "mhtml", path });
    expect(textOf(r)).toMatch(/^Saved MHTML → /);
    expect(existsSync(path)).toBe(true);
  }, 60_000);

  // --- upload ---
  it("upload — attaches a file to <input type=file>", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    const filePath = join(outDir, "upload-source.txt");
    writeFileSync(filePath, "hello upload");
    const r = await upload({
      target: "Upload",
      target_type: "label",
      files: [filePath],
    });
    const t = textOf(r);
    expect(t).toContain("Uploaded 1 file");
    expect(t).toContain("label:Upload");
  }, 60_000);

  it("upload — plural message for multiple files", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    const a = join(outDir, "a.txt");
    const b = join(outDir, "b.txt");
    writeFileSync(a, "a"); writeFileSync(b, "b");
    const r = await upload({
      target: "#up",
      target_type: "selector",
      files: [a, b],
    });
    expect(textOf(r)).toContain("Uploaded 2 files");
  }, 60_000);

  it("upload — throws when a file does not exist", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    await expect(
      upload({ target: "#up", target_type: "selector", files: [join(outDir, "ghost.txt")] }),
    ).rejects.toThrow(/file not found/);
  }, 60_000);

  it("upload — throws when the path points to a directory", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    await expect(
      upload({ target: "#up", target_type: "selector", files: [outDir] }),
    ).rejects.toThrow(/not a regular file/);
  }, 60_000);

  // --- download ---
  it("download — action='click' on a link with download attribute", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    const target = join(outDir, "dl-hello.txt");
    const r = await download({
      action: "click",
      target: "Get file",
      target_type: "text",
      save_to: target,
    });
    const t = textOf(r);
    expect(t).toMatch(/^Downloaded: /);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("Hello from browser-mcp");
  }, 60_000);

  it("download — save_to ending with '/' uses suggested filename", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    const dir = outDir + "/";
    const r = await download({
      action: "click",
      target: "#dl",
      target_type: "selector",
      save_to: dir,
    });
    expect(textOf(r)).toContain("hello.txt");
    expect(existsSync(join(outDir, "hello.txt"))).toBe(true);
  }, 60_000);

  it("download — action='click' without target throws", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    await expect(
      download({ action: "click", target_type: "selector", save_to: join(outDir, "oops.txt") }),
    ).rejects.toThrow(/target required/);
  }, 60_000);

  it("download — action='navigate' without url throws", async () => {
    await open({ url: fixtureUrl("downloadable.html") });
    await expect(
      download({ action: "navigate", target_type: "selector", save_to: join(outDir, "oops.txt") }),
    ).rejects.toThrow(/url required/);
  }, 60_000);
});
