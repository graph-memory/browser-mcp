import { z } from "zod";
import type { BrowserManager } from "../browser.js";

const PERMS = [
  "geolocation", "midi", "midi-sysex", "notifications", "camera", "microphone",
  "background-sync", "ambient-light-sensor", "accelerometer", "gyroscope",
  "magnetometer", "clipboard-read", "clipboard-write", "payment-handler",
  "storage-access",
] as const;

export const permissionsSchema = {
  grant: z.union([
    z.literal("all"),
    z.literal("none"),
    z.array(z.enum(PERMS)).max(32),
  ]).describe(
    "Which permissions to grant to the origin. 'all' grants every supported " +
    "permission (camera, mic, geolocation, notifications, clipboard R/W, etc). " +
    "'none' clears all grants. An array lets you pick specific ones.",
  ),
  origin: z.string().url().optional()
    .describe(
      "Origin to grant the permissions for. Defaults to the current tab's origin. " +
      "Use a specific origin like 'https://example.com' to pre-grant before navigation.",
    ),
  tab_id: z.string().optional()
    .describe("Tab whose origin to use when `origin` is omitted. Defaults to active tab."),
};

export function makePermissionsHandler(browser: BrowserManager) {
  return async (args: {
    grant: "all" | "none" | (typeof PERMS)[number][];
    origin?: string;
    tab_id?: string;
  }) => {
    const ctx = await browser.getContext();

    if (args.grant === "none") {
      await ctx.clearPermissions();
      return { content: [{ type: "text" as const, text: "Cleared all permission grants" }] };
    }

    const perms = args.grant === "all" ? [...PERMS] : args.grant;

    let originHint = args.origin;
    if (!originHint) {
      try {
        const page = browser.getPage(args.tab_id);
        const u = new URL(page.url());
        // Playwright only accepts http(s) origins for permissions; skip file://, about:, etc.
        if (u.protocol === "http:" || u.protocol === "https:") originHint = u.origin;
      } catch {
        // no active tab — grant globally
      }
    }

    await ctx.grantPermissions(perms as string[], originHint ? { origin: originHint } : undefined);

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Granted ${perms.length} permission${perms.length === 1 ? "" : "s"}` +
            (originHint ? ` to ${originHint}` : " (any origin)") +
            `:\n  ${perms.join(", ")}`,
        },
      ],
    };
  };
}
