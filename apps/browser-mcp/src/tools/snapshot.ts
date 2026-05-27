import { z } from "zod";
import { BrowserManager, renderAxNode, filterCompact, diffSnapshots } from "../browser.js";

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
  compact: z
    .boolean()
    .optional()
    .describe(
      "Strip to interactive elements only (buttons, links, textboxes, checkboxes, menu items) " +
      "plus structural landmarks (headings, nav, main, dialogs, forms). Much more token-efficient " +
      "when you just need 'what can I click/type'. Defaults to false — but when `diff_against` is " +
      "set, defaults to true, because generic-container noise produces useless diffs otherwise.",
    ),
  store_as: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "If set, save this snapshot under this name for later diffing. E.g. 'before-login'. " +
      "Overwrites any previous snapshot with the same name.",
    ),
  diff_against: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "If set, compute a diff vs a previously-stored snapshot with this name. Returns lists of " +
      "added / removed / changed elements instead of the full tree. Combine with `store_as` to " +
      "roll forward (diff vs 'before-login' + store as 'after-login').",
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
    compact?: boolean;
    store_as?: string;
    diff_against?: string;
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

    // When using named storage (store_as OR diff_against), default to compact —
    // full trees have generic containers that shift position, producing
    // unreadable diffs. Store and diff must use the same mode to match.
    const compact = args.compact ?? (!!args.diff_against || !!args.store_as);
    const effective = compact ? (filterCompact(node) ?? node) : node;

    // Diff path: return change set rather than the tree.
    if (args.diff_against) {
      const prev = browser.getStoredSnapshot(args.diff_against);
      if (!prev) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `No stored snapshot named "${args.diff_against}". Use store_as= on an earlier call first.` }],
        };
      }
      const d = diffSnapshots(prev, effective);
      if (args.store_as) browser.storeSnapshot(args.store_as, effective);

      if (d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0) {
        return { content: [{ type: "text" as const, text: `No changes since "${args.diff_against}"` }] };
      }
      const lines: string[] = [`── diff vs "${args.diff_against}" ──`];
      if (d.added.length) {
        lines.push(`\nAdded (${d.added.length}):`);
        for (const a of d.added.slice(0, 100)) lines.push(`  + ${a}`);
        if (d.added.length > 100) lines.push(`  …(${d.added.length - 100} more)`);
      }
      if (d.removed.length) {
        lines.push(`\nRemoved (${d.removed.length}):`);
        for (const r of d.removed.slice(0, 100)) lines.push(`  - ${r}`);
        if (d.removed.length > 100) lines.push(`  …(${d.removed.length - 100} more)`);
      }
      if (d.changed.length) {
        lines.push(`\nChanged (${d.changed.length}):`);
        for (const c of d.changed.slice(0, 100)) lines.push(`  ~ ${c.signature}  [${c.was || "-"}] → [${c.now || "-"}]`);
        if (d.changed.length > 100) lines.push(`  …(${d.changed.length - 100} more)`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    if (args.store_as) browser.storeSnapshot(args.store_as, effective);

    const text =
      args.format === "json"
        ? JSON.stringify(effective, null, 2)
        : renderAxNode(effective);

    const stored = args.store_as ? ` [stored as "${args.store_as}"]` : "";
    return { content: [{ type: "text" as const, text: text + (stored ? `\n\n${stored}` : "") }] };
  };
}
