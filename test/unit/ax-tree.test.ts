import { describe, it, expect } from "vitest";
import {
  renderAxNode,
  filterCompact,
  diffSnapshots,
  type AxNode,
} from "../../src/browser.js";

const sample: AxNode = {
  role: "WebArea",
  name: "Test page",
  children: [
    { role: "heading", name: "Hello", level: 1 },
    {
      role: "navigation",
      children: [
        { role: "link", name: "Home" },
        { role: "link", name: "About" },
      ],
    },
    {
      role: "main",
      children: [
        {
          role: "form",
          children: [
            { role: "textbox", name: "Email", value: "" },
            { role: "checkbox", name: "Remember me", checked: false },
            { role: "button", name: "Sign in" },
          ],
        },
      ],
    },
    {
      role: "generic",
      children: [
        { role: "StaticText", name: "decorative-only" },
      ],
    },
  ],
};

describe("renderAxNode", () => {
  it("renders a tree as indented YAML-ish lines", () => {
    const out = renderAxNode({ role: "button", name: "OK" });
    expect(out).toBe(`- button "OK"`);
  });

  it("escapes embedded quotes in names", () => {
    const out = renderAxNode({ role: "button", name: 'Click "here"' });
    expect(out).toContain('"Click \\"here\\""');
  });

  it("includes attribute annotations in brackets", () => {
    const out = renderAxNode({
      role: "checkbox",
      name: "Accept",
      checked: true,
      disabled: true,
    });
    expect(out).toContain("[checked=true, disabled]");
  });

  it("indents children", () => {
    const lines = renderAxNode(sample).split("\n");
    const heading = lines.find((l) => l.includes("Hello"));
    expect(heading).toMatch(/^  - heading "Hello"/);
  });
});

describe("filterCompact", () => {
  it("keeps interactive elements", () => {
    const out = filterCompact(sample);
    expect(out).not.toBeNull();
    const flat = JSON.stringify(out);
    expect(flat).toContain("textbox");
    expect(flat).toContain("button");
    expect(flat).toContain("checkbox");
  });

  it("keeps structural landmarks (navigation, main, form, heading)", () => {
    const out = filterCompact(sample);
    const flat = JSON.stringify(out);
    expect(flat).toContain("navigation");
    expect(flat).toContain("main");
    expect(flat).toContain("form");
    expect(flat).toContain("heading");
  });

  it("drops purely decorative/generic subtrees", () => {
    const out = filterCompact(sample);
    const flat = JSON.stringify(out);
    expect(flat).not.toContain("decorative-only");
  });

  it("returns null for a leaf node that is not interesting", () => {
    const out = filterCompact({ role: "StaticText", name: "nope" });
    expect(out).toBeNull();
  });

  it("hoists a single interesting descendant through an uninteresting parent", () => {
    const out = filterCompact({
      role: "generic",
      children: [{ role: "button", name: "hoisted" }],
    });
    expect(out).toEqual({ role: "button", name: "hoisted" });
  });

  it("preserves list/listitem so list contents survive in diffs", () => {
    const out = filterCompact({
      role: "list",
      children: [
        { role: "listitem", name: "a" },
        { role: "listitem", name: "b" },
      ],
    });
    expect(out?.role).toBe("list");
    expect(out?.children).toHaveLength(2);
  });
});

describe("diffSnapshots", () => {
  it("reports no changes for identical trees", () => {
    const d = diffSnapshots(sample, sample);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it("detects added nodes", () => {
    const before: AxNode = { role: "list", children: [{ role: "listitem", name: "one" }] };
    const after: AxNode = {
      role: "list",
      children: [
        { role: "listitem", name: "one" },
        { role: "listitem", name: "two" },
      ],
    };
    const d = diffSnapshots(before, after);
    expect(d.added).toContain('listitem "two"');
    expect(d.removed).toEqual([]);
  });

  it("detects removed nodes", () => {
    const before: AxNode = {
      role: "list",
      children: [
        { role: "listitem", name: "one" },
        { role: "listitem", name: "two" },
      ],
    };
    const after: AxNode = { role: "list", children: [{ role: "listitem", name: "one" }] };
    const d = diffSnapshots(before, after);
    expect(d.removed).toContain('listitem "two"');
    expect(d.added).toEqual([]);
  });

  it("detects state changes (checked, focused, value)", () => {
    const before: AxNode = {
      role: "form",
      children: [{ role: "checkbox", name: "Remember", checked: false }],
    };
    const after: AxNode = {
      role: "form",
      children: [{ role: "checkbox", name: "Remember", checked: true }],
    };
    const d = diffSnapshots(before, after);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].signature).toBe('checkbox "Remember"');
    expect(d.changed[0].was).toContain("checked=false");
    expect(d.changed[0].now).toContain("checked=true");
  });

  it("detects value edits on textboxes", () => {
    const before: AxNode = {
      role: "form",
      children: [{ role: "textbox", name: "Email", value: "" }],
    };
    const after: AxNode = {
      role: "form",
      children: [{ role: "textbox", name: "Email", value: "a@b.co" }],
    };
    const d = diffSnapshots(before, after);
    expect(d.changed[0].now).toContain("a@b.co");
  });
});
