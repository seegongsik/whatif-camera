/**
 * A quest: two to four stops along the street ahead, chosen for a theme. The
 * model chooses places from the list by id and writes a title and one short
 * line per stop; it never sees the places' names and writes no digits, so
 * every name, distance and side on screen comes from the map. Without the
 * model the app picks the stops itself and says so.
 */
import type { ShopAhead } from "./ahead.js";
import type { ShopCategory } from "./osm.js";

export const QUEST_THEMES = {
  coffee: { label: "Coffee and a browse", hint: "a café first, then two or three shops worth a look" },
  lunch: { label: "Lunch break", hint: "somewhere to eat soon, then something sweet or a short browse" },
  evening: { label: "Evening out", hint: "dinner, then a bar or something fun; places open in the evening" },
  rainy: { label: "Rainy day", hint: "indoor places close together: cafés, bookshops, cinemas, covered markets" },
  kids: { label: "With kids", hint: "family-friendly places: ice cream, bakeries, toys, things to do; no bars" },
  surprise: { label: "Surprise me", hint: "an unexpected mix of three or four different kinds of places" },
} as const;

export type QuestTheme = keyof typeof QUEST_THEMES;

export function isQuestTheme(value: unknown): value is QuestTheme {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(QUEST_THEMES, value);
}

/** A place a quest may use. The model is told its kind, never its name or brand (those are for checking its text). */
export type QuestPlace = {
  id: string;
  name: string;
  brand?: string;
  category: ShopCategory;
  /** The OSM tag value, for example "cafe" or "shoes". */
  kind: string;
  side: "left" | "right";
  /** Metres ahead along the street, rounded to 10 m. */
  distanceM: number;
  openingHours?: string;
  cuisine?: string;
};

export type QuestStop = { id: string; line: string };

export type Quest = {
  source: "muse-spark-open" | "local";
  theme: QuestTheme;
  title: string;
  /** In walking order, nearest first. */
  stops: QuestStop[];
};

export const QUEST_MAX_AHEAD_M = 2500;
const PER_CATEGORY = 8;
const MAX_PLACES = 60;
const MAX_STOPS = 4;

/** Places a quest may use: the nearest few of each kind within 2.5 km, so one busy kind cannot fill the list. */
export function questPlaces(shops: ShopAhead[], maxAheadM = QUEST_MAX_AHEAD_M): QuestPlace[] {
  const perCategory = new Map<ShopCategory, number>();
  const out: QuestPlace[] = [];
  for (const shop of shops) {
    if (shop.s < 5 || shop.s > maxAheadM) continue;
    const n = perCategory.get(shop.category) ?? 0;
    if (n >= PER_CATEGORY) continue;
    perCategory.set(shop.category, n + 1);
    const place: QuestPlace = {
      id: shop.id,
      name: shop.name.slice(0, 80),
      category: shop.category,
      kind: shop.kind.split("=")[1] ?? shop.kind,
      side: shop.side,
      distanceM: Math.round(shop.s / 10) * 10,
    };
    if (shop.brand) place.brand = shop.brand.slice(0, 80);
    if (shop.openingHours) place.openingHours = shop.openingHours.slice(0, 120);
    if (shop.cuisine) place.cuisine = shop.cuisine.slice(0, 60);
    out.push(place);
    if (out.length >= MAX_PLACES) break;
  }
  return out;
}

const STOP_LINE: Record<ShopCategory, string> = {
  food: "Time to eat.",
  cafe: "Sit down with a coffee.",
  bar: "Stop in for a drink.",
  fashion: "Have a look at the clothes.",
  grocery: "Pick up a snack for the walk.",
  beauty: "A little treat for yourself.",
  health: "Handy to know it is here.",
  money: "Cash, if you need it.",
  fun: "Something fun to do.",
  stay: "A place to stay on this street.",
  shop: "Worth a browse.",
};

