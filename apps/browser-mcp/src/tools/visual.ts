import { z } from "zod";
import type { BrowserManager } from "../browser.js";

export const openVisibleSchema = {
  url: z
    .url()
    .describe("URL to open in a visible (non-headless) Chrome window for manual interaction"),
};
export function makeOpenVisibleHandler(browser: BrowserManager) {
  return async ({ url }: { url: string }) => {
    const info = await browser.openVisible(url);
    return {
      content: [
        {
          type: "text" as const,
          text: `Visible browser opened at ${info.url}.\nInteract manually (login, CAPTCHA, etc), then close the window.\nState is saved to the persistent profile; subsequent tools run in the default mode.`,
        },
      ],
    };
  };
}

export const screenshotSchema = {
  full_page: z
    .boolean()
    .default(false)
    .describe("false: viewport only (1280x900). true: the entire scrollable page. Ignored if `selector` is set."),
  selector: z
    .string()
    .max(2_048)
    .optional()
    .describe(
      "If set, capture only this element (CSS selector). Takes precedence over full_page. " +
      "Element is scrolled into view automatically. Returns an error if not found.",
    ),
  tab_id: z.string().optional().describe("Tab to capture; defaults to the active tab"),
};
export function makeScreenshotHandler(browser: BrowserManager) {
  return async ({
    full_page,
    selector,
    tab_id,
  }: {
    full_page: boolean;
    selector?: string;
    tab_id?: string;
  }) => {
    const png = selector
      ? await browser.elementScreenshot(selector, tab_id)
      : await browser.screenshot(full_page, tab_id);
    return {
      content: [
        {
          type: "image" as const,
          data: png.toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  };
}
