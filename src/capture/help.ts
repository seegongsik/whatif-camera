/**
 * What to do when a phone will not give the page its camera, location or
 * compass. Chat and social apps open links in their own built-in browsers,
 * which often refuse them; each refusal is turned into the setting that
 * brings it back, worded for the phone in hand.
 */

export type InAppBrowser = {
  app: string;
  /** A link that opens the page in the phone's own browser, when the app has one. */
  open?: string;
};

/** The app whose built-in browser this is, from its user agent; null in a browser of its own (Safari, Chrome and the rest). */
export function inAppBrowser(userAgent: string, href: string): InAppBrowser | null {
  if (/KAKAOTALK/i.test(userAgent)) return { app: "KakaoTalk", open: `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}` };
  if (/\bLine\//.test(userAgent)) {
    // LINE opens a link in the phone's browser when it carries this parameter.
    const url = new URL(href);
    url.searchParams.set("openExternalBrowser", "1");
    return { app: "LINE", open: url.toString() };
  }
  if (/NAVER\(inapp/i.test(userAgent)) return { app: "NAVER" };
  if (/DaumApps/i.test(userAgent)) return { app: "Daum" };
  if (/\bBAND\//.test(userAgent)) return { app: "BAND" };
  if (/Instagram/i.test(userAgent)) return { app: "Instagram" };
  if (/FBAN|FBAV|FB_IAB/.test(userAgent)) return { app: "Facebook" };
  return null;
}

export function isIOS(userAgent: string): boolean {
  return /iP(hone|ad|od)/.test(userAgent);
}

/** Past this the fix is a rough area (Precise Location off, or no GPS yet), too wide to find a street. */
export const APPROXIMATE_FIX_M = 1000;

const iosBrowser = (userAgent: string) => (/CriOS/.test(userAgent) ? "Chrome" : /FxiOS/.test(userAgent) ? "Firefox" : /EdgiOS/.test(userAgent) ? "Edge" : "Safari");

/** The camera would not open: the reason, and the setting to change. */
export function cameraHelp(error: unknown, userAgent: string): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (!isIOS(userAgent)) return "The camera is blocked for this site. Allow it in the browser's site settings (beside the address), then reload the page.";
    const app = iosBrowser(userAgent);
    return `The camera is blocked for this site. On iPhone: Settings → Apps → ${app} → Camera → Ask or Allow${app === "Safari" ? " (or in Safari, the page menu → Website Settings → Camera)" : ""}. Then reload the page.`;
  }
  // A browser built into another app may have no camera for pages at all.
  if (name === "NotSupportedError" || name === "TypeError") return "This browser cannot open the camera. Open the page in Safari or Chrome (not inside another app), or use a photo.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device. Use a photo instead.";
  if (name === "NotReadableError" || name === "AbortError") return "The camera is busy in another app. Close it and try again.";
  return error instanceof Error ? error.message : String(error);
}

/** Location refused or missing (the code from GeolocationPositionError): the setting to change. */
export function locationHelp(code: number, userAgent: string): string {
  if (code === 1) {
    if (!isIOS(userAgent)) return "Location is blocked for this site. Allow it in the browser's site settings, then reload the page.";
    const app = iosBrowser(userAgent);
    return `Location is blocked. On iPhone: Settings → Privacy & Security → Location Services → ${app === "Safari" ? "Safari Websites" : app} → While Using the App, with Precise Location on. Then reload the page.`;
  }
  if (code === 3) return "Location is taking a while: step out from under cover and wait a moment.";
  return "Location is not available: check that Location Services are on.";
}

/** After this long with neither a fix nor a refusal, the question about location most likely never reached the screen. */
export const LOCATION_WAIT_MS = 8000;

/** No fix and no refusal after a while: location is most likely off for this browser, so the phone never asked. */
export function waitingHelp(userAgent: string): string {
  if (!isIOS(userAgent)) return "Still no location. Check that location is on and allowed for this browser, then reload the page.";
  const app = iosBrowser(userAgent);
  return `Still no location. On iPhone: Settings → Privacy & Security → Location Services on, then ${app === "Safari" ? "Safari Websites" : app} → While Using the App, with Precise Location on. Then reload the page and allow location.`;
}

/** The fix is only a rough area: almost always Precise Location turned off. */
export function approximateHelp(accuracyM: number, userAgent: string): string {
  const km = (accuracyM / 1000).toFixed(1);
  if (!isIOS(userAgent)) return `Your location is only known to ±${km} km, too rough to find the street. Allow precise location for this browser, or wait for GPS.`;
  const app = iosBrowser(userAgent);
  return `Your location is only known to ±${km} km, too rough to find the street. On iPhone: Settings → Privacy & Security → Location Services → ${app === "Safari" ? "Safari Websites" : app} → Precise Location on. Or wait for GPS outdoors.`;
}
