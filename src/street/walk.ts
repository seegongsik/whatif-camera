/**
 * Walking the street once the show has run: each GPS fix put on the street
 * (how far along it, which side), smoothed so a fix that jumps between tall
 * buildings does not throw the dot about; what comes next; and, for a screen
 * far from the street, a SIMULATED walk down it through the same steps.
 * Fixes stay on the phone: nothing here is sent anywhere.
 */
import { toLatLon, toLocal, type LocalFrame } from "../geo/enu.js";
import type { ShopAhead } from "./ahead.js";
import { nearestOnRoute, pointAt, type Route } from "./route.js";
import { WALK_MPS } from "./signs.js";

export type WalkFix = { lat: number; lon: number; accuracyM: number; at: number };

export type WalkSpot = {
  /** Metres along the street from where the photo was taken. */
  s: number;
  /** Metres to the right (positive) or left of the street's line. */
  offset: number;
  accuracyM: number;
  /** Beside the street, between its start and its end. */
  onStreet: boolean;
  /** How far the fix is from the street's line, metres. */
  awayM: number;
  at: number;
};

/** A fix rougher than this says too little about where on the street you are: it is left out. */
export const ROUGH_FIX_M = 100;
/** Farther than this from the street's line (plus the fix's own uncertainty, up to 40 m), you have left it. */
export const OFF_STREET_M = 50;
/** The SIMULATED walk goes this many times faster than a person, so a screen sees a stretch in a minute. */
export const SIMULATED_SPEEDUP = 20;

/**
 * The walker's spot after one more fix. A sharp fix moves the dot most of
 * the way to it, a rough one only a little, so the dot neither jumps nor
 * lags far behind a person walking.
 */
export function walkStep(prev: WalkSpot | null, route: Route, frame: LocalFrame, fix: WalkFix): WalkSpot | null {
  if (!(fix.accuracyM > 0) || fix.accuracyM > ROUGH_FIX_M) return prev;
  const p = toLocal(frame, fix);
  const near = nearestOnRoute(route, p);
  if (!near) return prev;
  const awayM = Math.hypot(p.x - near.at.x, p.y - near.at.y);
  const onStreet = !near.outside && awayM <= OFF_STREET_M + Math.min(40, fix.accuracyM);
  const weight = prev ? Math.min(1, Math.max(0.2, 12 / fix.accuracyM)) : 1;
  return {
    s: prev ? prev.s + weight * (near.s - prev.s) : near.s,
    offset: prev ? prev.offset + weight * (near.offset - prev.offset) : near.offset,
    accuracyM: fix.accuracyM,
    onStreet,
    awayM,
    at: fix.at,
  };
}

/** The first place ahead of s (at least 5 m on: the one beside you is passed). Places come in order along the street. */
export function nextPlace(shops: readonly ShopAhead[], s: number): ShopAhead | null {
  let lo = 0;
  let hi = shops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (shops[mid].s > s + 5) hi = mid;
    else lo = mid + 1;
  }
  return shops[lo] ?? null;
}

/** The places whose spot the walker went past between two fixes, in the order passed. */
export function passed(shops: readonly ShopAhead[], from: number, to: number): ShopAhead[] {
  if (to <= from) return [];
  return shops.filter((x) => x.s > from && x.s <= to).sort((a, b) => a.s - b.s);
}

/**
 * A fix on the SIMULATED walk: down the street from its start at a brisk
 * pace, a few metres off its line and wandering a little, as a phone's fix
 * would. Only ever shown labelled SIMULATED.
 */
export function simulatedFix(route: Route, frame: LocalFrame, elapsedMs: number, speedMps = WALK_MPS * SIMULATED_SPEEDUP): WalkFix {
  const s = Math.min(route.length, Math.max(0, route.along[0]) + (elapsedMs / 1000) * speedMps);
  const { at, headingDeg } = pointAt(route, s);
  const h = (headingDeg * Math.PI) / 180;
  // Right of the direction of travel, and a wobble along it.
  const side = 6 + 3 * Math.sin(elapsedMs / 1700);
  const wobble = 2 * Math.sin(elapsedMs / 900);
  const p = { x: at.x + Math.cos(h) * side + Math.sin(h) * wobble, y: at.y - Math.sin(h) * side + Math.cos(h) * wobble };
  return { ...toLatLon(frame, p), accuracyM: 6, at: elapsedMs };
}
