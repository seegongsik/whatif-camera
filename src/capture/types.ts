/** What the phone knew at the moment of capture. */
export type CaptureMeta = {
  lat: number;
  lon: number;
  /** GPS accuracy as the browser reports it: radius in metres at 95% confidence. */
  accuracyM: number;
  /** Camera heading (optical axis), compass degrees. Magnetic when it comes from the phone. */
  headingDeg: number;
  /** iOS webkitCompassAccuracy, when available. */
  headingAccuracyDeg?: number;
  headingSource: "compass" | "preset" | "synthetic" | "manual";
  pitchDeg: number;
  rollDeg: number;
  /** Where pitch and roll come from. "photo verticals" means they are worked out from the marks. */
  tiltSource?: "gravity sensor" | "photo verticals" | "preset" | "synthetic";
  /** Field of view across the long side of the picture. */
  fovLongDeg: number;
  /**
   * Where the optical axis meets the picture, in pixels, when the picture is a
   * crop (a screenshot of a photo); the centre otherwise.
   */
  principalPoint?: { u: number; v: number };
  fovSource: "assumption" | "EXIF" | "preset" | "synthetic";
  takenAt: string;
  /** Raw sensor values, kept for checking the orientation on real phones. */
  raw?: {
    alpha?: number;
    beta?: number;
    gamma?: number;
    absolute?: boolean;
    webkitCompassHeading?: number;
    screenAngle?: number;
  };
};

/** Typical 26 mm equivalent main phone camera across the long side of a 4:3 frame. Assumption. */
export const ASSUMED_FOV_LONG_DEG = 67;
/** Compass uncertainty when the phone does not report one (1 sigma). Assumption. */
export const ASSUMED_HEADING_SIGMA_DEG = 20;

/** The browser's accuracy is a 95% radius; a 2-D Gaussian reaches it at 2.45 sigma. */
export function gpsSigmaM(accuracyM: number): number {
  return Math.max(3, accuracyM / 2.45);
}

export function headingSigmaDeg(capture: CaptureMeta): number {
  const reported = capture.headingAccuracyDeg;
  if (reported !== undefined && reported > 0) return Math.max(3, reported);
  return ASSUMED_HEADING_SIGMA_DEG;
}
