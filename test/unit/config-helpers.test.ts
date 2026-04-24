import { describe, it, expect } from "vitest";
import { str, num, bool, parseViewport } from "../../src/config.js";

describe("str", () => {
  it("prefers CLI over env over fallback", () => {
    expect(str("cli", "env", "fb")).toBe("cli");
    expect(str(undefined, "env", "fb")).toBe("env");
    expect(str(undefined, undefined, "fb")).toBe("fb");
  });

  it("treats empty strings as defined values (not fallback)", () => {
    expect(str("", "env", "fb")).toBe("");
    expect(str(undefined, "", "fb")).toBe("");
  });
});

describe("num", () => {
  it("prefers CLI numeric over env over fallback", () => {
    expect(num("10", "20", 30)).toBe(10);
    expect(num(undefined, "20", 30)).toBe(20);
    expect(num(undefined, undefined, 30)).toBe(30);
  });

  it("falls through NaN values to next source", () => {
    expect(num("nope", "20", 30)).toBe(20);
    expect(num("nope", "also-nope", 30)).toBe(30);
  });

  it("accepts scientific notation and negative numbers (whatever Number() accepts)", () => {
    expect(num("1e3", undefined, 0)).toBe(1000);
    expect(num(undefined, "-5", 0)).toBe(-5);
  });
});

describe("bool", () => {
  it("CLI boolean wins", () => {
    expect(bool(true, "0", false)).toBe(true);
    expect(bool(false, "1", true)).toBe(false);
  });

  it("env '0' is false, anything else is true", () => {
    expect(bool(undefined, "0", true)).toBe(false);
    expect(bool(undefined, "1", false)).toBe(true);
    expect(bool(undefined, "true", false)).toBe(true);
    expect(bool(undefined, "", false)).toBe(true); // empty string != "0"
  });

  it("falls back when neither CLI nor env are provided", () => {
    expect(bool(undefined, undefined, true)).toBe(true);
    expect(bool(undefined, undefined, false)).toBe(false);
  });
});

describe("parseViewport", () => {
  it("parses WxH strings", () => {
    expect(parseViewport("1920x1080")).toEqual({ width: 1920, height: 1080 });
    expect(parseViewport("800x600")).toEqual({ width: 800, height: 600 });
  });

  it("accepts X as case-insensitive separator", () => {
    expect(parseViewport("1024X768")).toEqual({ width: 1024, height: 768 });
  });

  it("returns undefined for missing, empty, or malformed input", () => {
    expect(parseViewport(undefined)).toBeUndefined();
    expect(parseViewport("")).toBeUndefined();
    expect(parseViewport("1920")).toBeUndefined();
    expect(parseViewport("1920*1080")).toBeUndefined();
    expect(parseViewport("banana")).toBeUndefined();
  });
});
