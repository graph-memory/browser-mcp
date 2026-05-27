import { z } from "zod";
import type { BrowserManager } from "../browser.js";

const VIEWPORT_PRESETS: Record<string, { width: number; height: number }> = {
  "mobile":     { width: 375, height: 812 },
  "tablet":     { width: 768, height: 1024 },
  "desktop":    { width: 1280, height: 900 },
  "desktop-hd": { width: 1920, height: 1080 },
  "desktop-2k": { width: 2560, height: 1440 },
};

const UA_PRESETS: Record<string, string> = {
  "chrome-desktop":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "chrome-mobile":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "safari-desktop":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "safari-mobile":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "firefox-desktop":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
};

type DevicePreset = {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent: string;
};

const DEVICE_PRESETS: Record<string, DevicePreset> = {
  "iphone-15": {
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  "iphone-se": {
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  "ipad": {
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  "ipad-pro": {
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
  "pixel-8": {
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  },
  "galaxy-s24": {
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  },
  "desktop-retina": {
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
};

const devicePresetNames = Object.keys(DEVICE_PRESETS) as [string, ...string[]];

export const configureSchema = {
  device_preset: z
    .enum(devicePresetNames)
    .optional()
    .describe(
      "Full device emulation preset. Restarts the browser context (all tabs are closed). " +
      "Sets viewport, deviceScaleFactor, isMobile, hasTouch, and userAgent. " +
      "Available: iphone-15, iphone-se, ipad, ipad-pro, pixel-8, galaxy-s24, desktop-retina. " +
      "Overrides viewport_preset, ua_preset, and device_scale_factor if set.",
    ),
  viewport_preset: z
    .enum(["mobile", "tablet", "desktop", "desktop-hd", "desktop-2k"])
    .optional()
    .describe(
      "Viewport preset (no context restart). mobile=375x812, tablet=768x1024, desktop=1280x900, desktop-hd=1920x1080, desktop-2k=2560x1440. Ignored if device_preset or viewport_width/viewport_height are set.",
    ),
  viewport_width: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Custom viewport width in pixels (no context restart). Must be set together with viewport_height."),
  viewport_height: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Custom viewport height in pixels (no context restart). Must be set together with viewport_width."),
  device_scale_factor: z
    .number()
    .positive()
    .optional()
    .describe("Device pixel ratio, e.g. 2 for retina. Restarts the browser context (all tabs are closed)."),
  is_mobile: z
    .boolean()
    .optional()
    .describe("Enable mobile mode (mobile viewport behavior + touch). Restarts the browser context."),
  user_agent: z
    .string()
    .optional()
    .describe("Custom User-Agent string. Overrides ua_preset if both are set."),
  ua_preset: z
    .enum(["chrome-desktop", "chrome-mobile", "safari-desktop", "safari-mobile", "firefox-desktop"])
    .optional()
    .describe("User-Agent preset. Ignored if user_agent or device_preset is set."),
  locale: z
    .string()
    .optional()
    .describe("Accept-Language locale (e.g. \"en-US\", \"ru-RU\", \"ja-JP\")"),
  color_scheme: z
    .enum(["light", "dark", "no-preference"])
    .optional()
    .describe("Emulated color scheme (prefers-color-scheme)"),
  tab_id: z.string().optional().describe("Tab to apply viewport/color_scheme to; defaults to the active tab. Ignored when context restarts."),
};

export function makeConfigureHandler(browser: BrowserManager) {
  return async ({
    device_preset,
    viewport_preset,
    viewport_width,
    viewport_height,
    device_scale_factor,
    is_mobile,
    user_agent,
    ua_preset,
    locale,
    color_scheme,
    tab_id,
  }: {
    device_preset?: string;
    viewport_preset?: string;
    viewport_width?: number;
    viewport_height?: number;
    device_scale_factor?: number;
    is_mobile?: boolean;
    user_agent?: string;
    ua_preset?: string;
    locale?: string;
    color_scheme?: "light" | "dark" | "no-preference";
    tab_id?: string;
  }) => {
    const applied: string[] = [];

    // Phase 1: collect all context-level overrides before any restart
    type Overrides = Parameters<typeof browser.reconfigure>[0];
    const ctxOverrides: Overrides = {};
    let needsRestart = false;

    if (device_preset) {
      const dev = DEVICE_PRESETS[device_preset];
      Object.assign(ctxOverrides, {
        viewport: dev.viewport,
        deviceScaleFactor: dev.deviceScaleFactor,
        isMobile: dev.isMobile,
        hasTouch: dev.hasTouch,
        userAgent: dev.userAgent,
      });
      needsRestart = true;
      applied.push(`device: ${device_preset} (${dev.viewport.width}x${dev.viewport.height} @${dev.deviceScaleFactor}x, ${dev.isMobile ? "mobile" : "desktop"})`);
    }

    if (!device_preset) {
      if (device_scale_factor !== undefined) {
        ctxOverrides.deviceScaleFactor = device_scale_factor;
        needsRestart = true;
        applied.push(`device_scale_factor: ${device_scale_factor}`);
      }
      if (is_mobile !== undefined) {
        ctxOverrides.isMobile = is_mobile;
        ctxOverrides.hasTouch = is_mobile;
        needsRestart = true;
        applied.push(`mobile: ${is_mobile}`);
      }
    }

    // If restarting, fold viewport/ua/locale/colorScheme into context overrides
    if (needsRestart && !device_preset) {
      if (viewport_width !== undefined && viewport_height !== undefined) {
        ctxOverrides.viewport = { width: viewport_width, height: viewport_height };
        applied.push(`viewport: ${viewport_width}x${viewport_height}`);
      } else if (viewport_preset) {
        ctxOverrides.viewport = VIEWPORT_PRESETS[viewport_preset];
        applied.push(`viewport: ${viewport_preset} (${ctxOverrides.viewport.width}x${ctxOverrides.viewport.height})`);
      }
      const ua = user_agent ?? (ua_preset ? UA_PRESETS[ua_preset] : undefined);
      if (ua) {
        ctxOverrides.userAgent = ua;
        applied.push(`user_agent: ${user_agent ? "custom" : ua_preset!}`);
      }
    }

    if (needsRestart) {
      if (locale) { ctxOverrides.locale = locale; applied.push(`locale: ${locale}`); }
      if (color_scheme) { ctxOverrides.colorScheme = color_scheme; applied.push(`color_scheme: ${color_scheme}`); }
      await browser.reconfigure(ctxOverrides);
    }

    // Phase 2: per-tab / runtime changes (only when no restart happened)
    if (!needsRestart) {
      if (viewport_width !== undefined && viewport_height !== undefined) {
        await browser.setViewport(viewport_width, viewport_height, tab_id);
        applied.push(`viewport: ${viewport_width}x${viewport_height}`);
      } else if (viewport_preset) {
        const vp = VIEWPORT_PRESETS[viewport_preset];
        await browser.setViewport(vp.width, vp.height, tab_id);
        applied.push(`viewport: ${viewport_preset} (${vp.width}x${vp.height})`);
      }

      const ua = user_agent ?? (ua_preset ? UA_PRESETS[ua_preset] : undefined);
      if (ua) {
        await browser.setUserAgent(ua);
        applied.push(`user_agent: ${user_agent ? "custom" : ua_preset!}`);
      }

      if (locale) {
        await browser.setLocale(locale);
        applied.push(`locale: ${locale}`);
      }

      if (color_scheme) {
        await browser.setColorScheme(color_scheme, tab_id);
        applied.push(`color_scheme: ${color_scheme}`);
      }
    }

    if (!applied.length) {
      return {
        content: [{ type: "text" as const, text: "No changes — pass at least one parameter." }],
      };
    }

    const warning = needsRestart
      ? "\n(Browser context was restarted — all previously open tabs are closed.)"
      : "";

    return {
      content: [{ type: "text" as const, text: `Applied: ${applied.join(", ")}${warning}` }],
    };
  };
}
