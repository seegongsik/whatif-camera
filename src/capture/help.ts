/**
 * What to do when a phone or a computer will not give the page its camera,
 * location or compass. Chat and social apps open links in their own
 * built-in browsers, which often refuse them; each refusal is turned into
 * the setting that brings it back, worded for the device and browser in
 * hand (iPhone, Android, a Mac or Windows; Safari, Chrome, Edge), so a
 * refusal never leaves a page that seems to do nothing.
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

/** The system whose settings a refusal sends you to. */
export type Platform = "ios" | "android" | "mac" | "windows" | "other";

export function platformOf(userAgent: string): Platform {
  if (isIOS(userAgent)) return "ios";
  if (/Android/.test(userAgent)) return "android";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "mac";
  if (/Windows/.test(userAgent)) return "windows";
  return "other";
}

const onComputer = (userAgent: string) => !["ios", "android"].includes(platformOf(userAgent));

/** Past this the fix is a rough area (Precise Location off, or no GPS yet), too wide to find a street. */
export const APPROXIMATE_FIX_M = 1000;

const iosBrowser = (userAgent: string) => (/CriOS/.test(userAgent) ? "Chrome" : /FxiOS/.test(userAgent) ? "Firefox" : /EdgiOS/.test(userAgent) ? "Edge" : "Safari");

/** The browser on a computer or an Android phone, by the name its settings use. */
function browserName(userAgent: string): string {
  if (/Edg(A)?\//.test(userAgent)) return "Microsoft Edge";
  if (/SamsungBrowser\//.test(userAgent)) return "Samsung Internet";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent)) return "Google Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "the browser";
}

/** Where this browser turns a site's camera or location back on. */
function siteSetting(userAgent: string, what: "Location" | "Camera"): string {
  const browser = browserName(userAgent);
  const tap = platformOf(userAgent) === "android" ? "Tap" : "Click";
  if (browser === "Safari") return `In Safari: Safari → Settings → Websites → ${what} → this site → Allow`;
  if (browser === "Firefox") return `${tap} the ${what.toLowerCase()} icon in the address bar and clear the block`;
  // Chrome, Edge and the browsers built like them: the icon at the left end of the address bar.
  const more = browser === "Microsoft Edge" ? "Permissions for this site" : "Site settings";
  return `${tap} the icon at the left end of the address bar and turn ${what} on (or ${more} → ${what} → Allow)`;
}

/** The system's own switch that lets the browser use location or the camera at all, where there is one to name. */
function systemSetting(userAgent: string, what: "Location" | "Camera"): string | null {
  const browser = browserName(userAgent);
  switch (platformOf(userAgent)) {
    case "mac":
      return what === "Location"
        ? `On a Mac: System Settings → Privacy & Security → Location Services on, and on for ${browser}`
        : `On a Mac: System Settings → Privacy & Security → Camera → ${browser} on, then quit and reopen ${browser}`;
    case "windows":
      return what === "Location"
        ? "On Windows: Settings → Privacy & security → Location → Location services on, and Let desktop apps access your location on"
        : "On Windows: Settings → Privacy & security → Camera → Camera access on, and Let desktop apps access your camera on";
    case "android":
      return what === "Location" ? "Location must be on for the phone too (in the quick settings)" : null;
    default:
      return null;
  }
}

/** The camera would not open: the reason, and the setting to change. */
export function cameraHelp(error: unknown, userAgent: string): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (isIOS(userAgent)) {
      const app = iosBrowser(userAgent);
      return `The camera is blocked for this site. On iPhone: Settings → Apps → ${app} → Camera → Ask or Allow${app === "Safari" ? " (or in Safari, the page menu → Website Settings → Camera)" : ""}. Then reload the page.`;
    }
    const system = systemSetting(userAgent, "Camera");
    return `The camera is blocked for this site. ${siteSetting(userAgent, "Camera")}, then reload the page.${system ? ` Still blocked? ${system}.` : ""}`;
  }
  // A browser built into another app may have no camera for pages at all.
  if (name === "NotSupportedError" || name === "TypeError") return "This browser cannot open the camera. Open the page in Safari or Chrome (not inside another app), or use a photo.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return `No camera was found on this ${onComputer(userAgent) ? "computer" : "device"}. Use a photo instead, or fly down a demo street.`;
  if (name === "NotReadableError" || name === "AbortError") return "The camera is busy in another app (a video call?). Close it and try again.";
  return error instanceof Error ? error.message : String(error);
}

