import { z } from "zod";
import { BrowserManager, renderAxNode } from "../browser.js";

export const snapshotSchema = {
  tab_id: z
    .string()
    .optional()
    .describe("Tab to snapshot; defaults to the active tab"),
  selector: z
    .string()
    .max(2_048)
    .optional()
    .describe(
      "If set, snapshot only the subtree rooted at this CSS selector. " +
      "Useful for focusing on a form or panel without dragging in the whole page.",
    ),
  max_depth: z
    .number()
    .int()
    .min(0)
    .max(50)
    .optional()
    .describe(
      "Limit tree depth. Deeper children are replaced with a 'N hidden children' summary. " +
      "Unset = no limit (default). Use to cut tokens on huge pages.",
    ),
  interesting_only: z
    .boolean()
    .default(true)
    .describe(
      "Playwright filter: when true (default), prune decorative/hidden nodes. " +
      "Set false to get the full raw a11y tree (much more verbose).",
    ),
  format: z
    .enum(["yaml", "json"])
    .default("yaml")
    .describe(
      "Output format. 'yaml' (default) is a compact indented tree, human-readable " +
      "and token-cheap. 'json' is the raw Playwright AXNode for programmatic use.",
    ),
};

export function makeSnapshotHandler(browser: BrowserManager) {
  return async (args: {
    tab_id?: string;
    selector?: string;
    max_depth?: number;
    interesting_only: boolean;
    format: "yaml" | "json";
  }) => {
    const node = await browser.a11ySnapshot({
      tabId: args.tab_id,
      selector: args.selector,
      maxDepth: args.max_depth,
      interestingOnly: args.interesting_only,
    });

    if (!node) {
      return {
        content: [
          { type: "text" as const, text: "(empty accessibility tree — page may still be loading)" },
        ],
      };
    }

    const text =
      args.format === "json"
        ? JSON.stringify(node, null, 2)
        : renderAxNode(node);

    return { content: [{ type: "text" as const, text }] };
  };
}