/** Words that name a kind of place rather than a business: a one-word name made of one of these is not banned. */
const GENERIC_WORDS = new Set(
  "cafe café coffee shop store bar pub restaurant kitchen bakery market mart bank pharmacy hotel inn salon books bookshop flowers noodles pizza sushi grill bistro deli tea boutique cinema".split(" "),
);

/**
 * What the model's text must not contain: each business name and brand,
 * and the first two words of longer ones ("Night Owl" of "Night Owl Mart").
 * Single common words inside longer names are allowed ("glow", "rise").
 */
export function bannedTerms(names: string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const words = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length === 0) continue;
    if (words.length === 1) {
      if (words[0].length >= 3 && !GENERIC_WORDS.has(words[0])) out.add(words[0]);
      continue;
    }
    out.add(words.join(" "));
    out.add(words.slice(0, 2).join(" "));
  }
  return [...out];
}

/** One line of model text, or the fallback when it carries a digit, a business name or nothing. */
export function cleanLine(text: unknown, banned: string[], fallback: string, maxChars = 110): string {
  if (typeof text !== "string") return fallback;
  const line = text.replace(/\s+/g, " ").replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (line.length === 0 || line.length > maxChars || /\d/.test(line)) return fallback;
  const words = line.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const joined = ` ${words.join(" ")} `;
  if (banned.some((term) => joined.includes(` ${term} `))) return fallback;
  return line;
}

/**
 * The model's answer, checked: stops must be listed places, each once, two to
 * four of them, put in walking order; text without digits or business names.
 */
export function parseQuest(raw: unknown, places: QuestPlace[], theme: QuestTheme): Quest {
  if (typeof raw !== "object" || raw === null) throw new Error("the quest is not an object");
  const r = raw as Record<string, unknown>;
  const byId = new Map(places.map((p) => [p.id, p]));
  const banned = bannedTerms(places.flatMap((p) => (p.brand ? [p.name, p.brand] : [p.name])));
  const seen = new Set<string>();
  const stops: (QuestStop & { distanceM: number })[] = [];
  for (const item of Array.isArray(r.stops) ? r.stops : []) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    const place = typeof s.id === "string" ? byId.get(s.id) : undefined;
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    stops.push({ id: place.id, line: cleanLine(s.line, banned, STOP_LINE[place.category]), distanceM: place.distanceM });
    if (stops.length >= MAX_STOPS) break;
  }
  if (stops.length < 2) throw new Error("the quest needs at least two listed places");
  stops.sort((a, b) => a.distanceM - b.distanceM);
  return {
    source: "muse-spark-open",
    theme,
    title: cleanLine(r.title, banned, QUEST_THEMES[theme].label, 60),
    stops: stops.map(({ id, line }) => ({ id, line })),
  };
}

const LOCAL_ORDER: Record<QuestTheme, ShopCategory[][]> = {
  coffee: [["cafe"], ["fashion", "shop", "beauty"], ["shop", "fashion"]],
  lunch: [["food"], ["cafe", "grocery"]],
  evening: [["food"], ["bar"], ["fun", "bar"]],
  rainy: [["cafe"], ["shop", "fashion"], ["fun", "food"]],
  kids: [["food", "cafe"], ["fun", "shop"], ["grocery", "cafe"]],
  surprise: [["fun", "shop"], ["cafe", "food"], ["fashion", "beauty", "shop"]],
};

/** The app's own pick: for each step of the theme, the nearest place of a fitting kind beyond the previous stop. */
export function localQuest(places: QuestPlace[], theme: QuestTheme): Quest | null {
  const stops: QuestStop[] = [];
  let after = -1;
  for (const kinds of LOCAL_ORDER[theme]) {
    const pick = places
      .filter((p) => kinds.includes(p.category) && p.distanceM > after && !stops.some((s) => s.id === p.id))
      .sort((a, b) => a.distanceM - b.distanceM)[0];
    if (!pick) continue;
    stops.push({ id: pick.id, line: STOP_LINE[pick.category] });
    after = pick.distanceM;
  }
  return stops.length >= 2 ? { source: "local", theme, title: QUEST_THEMES[theme].label, stops } : null;
}
