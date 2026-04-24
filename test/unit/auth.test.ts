import { describe, it, expect } from "vitest";
import { safeStringEq, hostIsLoopback } from "../../src/lib/auth.js";

describe("safeStringEq", () => {
  it("returns true for equal strings", () => {
    expect(safeStringEq("hello", "hello")).toBe(true);
  });

  it("returns false for unequal same-length strings", () => {
    expect(safeStringEq("hello", "world")).toBe(false);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(safeStringEq("short", "longer string")).toBe(false);
    expect(safeStringEq("", "x")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(safeStringEq("", "")).toBe(true);
  });

  it("handles unicode correctly (compares bytes, not codepoints)", () => {
    expect(safeStringEq("тест", "тест")).toBe(true);
    expect(safeStringEq("тест", "test")).toBe(false); // different byte length
  });
});

describe("hostIsLoopback", () => {
  it("recognizes ipv4 loopback", () => {
    expect(hostIsLoopback("127.0.0.1")).toBe(true);
  });

  it("recognizes ipv6 loopback", () => {
    expect(hostIsLoopback("::1")).toBe(true);
  });

  it("recognizes localhost hostname", () => {
    expect(hostIsLoopback("localhost")).toBe(true);
  });

  it("rejects external addresses", () => {
    expect(hostIsLoopback("0.0.0.0")).toBe(false);
    expect(hostIsLoopback("10.0.0.1")).toBe(false);
    expect(hostIsLoopback("192.168.1.1")).toBe(false);
    expect(hostIsLoopback("example.com")).toBe(false);
  });
});
