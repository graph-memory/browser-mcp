import { describe, it, expect } from "vitest";
import { cdpAxToTree, collapseRedundantText, type AxCdpNode, type AxNode } from "../../src/browser.js";

function n(id: string, role: string, name?: string, extras: Partial<AxCdpNode> = {}): AxCdpNode {
  const base: AxCdpNode = {
    nodeId: id,
    role: { type: "role", value: role },
    ...(name !== undefined ? { name: { type: "string", value: name } } : {}),
  };
  return { ...base, ...extras };
}

function parent(p: string, child: AxCdpNode): AxCdpNode {
  return { ...child, parentId: p };
}

describe("cdpAxToTree", () => {
  it("returns null when the node list is empty", () => {
    expect(cdpAxToTree([], true)).toBeNull();
  });

  it("returns null when no root can be identified", () => {
    // Every node references a parent that's also in the map → cycle / malformed
    const nodes: AxCdpNode[] = [
      { nodeId: "a", parentId: "b", role: { type: "role", value: "x" } },
      { nodeId: "b", parentId: "a", role: { type: "role", value: "y" } },
    ];
    expect(cdpAxToTree(nodes, true)).toBeNull();
  });

  it("builds a minimal tree from a single root", () => {
    const nodes: AxCdpNode[] = [n("root", "WebArea", "Title")];
    const tree = cdpAxToTree(nodes, true);
    expect(tree).toEqual({ role: "WebArea", name: "Title" });
  });

  it("defaults role to 'generic' when role is missing", () => {
    const nodes: AxCdpNode[] = [{ nodeId: "r" }];
    const tree = cdpAxToTree(nodes, false);
    expect(tree?.role).toBe("generic");
  });

  it("wires childIds into a nested tree", () => {
    const nodes: AxCdpNode[] = [
      { nodeId: "r", role: { type: "role", value: "WebArea" }, childIds: ["c1", "c2"] },
      parent("r", n("c1", "heading", "h1")),
      parent("r", n("c2", "button", "OK")),
    ];
    const tree = cdpAxToTree(nodes, true);
    expect(tree?.children).toHaveLength(2);
    expect(tree?.children?.[0]).toMatchObject({ role: "heading", name: "h1" });
    expect(tree?.children?.[1]).toMatchObject({ role: "button", name: "OK" });
  });

  it("skips noisy InlineTextBox when interestingOnly is true", () => {
    const nodes: AxCdpNode[] = [
      { nodeId: "r", role: { type: "role", value: "paragraph" }, childIds: ["i"] },
      parent("r", n("i", "InlineTextBox", "noise")),
    ];
    const tree = cdpAxToTree(nodes, true);
    expect(tree?.children).toBeUndefined();
  });

  it("keeps InlineTextBox when interestingOnly is false", () => {
    const nodes: AxCdpNode[] = [
      { nodeId: "r", role: { type: "role", value: "paragraph" }, childIds: ["i"] },
      parent("r", n("i", "InlineTextBox", "noise")),
    ];
    const tree = cdpAxToTree(nodes, false);
    expect(tree?.children?.[0].role).toBe("InlineTextBox");
  });

  it("hoists single child of an ignored node", () => {
    const nodes: AxCdpNode[] = [
      { nodeId: "r", role: { type: "role", value: "WebArea" }, childIds: ["ig"] },
      { nodeId: "ig", parentId: "r", ignored: true, childIds: ["c"] },
      parent("ig", n("c", "button", "OK")),
    ];
    const tree = cdpAxToTree(nodes, true);
    // The ignored wrapper is gone; the button sits directly under WebArea.
    expect(tree?.children?.[0]).toMatchObject({ role: "button", name: "OK" });
  });

  it("wraps multiple children of an ignored node in a 'group'", () => {
    const nodes: AxCdpNode[] = [
      { nodeId: "r", role: { type: "role", value: "WebArea" }, childIds: ["ig"] },
      { nodeId: "ig", parentId: "r", ignored: true, childIds: ["a", "b"] },
      parent("ig", n("a", "button", "A")),
      parent("ig", n("b", "button", "B")),
    ];
    const tree = cdpAxToTree(nodes, true);
    expect(tree?.children?.[0].role).toBe("group");
    expect(tree?.children?.[0].children).toHaveLength(2);
  });

  it("drops an ignored leaf entirely", () => {
    const nodes: AxCdpNode[] = [
      { nodeId: "r", role: { type: "role", value: "WebArea" }, childIds: ["ig"] },
      { nodeId: "ig", parentId: "r", ignored: true },
    ];
    const tree = cdpAxToTree(nodes, true);
    expect(tree?.children).toBeUndefined();
  });

  it("carries value, description, checked/disabled/focused/selected/required/readonly through", () => {
    const props = [
      { name: "disabled", value: { type: "boolean", value: true } },
      { name: "required", value: { type: "boolean", value: true } },
      { name: "readonly", value: { type: "boolean", value: true } },
      { name: "focused", value: { type: "boolean", value: true } },
      { name: "selected", value: { type: "boolean", value: true } },
      { name: "checked", value: { type: "boolean", value: true } },
      { name: "pressed", value: { type: "boolean", value: true } },
      { name: "expanded", value: { type: "boolean", value: false } },
      { name: "level", value: { type: "integer", value: 2 } },
      { name: "invalid", value: { type: "string", value: "spelling" } },
      { name: "valuemin", value: { type: "integer", value: 0 } },
      { name: "valuemax", value: { type: "integer", value: 10 } },
      { name: "valuetext", value: { type: "string", value: "fifty percent" } },
      { name: "roledescription", value: { type: "string", value: "slider" } },
      { name: "haspopup", value: { type: "string", value: "menu" } },
      { name: "orientation", value: { type: "string", value: "horizontal" } },
      { name: "multiline", value: { type: "boolean", value: true } },
      { name: "multiselectable", value: { type: "boolean", value: true } },
      { name: "autocomplete", value: { type: "string", value: "list" } },
      { name: "modal", value: { type: "boolean", value: true } },
      { name: "keyshortcuts", value: { type: "string", value: "Ctrl+S" } },
    ];
    const nodes: AxCdpNode[] = [
      {
        nodeId: "r",
        role: { type: "role", value: "slider" },
        name: { type: "string", value: "Volume" },
        value: { type: "integer", value: 50 },
        description: { type: "string", value: "Audio volume" },
        properties: props,
      },
    ];
    const tree = cdpAxToTree(nodes, false);
    expect(tree).toMatchObject({
      role: "slider",
      name: "Volume",
      value: 50,
      description: "Audio volume",
      disabled: true,
      required: true,
      readonly: true,
      focused: true,
      selected: true,
      checked: true,
      pressed: true,
      expanded: false,
      level: 2,
      invalid: "spelling",
      valuemin: 0,
      valuemax: 10,
      valuetext: "fifty percent",
      roledescription: "slider",
      haspopup: "menu",
      orientation: "horizontal",
      multiline: true,
      multiselectable: true,
      autocomplete: "list",
      modal: true,
      keyshortcuts: "Ctrl+S",
    });
  });

  it("interprets 'mixed' checked/pressed literally", () => {
    const nodes: AxCdpNode[] = [
      {
        nodeId: "r",
        role: { type: "role", value: "checkbox" },
        properties: [
          { name: "checked", value: { type: "tristate", value: "mixed" } },
          { name: "pressed", value: { type: "tristate", value: "mixed" } },
        ],
      },
    ];
    const tree = cdpAxToTree(nodes, false);
    expect(tree?.checked).toBe("mixed");
    expect(tree?.pressed).toBe("mixed");
  });

  it("ignores invalid='false' and autocomplete='none' and haspopup='false' (noise filter)", () => {
    const nodes: AxCdpNode[] = [
      {
        nodeId: "r",
        role: { type: "role", value: "textbox" },
        properties: [
          { name: "invalid", value: { type: "string", value: "false" } },
          { name: "autocomplete", value: { type: "string", value: "none" } },
          { name: "haspopup", value: { type: "string", value: "false" } },
        ],
      },
    ];
    const tree = cdpAxToTree(nodes, false);
    expect(tree?.invalid).toBeUndefined();
    expect(tree?.autocomplete).toBeUndefined();
    expect(tree?.haspopup).toBeUndefined();
  });

  it("treats missing childId lookups as silent skips", () => {
    const nodes: AxCdpNode[] = [
      { nodeId: "r", role: { type: "role", value: "WebArea" }, childIds: ["gone"] },
    ];
    const tree = cdpAxToTree(nodes, true);
    expect(tree?.children).toBeUndefined();
  });

  it("ignored parent with missing child referenced returns null leaf", () => {
    const nodes: AxCdpNode[] = [
      { nodeId: "r", role: { type: "role", value: "WebArea" }, childIds: ["ig"] },
      { nodeId: "ig", parentId: "r", ignored: true, childIds: ["gone"] },
    ];
    const tree = cdpAxToTree(nodes, true);
    expect(tree?.children).toBeUndefined();
  });
});

