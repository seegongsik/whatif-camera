import { describe, expect, it } from "vitest";
import { APPROXIMATE_FIX_M, approximateHelp, cameraHelp, inAppBrowser, isIOS, locationHelp } from "../src/capture/help.js";

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const safari = `${IOS} Version/26.0 Mobile/15E148 Safari/604.1`;
const chromeIOS = `${IOS} CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1`;
const kakao = `${IOS} Mobile/15E148 KAKAOTALK 25.8.2`;
const line = `${IOS} Mobile/15E148 Safari Line/15.16.0`;
const naver = `${IOS} Mobile/15E148 NAVER(inapp; search; 2000; 12.15.10; 16PRO)`;
const instagram = `${IOS} Mobile/15E148 Instagram 400.0.0.0.0 (iPhone18,1; iOS 26_0; ko_KR)`;
const android = "Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const page = "https://whatif-camera.vercel.app/?street=37.5,127.03,72";

const named = (name: string) => Object.assign(new Error("refused"), { name });

describe("help when the phone holds back the camera, location or compass", () => {
  it("knows the built-in browsers of chat and social apps, and a way out where the app has one", () => {
    expect(inAppBrowser(safari, page)).toBeNull();
    expect(inAppBrowser(chromeIOS, page)).toBeNull();
    expect(inAppBrowser(android, page)).toBeNull();
    expect(inAppBrowser(kakao, page)).toEqual({ app: "KakaoTalk", open: `kakaotalk://web/openExternal?url=${encodeURIComponent(page)}` });
    const viaLine = inAppBrowser(line, page)!;
    expect(viaLine.app).toBe("LINE");
    expect(new URL(viaLine.open!).searchParams.get("openExternalBrowser")).toBe("1");
    expect(new URL(viaLine.open!).searchParams.get("street")).toBe("37.5,127.03,72");
    expect(inAppBrowser(naver, page)).toEqual({ app: "NAVER" });
    expect(inAppBrowser(instagram, page)).toEqual({ app: "Instagram" });
    expect(isIOS(kakao)).toBe(true);
    expect(isIOS(android)).toBe(false);
  });

  it("names the iPhone setting for the browser in hand when the camera is refused", () => {
    expect(cameraHelp(named("NotAllowedError"), safari)).toContain("Settings → Apps → Safari → Camera");
    expect(cameraHelp(named("NotAllowedError"), chromeIOS)).toContain("Settings → Apps → Chrome → Camera");
    expect(cameraHelp(named("NotAllowedError"), android)).toContain("site settings");
    expect(cameraHelp(named("NotReadableError"), safari)).toContain("busy");
    expect(cameraHelp(named("NotSupportedError"), kakao)).toContain("Open the page in Safari or Chrome");
    expect(cameraHelp(new Error("something else"), safari)).toBe("something else");
  });

  it("says where location is switched on, and when the fix is only a rough area", () => {
    expect(locationHelp(1, safari)).toContain("Location Services → Safari Websites → While Using the App, with Precise Location on");
    expect(locationHelp(1, chromeIOS)).toContain("Location Services → Chrome");
    expect(locationHelp(3, safari)).toContain("step out");
    expect(approximateHelp(3200, safari)).toContain("±3.2 km");
    expect(approximateHelp(3200, safari)).toContain("Precise Location on");
    expect(APPROXIMATE_FIX_M).toBeGreaterThan(120);
  });
});
