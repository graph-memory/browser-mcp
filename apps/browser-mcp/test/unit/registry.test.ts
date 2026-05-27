import { describe, it, expect } from "vitest";
import { TOOLS } from "../../src/registry.js";

// The full set of tool names, frozen as a snapshot. If a tool is added/removed,
// update this list deliberately — it guards the registry refactor against silent
// drops (the MCP and REST surfaces both build from TOOLS).
const EXPECTED_NAMES = [
  "browser_open", "browser_read", "browser_tabs_list", "browser_tab_switch", "browser_tab_close",
  "browser_click", "browser_type", "browser_press", "browser_hover", "browser_select_option",
  "browser_check", "browser_drag", "browser_fill_form", "browser_scroll", "browser_back",
  "browser_forward", "browser_reload", "browser_find", "browser_wait", "browser_evaluate",
  "browser_open_visible", "browser_screenshot", "browser_snapshot", "browser_expect",
  "browser_permissions", "browser_save", "browser_upload", "browser_download_wait",
  "browser_cookies", "browser_network_log", "browser_console_log", "browser_network_body",
  "browser_storage", "browser_handle_dialog", "browser_set_geolocation", "browser_configure",
];

describe("tool registry", () => {
  it("registers exactly the expected 36 tools", () => {
    expect(TOOLS).toHaveLength(36);
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...EXPECTED_NAMES].sort());
  });

  it("has unique tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every entry is well-formed (description, inputSchema shape, handler factory)", () => {
    for (const t of TOOLS) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      // inputSchema is a zod raw shape: a plain object whose values are zod types.
      expect(t.inputSchema).toBeTypeOf("object");
      expect(typeof t.makeHandler).toBe("function");
    }
  });

  it("makeHandler produces a callable handler when bound to a browser", () => {
    // Bind against an empty stub — we only assert the factory yields a function,
    // not that the handler runs (that's covered by the per-tool integration tests).
    const stub = {} as Parameters<(typeof TOOLS)[number]["makeHandler"]>[0];
    for (const t of TOOLS) {
      expect(typeof t.makeHandler(stub)).toBe("function");
    }
  });
});
