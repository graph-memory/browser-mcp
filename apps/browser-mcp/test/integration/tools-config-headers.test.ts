import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { bootIntegrationEnv, textOf } from "./helpers.js";
import { startTestServer } from "./test-http-server.js";

const SKIP = process.env.SKIP_INTEGRATION === "1";
const { profileDir, profileName } = bootIntegrationEnv("cfghdr");

describe.skipIf(SKIP)("tools/configure — extra_headers", () => {
  let BrowserManager: typeof import("../../src/browser.js").BrowserManager;
  let mgr: InstanceType<typeof BrowserManager>;
  let open: ReturnType<typeof import("../../src/tools/open.js").makeOpenHandler>;
  let evaluate: ReturnType<typeof import("../../src/tools/interact.js").makeEvaluateHandler>;
  let configure: ReturnType<typeof import("../../src/tools/configure.js").makeConfigureHandler>;
  let server: Awaited<ReturnType<typeof startTestServer>>;

  beforeAll(async () => {
    server = await startTestServer({ "/echo": { echoHeaders: true } });
    ({ BrowserManager } = await import("../../src/browser.js"));
    open = (await import("../../src/tools/open.js")).makeOpenHandler(mgr = new BrowserManager(profileName));
    evaluate = (await import("../../src/tools/interact.js")).makeEvaluateHandler(mgr);
    configure = (await import("../../src/tools/configure.js")).makeConfigureHandler(mgr);
  }, 60_000);

  afterAll(async () => {
    if (mgr) await mgr.shutdown().catch(() => {});
    await server?.close();
    rmSync(profileDir, { recursive: true, force: true });
  }, 30_000);

  it("sends custom headers on subsequent requests", async () => {
    const r = await configure({ extra_headers: { "x-test-token": "sekret" } });
    expect(textOf(r)).toContain("extra_headers: x-test-token");
    await open({ url: server.url("/echo") });
    const echoed = textOf(await evaluate({ expression: "document.body.textContent" }));
    expect(echoed).toContain("x-test-token");
    expect(echoed).toContain("sekret");
  }, 60_000);
});
