import { z } from "zod";
import type { BrowserApi } from "../browser.js";

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
  }).refine(
    (c) => Boolean(c.url) || Boolean(c.domain && c.path),
    { message: "each cookie needs either `url`, or both `domain` and `path`" },
  )).max(64).optional()
    .describe("For 'set': cookies to add/update. Each needs either a single `url`, or both `domain` and `path`."),
};

export function makeCookiesHandler(browser: BrowserApi) {
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
        return { content: [{ type: "text" as const, text: "(no cookies)" }], data: { cookies: [] } };
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
      return { content: [{ type: "text" as const, text: body }], data: { cookies: all } };
    }

    if (args.action === "set") {
      if (!args.cookies || args.cookies.length === 0) {
        return { isError: true, content: [{ type: "text" as const, text: "`cookies` array required for action='set'" }] };
      }
      await ctx.addCookies(args.cookies);
      return {
        content: [
          {
            type: "text" as const,
            text: `Set ${args.cookies.length} cookie${args.cookies.length === 1 ? "" : "s"}`,
          },
        ],
        data: { ok: true, count: args.cookies.length },
      };
    }

    // clear
    await ctx.clearCookies();
    return { content: [{ type: "text" as const, text: "Cleared all cookies" }], data: { ok: true } };
  };
}