describe("collapseRedundantText", () => {
  it("leaves a leaf node unchanged", () => {
    const node: AxNode = { role: "button", name: "OK" };
    expect(collapseRedundantText(node)).toEqual(node);
  });

  it("promotes StaticText children's text into an anonymous parent's name", () => {
    const tree: AxNode = {
      role: "listitem",
      children: [
        { role: "ListMarker", name: "•" },
        { role: "StaticText", name: "buy milk" },
      ],
    };
    const out = collapseRedundantText(tree);
    expect(out.name).toBe("buy milk");
    // StaticText child is consumed; ListMarker stays.
    expect(out.children?.map((c) => c.role)).toEqual(["ListMarker"]);
  });

  it("joins multiple StaticText children with a space", () => {
    const tree: AxNode = {
      role: "cell",
      children: [
        { role: "StaticText", name: "Hello" },
        { role: "StaticText", name: "world" },
      ],
    };
    const out = collapseRedundantText(tree);
    expect(out.name).toBe("Hello world");
    expect(out.children).toBeUndefined();
  });

  it("does not promote when parent already has a name", () => {
    const tree: AxNode = {
      role: "button",
      name: "Click me",
      children: [{ role: "StaticText", name: "filler" }],
    };
    const out = collapseRedundantText(tree);
    expect(out.name).toBe("Click me");
    // StaticText remains because its text doesn't match the parent name.
    expect(out.children?.[0].role).toBe("StaticText");
  });

  it("drops StaticText child whose text matches the parent's name exactly", () => {
    const tree: AxNode = {
      role: "link",
      name: "Home",
      children: [{ role: "StaticText", name: "Home" }],
    };
    const out = collapseRedundantText(tree);
    expect(out.name).toBe("Home");
    expect(out.children).toBeUndefined();
  });

  it("recurses into grandchildren", () => {
    const tree: AxNode = {
      role: "list",
      children: [
        {
          role: "listitem",
          children: [{ role: "StaticText", name: "one" }],
        },
        {
          role: "listitem",
          children: [{ role: "StaticText", name: "two" }],
        },
      ],
    };
    const out = collapseRedundantText(tree);
    expect(out.children?.[0].name).toBe("one");
    expect(out.children?.[1].name).toBe("two");
  });

  it("ignores StaticText with its own children when considering promotion", () => {
    const tree: AxNode = {
      role: "generic",
      children: [
        {
          role: "StaticText",
          name: "wrapper",
          children: [{ role: "button", name: "inner" }],
        },
      ],
    };
    const out = collapseRedundantText(tree);
    // Can't promote (has children) — parent stays anonymous and child survives.
    expect(out.name).toBeUndefined();
    expect(out.children?.[0].role).toBe("StaticText");
  });

  it("drops the children key when the final kid list is empty", () => {
    const tree: AxNode = {
      role: "link",
      name: "Home",
      children: [{ role: "StaticText", name: "Home" }],
    };
    const out = collapseRedundantText(tree);
    expect("children" in out).toBe(false);
  });
});
