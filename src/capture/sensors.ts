/**
 * Live phone sensors: orientation (gravity and compass) and GPS.
 * iOS asks for motion permission from a tap and reports the compass
 * separately (webkitCompassHeading); Android reports an absolute alpha.
 */
import { alphaForCompassHeading, orientationFromEuler, type Orientation } from "../camera/pose.js";

type OrientationReading = {
  alpha: number;
  beta: number;
  gamma: number;
  absolute: boolean;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

export type PositionReading = { lat: number; lon: number; accuracyM: number; at: number };

export type CameraOrientation = Orientation & {
  /** Compass uncertainty in degrees when known. */
  headingAccuracyDeg?: number;
  /** False when the browser gives no compass (alpha is relative). */
  hasCompass: boolean;
  raw: OrientationReading;
};

type IOSOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type PermissionRequester = { requestPermission?: () => Promise<"granted" | "denied"> };

export class Sensors {
  private orientation: OrientationReading | null = null;
  private position: PositionReading | null = null;
  private watchId: number | null = null;
  private readonly listeners: (() => void)[] = [];
  positionError: string | null = null;
  /** GeolocationPositionError's code: 1 refused, 2 unavailable, 3 timed out. */
  positionErrorCode: number | null = null;
  /** Motion access was refused: no compass, so the person picks the direction after the photo. */
  motionDenied = false;
  onChange: (() => void) | null = null;

  /** Call from a tap: iOS only grants motion access inside a user gesture. */
  async start(): Promise<void> {
    const requester = (window.DeviceOrientationEvent as unknown as PermissionRequester | undefined)?.requestPermission;
    if (typeof requester === "function") {
      const state = await requester.call(window.DeviceOrientationEvent).catch(() => "denied");
      this.motionDenied = state !== "granted";
    }
    const handle = (absoluteEvent: boolean) => (event: Event) => {
      const e = event as IOSOrientationEvent;
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      // Once an absolute stream is seen, ignore the relative one.
      if (!absoluteEvent && this.orientation?.absolute && e.webkitCompassHeading === undefined) return;
      this.orientation = {
        alpha: e.alpha,
        beta: e.beta,
        gamma: e.gamma,
        absolute: absoluteEvent || e.absolute === true,
        webkitCompassHeading: e.webkitCompassHeading,
        webkitCompassAccuracy: e.webkitCompassAccuracy,
      };
      this.onChange?.();
    };
    const add = (name: string, fn: (e: Event) => void) => {
      window.addEventListener(name, fn);
      this.listeners.push(() => window.removeEventListener(name, fn));
    };
    if ("ondeviceorientationabsolute" in window) add("deviceorientationabsolute", handle(true));
    add("deviceorientation", handle(false));

    if (!("geolocation" in navigator)) {
      this.positionError = "This browser has no location service.";
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        this.position = { lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy, at: p.timestamp };
        this.positionError = null;
        this.positionErrorCode = null;
        this.onChange?.();
      },
      (err) => {
        this.positionError = err.message || "Location is not available.";
        this.positionErrorCode = err.code;
        this.onChange?.();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
  }

  stop(): void {
    this.listeners.splice(0).forEach((off) => off());
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  latestPosition(): PositionReading | null {
    return this.position;
  }

  /** Camera orientation for a phone held upright in portrait. */
  cameraOrientation(): CameraOrientation | null {
    const r = this.orientation;
    if (!r) return null;
    if (r.webkitCompassHeading !== undefined && r.webkitCompassHeading !== null && r.webkitCompassHeading >= 0) {
      const alpha = alphaForCompassHeading(r.beta, r.gamma, r.webkitCompassHeading);
      return {
        ...orientationFromEuler(alpha, r.beta, r.gamma),
        headingAccuracyDeg: r.webkitCompassAccuracy !== undefined && r.webkitCompassAccuracy >= 0 ? r.webkitCompassAccuracy : undefined,
        hasCompass: true,
        raw: r,
      };
    }
    return { ...orientationFromEuler(r.alpha, r.beta, r.gamma), hasCompass: r.absolute, raw: r };
  }
}

export function screenAngle(): number {
  return typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : 0;
}
