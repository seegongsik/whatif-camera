/**
 * Which places the show names: Muse Spark Open picks them from a list of
 * the street's places, by what it knows of them (famous sights, historic
 * places, flagship stores, venues and restaurants known by name), and says
 * why with one word from a fixed menu. It answers with list numbers only:
 * every name, distance and side on screen comes from the map. Where the
 * model knows nothing (or does not answer in time), the map's own ranking
 * (fameScore in show-plan.ts) decides, as before.
 */
import type { ShopAhead } from "./ahead.js";
import { brandCounts, fameScore, groupOf, GROUPS, kindWord, landmarkCount, MIN_GAP_M, streetCores, type GroupKey } from "./show-plan.js";

/** A place as the model sees it: the map's name and kind, which chip it is under, and where it is. */
export type PickPlace = { id: string; name: string; kind: string; group: GroupKey; side: "left" | "right"; distanceM: number };

/** Why a place was picked, as the model may say it: a word from this menu, never its own text. */
export const PICK_REASONS = {
  iconic: "Iconic",
  historic: "Historic",
  flagship: "Flagship",
  culture: "Culture",
  well_known: "Well known",
} as const;

export type PickReason = keyof typeof PICK_REASONS;

/** The model's picks, as ids from the list. */
export type Picks = {
  /** Most recognisable first. */
  landmarks: { id: string; why: PickReason }[];
  /** For each chip, the places of that kind best known by name, most recognisable first. */
  best: Partial<Record<GroupKey, string[]>>;
};

/** At most this many places go to the model: a street can hold 800. */
export const PICK_MAX_PLACES = 200;
/**
 * For a demo street, asked once and then kept by the CDN, the model reads
 * twice as many: the time matters less there than finding the one famous
 * bar among hundreds (the share of a busy street it read before a street
 * could hold 800 places).
 */
export const PICK_DEMO_MAX_PLACES = 400;
/** Fewer places than this and there is nothing to pick from (a quiet country road): the map's ranking is enough. */
export const PICK_MIN_PLACES = 8;
/** How many landmarks the model may name, before they are spaced along the street. */
export const PICK_MAX_LANDMARKS = 12;
/** How many places per chip the model may name. */
export const PICK_MAX_BEST = 6;

const GROUP_KEYS = new Set<string>(GROUPS.map((g) => g.key));

/** Every place the model named, as a landmark or among the best known of a chip. */
export function knownIds(picks: Picks): Set<string> {
  return new Set([...picks.landmarks.map((l) => l.id), ...Object.values(picks.best).flatMap((ids) => ids ?? [])]);
}

/** A position to two decimals (about a kilometre): enough for the model to tell the city, and all a question to it carries. */
export function roughPosition(p: { lat: number; lon: number }): { lat: number; lon: number } {
  return { lat: Math.round(p.lat * 100) / 100, lon: Math.round(p.lon * 100) / 100 };
}

export function isGroupKey(value: unknown): value is GroupKey {
  return typeof value === "string" && GROUP_KEYS.has(value);
}

export function isPickReason(value: unknown): value is PickReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PICK_REASONS, value);
}

/**
 * The places the model picks from: the street's best by the map's own
 * ranking, and the best few of each chip's kind, so a famous restaurant is
 * on the list even where museums lead the ranking. All of them on a short
 * street. In order along the street.
 */
