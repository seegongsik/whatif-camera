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
  headingSource: "compass" | "synthetic" | "manual";
  pitchDeg: number;
  rollDeg: number;
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
