import { z } from "zod";
import type { BrowserApi } from "../browser.js";

export const geolocationSchema = {
  latitude: z.number().min(-90).max(90).describe("Latitude in degrees (-90..90)."),
  longitude: z.number().min(-180).max(180).describe("Longitude in degrees (-180..180)."),
  accuracy: z.number().nonnegative().optional().describe("Accuracy in meters (optional)."),
};

export function makeGeolocationHandler(browser: BrowserApi) {
  return async (a: { latitude: number; longitude: number; accuracy?: number }) => {
    await browser.setGeolocation(a.latitude, a.longitude, a.accuracy);
    return {
      content: [{
        type: "text" as const,
        text: `Geolocation set to ${a.latitude}, ${a.longitude}${a.accuracy !== undefined ? ` (±${a.accuracy}m)` : ""}. ` +
          `Grant the 'geolocation' permission (browser_permissions) for the site to read it.`,
      }],
    };
  };
}