export function pickCandidates(shops: readonly ShopAhead[], lengthM: number, streetName?: string, max = PICK_MAX_PLACES): PickPlace[] {
  const along = shops.filter((s) => s.s >= -10 && s.s <= lengthM);
  let chosen: ShopAhead[];
  if (along.length <= max) chosen = [...along];
  else {
    const brands = brandCounts(along);
    const cores = streetCores(streetName);
    const ranked = along.map((shop) => ({ shop, score: fameScore(shop, brands, cores) })).sort((a, b) => b.score - a.score || a.shop.s - b.shop.s);
    const ids = new Set<string>();
    const take = (shop: ShopAhead) => {
      if (ids.size < max) ids.add(shop.id);
    };
    for (const { shop } of ranked.slice(0, Math.round(max * 0.4))) take(shop);
    const perGroup = Math.max(4, Math.floor((max * 0.6) / GROUPS.length));
    for (const group of GROUPS) {
      let n = 0;
      for (const { shop } of ranked) {
        if (n >= perGroup) break;
        if (!group.categories.includes(shop.category)) continue;
        if (!ids.has(shop.id)) take(shop);
        n += 1;
      }
    }
    for (const { shop } of ranked) take(shop);
    chosen = along.filter((shop) => ids.has(shop.id));
  }
  return chosen
    .sort((a, b) => a.s - b.s)
    .map((shop) => ({
      id: shop.id,
      name: shop.name.slice(0, 80),
      kind: kindWord(shop.kind).slice(0, 40),
      group: groupOf(shop.category).key,
      side: shop.side,
      distanceM: Math.max(0, Math.round(shop.s / 10) * 10),
    }));
}

/**
 * The model's answer, checked: list numbers in range, each place once, a
 * chip's places of that chip's kind only, reasons from the menu (anything
 * else is "well known"). `n` counts from 1, as the list the model saw.
 */
export function parsePicks(raw: unknown, places: readonly PickPlace[]): Picks {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("the answer is not an object");
  const r = raw as Record<string, unknown>;
  const at = (value: unknown): PickPlace | null => {
    const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
    return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= places.length ? places[n - 1] : null;
  };
  const landmarks: Picks["landmarks"] = [];
  for (const item of Array.isArray(r.landmarks) ? r.landmarks : []) {
    const entry: Record<string, unknown> = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : { n: item };
    const place = at(entry.n);
    if (!place || landmarks.some((l) => l.id === place.id)) continue;
    landmarks.push({ id: place.id, why: isPickReason(entry.why) ? entry.why : "well_known" });
    if (landmarks.length >= PICK_MAX_LANDMARKS) break;
  }
  const best: Picks["best"] = {};
  const given = typeof r.best === "object" && r.best !== null && !Array.isArray(r.best) ? (r.best as Record<string, unknown>) : {};
  for (const [key, list] of Object.entries(given)) {
    if (!isGroupKey(key) || !Array.isArray(list)) continue;
    const ids: string[] = [];
    for (const value of list) {
      const place = at(value);
      if (!place || place.group !== key || ids.includes(place.id)) continue;
      ids.push(place.id);
      if (ids.length >= PICK_MAX_BEST) break;
    }
    if (ids.length > 0) best[key] = ids;
  }
  return { landmarks, best };
}

/**
 * The model's places first, in its order, each at least `gap` from those
 * already kept (the light stops at each one), up to `max`; then the map's
 * own picks while there are fewer than `atLeast`. In order along the street.
 */
export function mergePicks(model: readonly ShopAhead[], rules: readonly ShopAhead[], max: number, atLeast: number, gap = MIN_GAP_M): ShopAhead[] {
  const kept: ShopAhead[] = [];
  const room = (shop: ShopAhead) => !kept.includes(shop) && kept.every((k) => Math.abs(k.s - shop.s) >= gap);
  for (const shop of model) {
    if (kept.length >= max) break;
    if (room(shop)) kept.push(shop);
  }
  for (const shop of rules) {
    if (kept.length >= Math.min(max, atLeast)) break;
    if (room(shop)) kept.push(shop);
  }
  return kept.sort((a, b) => a.s - b.s);
}

/** The street's landmarks from the model's picks, topped up from the map's ranking to the usual three. */
export function landmarksFrom(picks: Picks, shops: readonly ShopAhead[], rules: readonly ShopAhead[], lengthM: number): ShopAhead[] {
  const byId = new Map(shops.map((s) => [s.id, s]));
  const model = picks.landmarks.map((l) => byId.get(l.id)).filter((s): s is ShopAhead => s !== undefined && s.s >= -10 && s.s <= lengthM);
  return mergePicks(model, rules, landmarkCount(lengthM), 3);
}