/** Location refused or missing (the code from GeolocationPositionError): the setting to change. */
export function locationHelp(code: number, userAgent: string): string {
  const platform = platformOf(userAgent);
  const system = systemSetting(userAgent, "Location");
  if (code === 1) {
    if (platform !== "ios") return `Location is blocked for this site. ${siteSetting(userAgent, "Location")}, then reload the page.${system ? ` Still blocked? ${system}.` : ""}`;
    const app = iosBrowser(userAgent);
    return `Location is blocked. On iPhone: Settings → Privacy & Security → Location Services → ${app === "Safari" ? "Safari Websites" : app} → While Using the App, with Precise Location on. Then reload the page.`;
  }
  if (code === 3) {
    return onComputer(userAgent)
      ? "Location is taking a while: a computer finds where it is from Wi-Fi, so turn Wi-Fi on and wait a moment."
      : "Location is taking a while: step out from under cover and wait a moment.";
  }
  if (platform === "ios") return "Location is not available: check that Location Services are on.";
  return `This ${onComputer(userAgent) ? "computer" : "phone"} could not find where it is.${system ? ` ${system}.` : ""} Then reload the page.`;
}

/** After this long with neither a fix nor a refusal, the question about location most likely never reached the screen. */
export const LOCATION_WAIT_MS = 8000;

/** While the browser is still to ask for location: what to answer, and why. */
export function askingHelp(userAgent: string): string {
  return `${onComputer(userAgent) ? "Your browser" : "Your phone"} asks for your location: choose Allow, so the photo can find the street you are on.`;
}

/** No fix and no refusal after a while: location is most likely off for this browser, so the phone never asked. */
export function waitingHelp(userAgent: string): string {
  const platform = platformOf(userAgent);
  if (platform === "ios") {
    const app = iosBrowser(userAgent);
    return `Still no location. On iPhone: Settings → Privacy & Security → Location Services on, then ${app === "Safari" ? "Safari Websites" : app} → While Using the App, with Precise Location on. Then reload the page and allow location.`;
  }
  const system = systemSetting(userAgent, "Location");
  const asks = platform === "android" ? "The browser asks under the address bar" : `${browserName(userAgent)} asks at the top of the window, or with an icon in the address bar`;
  return `Still no location. ${asks}: allow location for this site.${system ? ` ${system}.` : ""}`;
}

/** The fix is only a rough area: almost always Precise Location turned off (on a computer, a position from the network). */
export function approximateHelp(accuracyM: number, userAgent: string): string {
  const km = (accuracyM / 1000).toFixed(1);
  const platform = platformOf(userAgent);
  if (onComputer(userAgent)) return `This computer only knows roughly where it is (±${km} km, from its network), too rough to find the street. A phone on a street knows it to metres; here, fly down a demo street.`;
  if (platform === "android") {
    const browser = browserName(userAgent);
    return `Your location is only known to ±${km} km, too rough to find the street. Allow precise location: Settings → Location → App location permissions → ${browser} → Use precise location. Or wait for GPS outdoors.`;
  }
  const app = iosBrowser(userAgent);
  return `Your location is only known to ±${km} km, too rough to find the street. On iPhone: Settings → Privacy & Security → Location Services → ${app === "Safari" ? "Safari Websites" : app} → Precise Location on. Or wait for GPS outdoors.`;
}
