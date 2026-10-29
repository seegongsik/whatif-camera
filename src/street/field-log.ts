/**
 * The shots taken in the field, kept in this browser only: where the phone
 * stood, where it faced, what the sensors said and what came of it, each with
 * a link that replays the same street without the photo. Its owner copies it
 * from the home page to look into a street that came out wrong; nothing here
 * is sent anywhere.
 */
import type { CaptureMeta } from "../capture/types.js";
import type { StreetAhead } from "./street.js";

export type FieldShot = {
  at: string;
  lat: number;
  lon: number;
  accuracyM: number;
  headingDeg: number;
  headingSource: CaptureMeta["headingSource"];
  headingAccuracyDeg?: number;
  pitchDeg: number;
  raw?: CaptureMeta["raw"];
  /** From the shot to the street's answer. */
  seconds: number;
  /** The street found, or why none was. */
  street?: { name?: string; highway: string; places: number; lengthM: number; distanceM: number; headingDeg: number };
  error?: string;
};

const KEY = "whats-ahead-field-log";
export const MAX_FIELD_SHOTS = 40;

export function fieldShot(capture: CaptureMeta, seconds: number, outcome: StreetAhead | string): FieldShot {
  const shot: FieldShot = {
    at: capture.takenAt,
    lat: capture.lat,
    lon: capture.lon,
    accuracyM: capture.accuracyM,
    headingDeg: capture.headingDeg,
    headingSource: capture.headingSource,
    headingAccuracyDeg: capture.headingAccuracyDeg,
    pitchDeg: capture.pitchDeg,
    raw: capture.raw,
    seconds,
  };
  if (typeof outcome === "string") shot.error = outcome;
  else {
    shot.street = {
      name: outcome.name,
      highway: outcome.highway,
      places: outcome.shops.length,
      lengthM: outcome.route.length,
      distanceM: outcome.streetDistanceM,
      headingDeg: outcome.streetHeadingDeg,
    };
  }
  return shot;
}

export function readFieldLog(): FieldShot[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? (list as FieldShot[]) : [];
  } catch {
    return [];
  }
}

/** Keeps the latest shots; without storage (a private window) there is simply no log. */
export function addFieldShot(shot: FieldShot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...readFieldLog(), shot].slice(-MAX_FIELD_SHOTS)));
  } catch {
    // No storage: no log.
  }
}

export function clearFieldLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // No storage: nothing to clear.
  }
}

const one = (n: number | undefined, digits = 1) => (n === undefined || n === null || !Number.isFinite(n) ? "–" : n.toFixed(digits));

/** One line per shot, oldest first, each ending with a link that replays it from the map alone. */
export function fieldLogText(shots: readonly FieldShot[], base: string): string {
  return shots
    .map((s) => {
      const where = `${s.lat.toFixed(6)},${s.lon.toFixed(6)}`;
      const facing = `facing ${Math.round(s.headingDeg)}° (${s.headingSource}${s.headingAccuracyDeg !== undefined ? ` ±${Math.round(s.headingAccuracyDeg)}°` : ""})`;
      const raw = s.raw
        ? ` · α${one(s.raw.alpha)} β${one(s.raw.beta)} γ${one(s.raw.gamma)}${s.raw.absolute ? " abs" : ""}${s.raw.webkitCompassHeading !== undefined ? ` ios${one(s.raw.webkitCompassHeading)}` : ""}`
        : "";
      const result = s.street
        ? `${s.street.name ?? "unnamed"} (${s.street.highway}), ${Math.round(s.street.distanceM)} m off, runs ${Math.round(s.street.headingDeg)}° · ${s.street.places} places · ${(s.street.lengthM / 1000).toFixed(1)} km`
        : `failed: ${s.error ?? "unknown"}`;
      const replay = `${base}?street=${where},${Math.round(s.headingDeg)}`;
      return `${s.at.slice(0, 16)}Z · ${where} ±${Math.round(s.accuracyM)} m · ${facing} · tilt ${Math.round(s.pitchDeg)}°${raw} → ${result} · ${s.seconds.toFixed(1)} s · ${replay}`;
    })
    .join("\n");
}
