/**
 * Which of the mapped places Muse Spark can read in the photo: a check that
 * the app found the right street and direction. The model answers with ids
 * from the list and a coarse place in the picture (left, middle or right
 * third); every word on screen is the app's.
 */
import type { ShopAhead } from "./ahead.js";

export type SpotPlace = { id: string; name: string; side: "left" | "right"; distanceM: number };

export type Spotted = {
  /** `box`: the number of the SAM box the name was read in, when the photo had numbered boxes on it. */
  seen: { id: string; where: "left" | "middle" | "right"; box?: number }[];
  /** Whether the photo looks along a street, across it at the building fronts, or neither. */
  view: "along" | "across" | "unclear";
};

/** At most this many of SAM 3.1's signs are numbered on the photo the model reads. */
export const MAX_SIGN_BOXES = 12;

const WHERE = ["left", "middle", "right"] as const;
const VIEW = ["along", "across", "unclear"] as const;

/** The nearest places ahead, the ones a photo along the street can show. */
export function spotPlaces(shops: ShopAhead[], maxAheadM = 300, max = 30): SpotPlace[] {
  return shops
    .filter((s) => s.s >= 3 && s.s <= maxAheadM)
    .slice(0, max)
    .map((s) => ({ id: s.id, name: s.name.slice(0, 80), side: s.side, distanceM: Math.round(s.s / 10) * 10 }));
}

/**
 * The model's answer, checked: listed ids only, each once, and only the words
 * the app knows. A box number counts only when `boxes` were drawn and it is
 * one of them.
 */
export function parseSpotted(raw: unknown, places: SpotPlace[], boxes = 0): Spotted {
  if (typeof raw !== "object" || raw === null) throw new Error("the answer is not an object");
  const r = raw as Record<string, unknown>;
  const ids = new Set(places.map((p) => p.id));
  const seen: Spotted["seen"] = [];
  for (const item of Array.isArray(r.seen) ? r.seen : []) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    if (typeof s.id !== "string" || !ids.has(s.id) || seen.some((x) => x.id === s.id)) continue;
    const where = WHERE.find((w) => w === s.where) ?? "middle";
    const box = s.box;
    seen.push(typeof box === "number" && Number.isInteger(box) && box >= 1 && box <= boxes ? { id: s.id, where, box } : { id: s.id, where });
    if (seen.length >= 12) break;
  }
  const view = VIEW.find((v) => v === r.view) ?? "unclear";
  return { seen, view };
}
