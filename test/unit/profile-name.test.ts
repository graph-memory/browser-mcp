import { describe, it, expect } from "vitest";
import { validateProfileName } from "../../src/browser.js";

describe("validateProfileName", () => {
  it("accepts simple alphanumeric names", () => {
    expect(validateProfileName("default")).toBe("default");
    expect(validateProfileName("work")).toBe("work");
  });

  it("accepts dash and underscore", () => {
    expect(validateProfileName("my-profile_01")).toBe("my-profile_01");
  });

  it("accepts max-length name (64 chars)", () => {
    const name = "a".repeat(64);
    expect(validateProfileName(name)).toBe(name);
  });

  it("rejects path separators (directory traversal guard)", () => {
    expect(() => validateProfileName("../evil")).toThrow();
    expect(() => validateProfileName("a/b")).toThrow();
    expect(() => validateProfileName("a\\b")).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => validateProfileName("")).toThrow();
  });

  it("rejects over-long names (>64 chars)", () => {
    expect(() => validateProfileName("a".repeat(65))).toThrow();
  });

  it("rejects special chars (dots, spaces, shell)", () => {
    expect(() => validateProfileName("foo bar")).toThrow();
    expect(() => validateProfileName("foo.bar")).toThrow();
    expect(() => validateProfileName("foo;rm")).toThrow();
    expect(() => validateProfileName("foo$(x)")).toThrow();
  });
});
