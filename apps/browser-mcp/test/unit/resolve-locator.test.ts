import { describe, it, expect, vi } from "vitest";
import { resolveLocator } from "../../src/browser.js";

/**
 * Playwright's Page type has many locator factory methods. For this pure
 * routing test we stub the handful we care about, each returning a distinct
 * tag so we can assert the switch dispatches correctly.
 */
function makePageStub() {
  return {
    locator: vi.fn((sel: string) => ({ __kind: "locator", sel })),
    getByText: vi.fn((t: string, o?: { exact?: boolean }) => ({ __kind: "text", t, o })),
    getByRole: vi.fn((r: string, o?: unknown) => ({ __kind: "role", r, o })),
    getByLabel: vi.fn((t: string, o?: { exact?: boolean }) => ({ __kind: "label", t, o })),
    getByPlaceholder: vi.fn((t: string, o?: { exact?: boolean }) => ({ __kind: "placeholder", t, o })),
    getByTestId: vi.fn((t: string) => ({ __kind: "testid", t })),
  };
}

describe("resolveLocator", () => {
  it("routes selector → page.locator", () => {
    const page = makePageStub();
    const result = resolveLocator(page as never, ".foo", "selector");
    expect(page.locator).toHaveBeenCalledWith(".foo");
    expect((result as { __kind: string }).__kind).toBe("locator");
  });

  it("routes text → getByText with exact flag", () => {
    const page = makePageStub();
    resolveLocator(page as never, "Hello", "text", { exact: true });
    expect(page.getByText).toHaveBeenCalledWith("Hello", { exact: true });
  });

  it("text default exact=false", () => {
    const page = makePageStub();
    resolveLocator(page as never, "Hello", "text");
    expect(page.getByText).toHaveBeenCalledWith("Hello", { exact: false });
  });

  it("routes role → getByRole, defaults role to 'button'", () => {
    const page = makePageStub();
    resolveLocator(page as never, "Sign in", "role");
    expect(page.getByRole).toHaveBeenCalledWith("button", { name: "Sign in", exact: false });
  });

  it("role accepts custom role from opts", () => {
    const page = makePageStub();
    resolveLocator(page as never, "My tab", "role", { role: "tab", exact: true });
    expect(page.getByRole).toHaveBeenCalledWith("tab", { name: "My tab", exact: true });
  });

  it("routes label → getByLabel", () => {
    const page = makePageStub();
    resolveLocator(page as never, "Email", "label");
    expect(page.getByLabel).toHaveBeenCalledWith("Email", { exact: false });
  });

  it("routes placeholder → getByPlaceholder", () => {
    const page = makePageStub();
    resolveLocator(page as never, "Search…", "placeholder");
    expect(page.getByPlaceholder).toHaveBeenCalledWith("Search…", { exact: false });
  });

  it("routes testid → getByTestId (no exact flag)", () => {
    const page = makePageStub();
    resolveLocator(page as never, "login-btn", "testid");
    expect(page.getByTestId).toHaveBeenCalledWith("login-btn");
  });
});
