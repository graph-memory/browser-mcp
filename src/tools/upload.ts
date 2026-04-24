import { z } from "zod";
import { resolve as resolvePath } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { BrowserManager, LocatorType } from "../browser.js";
import { resolveLocator } from "../browser.js";

const LOCATOR_TYPES = ["selector", "label", "testid"] as const;

export const uploadSchema = {
  target: z.string().max(2_048)
    .describe("The <input type=file>. See target_type for semantics. `label` is usually cleanest for forms."),
  target_type: z.enum(LOCATOR_TYPES).default("selector")
    .describe("Locator strategy. selector / label / testid. (role/text rarely apply to file inputs.)"),
  files: z.array(z.string().max(4_096)).min(1).max(32)
    .describe(
      "Absolute or relative paths to files to upload. Relative paths resolve against the supervisor's cwd. " +
      "For <input multiple>, pass several; for single-file inputs, pass one. Each file is validated to exist.",
    ),
  tab_id: z.string().optional().describe("Tab to act on; defaults to the active tab"),
};

export function makeUploadHandler(browser: BrowserManager) {
  return async (args: {
    target: string;
    target_type: (typeof LOCATOR_TYPES)[number];
    files: string[];
    tab_id?: string;
  }) => {
    const absFiles = args.files.map((f) => resolvePath(f));
    for (const f of absFiles) {
      if (!existsSync(f)) throw new Error(`file not found: ${f}`);
      const s = statSync(f);
      if (!s.isFile()) throw new Error(`not a regular file: ${f}`);
    }

    const page = browser.getPage(args.tab_id);
    const loc = resolveLocator(page, args.target, args.target_type as LocatorType).first();
    await loc.setInputFiles(absFiles);

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Uploaded ${absFiles.length} file${absFiles.length === 1 ? "" : "s"} to ${args.target_type}:${args.target}\n  ${absFiles.join("\n  ")}`,
        },
      ],
    };
  };
}
