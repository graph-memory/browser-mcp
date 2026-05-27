import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logInfo, logError } from "../../src/log.js";

describe("log", () => {
  let err: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    err.mockRestore();
  });

  it("logInfo writes HH:MM:SS.mmm prefix and message", () => {
    logInfo("hello");
    expect(err).toHaveBeenCalledTimes(1);
    const line = (err.mock.calls[0] as unknown[])[0] as string;
    expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] hello$/);
  });

  it("logInfo includes stringified JSON extras", () => {
    logInfo("event", { k: 1, n: "x" });
    const line = (err.mock.calls[0] as unknown[])[0] as string;
    expect(line).toContain('{"k":1,"n":"x"}');
  });

  it("logInfo truncates long JSON extras to 200 chars with ellipsis", () => {
    const huge = { s: "x".repeat(500) };
    logInfo("big", huge);
    const line = (err.mock.calls[0] as unknown[])[0] as string;
    expect(line.length).toBeLessThan(260);
    expect(line).toContain("…");
  });

  it("logInfo handles un-stringifiable extras via String()", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    logInfo("cyclic", cyclic);
    const line = (err.mock.calls[0] as unknown[])[0] as string;
    expect(line).toMatch(/\[object Object\]/);
  });

  it("logInfo omits the trailing blank when no extras are passed", () => {
    logInfo("bare");
    const line = (err.mock.calls[0] as unknown[])[0] as string;
    expect(line).toMatch(/] bare$/);
    expect(line).not.toMatch(/ $/);
  });

  it("logInfo treats explicit undefined as 'no extras'", () => {
    logInfo("void", undefined);
    const line = (err.mock.calls[0] as unknown[])[0] as string;
    expect(line).toMatch(/] void$/);
  });

  it("logError prefixes ERROR and extracts .message from Error", () => {
    logError("doing thing", new Error("boom"));
    const line = (err.mock.calls[0] as unknown[])[0] as string;
    expect(line).toMatch(/ERROR doing thing: boom$/);
  });

  it("logError stringifies non-Error values", () => {
    logError("thing", { not: "an error" });
    const line = (err.mock.calls[0] as unknown[])[0] as string;
    expect(line).toContain("ERROR thing: [object Object]");
  });
});
