import { z } from "zod";
import type { BrowserManager } from "../browser.js";

export const cookiesSchema = {
  action: z.enum(["get", "set", "clear"])
    .describe(
      "What to do. 'get' returns cookies for given URLs (or all). 'set' adds or updates " +
      "cookies from `cookies` array. 'clear' removes all cookies (or a filtered subset).",
    ),
  urls: z.array(z.string().url()).max(32).optional()
    .describe("For 'get': list of URLs to scope to. If omitted, all cookies in the profile are returned."),
  cookies: z.array(z.object({
    name: z.string().min(1).max(256),
    value: z.string().max(4_096),
    domain: z.string().max(256).optional(),
    path: z.string().max(1_024).optional(),
    url: z.string().url().optional(),
    expires: z.number().optional()
      .describe("Unix seconds. -1 or absent = session cookie."),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  })).max(64).optional()
    .describe("For 'set': cookies to add/update. Each needs either (domain+path) or a single url."),
  tab_id: z.string().optional().describe("Reserved; currently unused — cookies are context-wide"),
};

export function makeCookiesHandler(browser: BrowserManager) {
  return async (args: {
    action: "get" | "set" | "clear";
    urls?: string[];
    cookies?: Array<{
      name: string; value: string; domain?: string; path?: string;
      url?: string; expires?: number; httpOnly?: boolean; secure?: boolean;
      sameSite?: "Strict" | "Lax" | "None";
    }>;
  }) => {
    const ctx = await browser.getContext();

    if (args.action === "get") {
      const all = await ctx.cookies(args.urls);
      if (all.length === 0) {
        return { content: [{ type: "text" as const, text: "(no cookies)" }] };
      }
      const body = all
        .map((c) => {
          const flags = [
            c.secure ? "Secure" : null,
            c.httpOnly ? "HttpOnly" : null,
            c.sameSite ? `SameSite=${c.sameSite}` : null,
          ].filter(Boolean).join(" ");
          const expires = c.expires && c.expires > 0
            ? new Date(c.expires * 1000).toISOString()
            : "session";
          return `${c.name} (${c.domain}${c.path}) = ${c.value}  [${flags}] expires=${expires}`;
        })
        .join("\n");
      return { content: [{ type: "text" as const, text: body }] };
    }

    if (args.action === "set") {
      if (!args.cookies || args.cookies.length === 0) {
        throw new Error("`cookies` array required for action='set'");
      }
      await ctx.addCookies(args.cookies);
      return {
        content: [
          {
            type: "text" as const,
            text: `Set ${args.cookies.length} cookie${args.cookies.length === 1 ? "" : "s"}`,
          },
        ],
      };
    }

    // clear
    await ctx.clearCookies();
    return { content: [{ type: "text" as const, text: "Cleared all cookies" }] };
  };
}
