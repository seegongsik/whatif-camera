/**
 * A quest: two to four stops along the street ahead, chosen for a theme. The
 * model chooses places from the list by id and writes a title and one short
 * line per stop. It reads the places' names, so it can choose the ones it
 * knows, but its text is checked before the page sees it: no digits, no
 * listed name, no other name it brings (a capital inside a sentence), English
 * only; a line that fails gives way to a plain one. Every name, distance and
 * side on screen comes from the map. Without the model the app picks the
 * stops itself and says so.
 */
import type { ShopAhead } from "./ahead.js";
import type { ShopCategory } from "./osm.js";

export const QUEST_THEMES = {
  coffee: { label: "Coffee and a browse", hint: "a café first, then two or three shops worth a look" },
  lunch: { label: "Lunch break", hint: "somewhere to eat soon, then something sweet or a short browse" },
  evening: { label: "Evening out", hint: "dinner, then a bar or something fun; places open in the evening" },
  rainy: { label: "Rainy day", hint: "indoor places close together: museums and galleries, cafés, bookshops, cinemas, covered markets" },
  kids: { label: "With kids", hint: "family-friendly places: ice cream, bakeries, toys, things to do; no bars" },
  surprise: { label: "Surprise me", hint: "an unexpected mix of three or four different kinds of places" },
} as const;

export type QuestTheme = keyof typeof QUEST_THEMES;

export function isQuestTheme(value: unknown): value is QuestTheme {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(QUEST_THEMES, value);
}

/** A place a quest may use. The model reads its name, kind, side and distance; its text is checked against the name and the brand. */
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
  /** Muse Spark named it one of this street's landmarks. */
  known?: boolean;
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
const MAX_KNOWN = 16;
const MAX_STOPS = 4;

/**
 * Places a quest may use, in walking order: those Muse Spark already knows by
 * name anywhere along the street (up to 16: a rainy day on Fifth Avenue
 * wants the museums 3 km up), then the nearest few of each kind within
 * 2.5 km, so one busy kind cannot fill the list.
 */
export function questPlaces(shops: ShopAhead[], maxAheadM = QUEST_MAX_AHEAD_M, known: ReadonlySet<string> = new Set()): QuestPlace[] {
  const ahead = shops.filter((shop) => shop.s >= 5);
  const chosen = new Set(ahead.filter((shop) => known.has(shop.id)).slice(0, MAX_KNOWN));
  const perCategory = new Map<ShopCategory, number>();
  for (const shop of ahead) {
    if (chosen.size >= MAX_PLACES || shop.s > maxAheadM) break;
    if (chosen.has(shop)) continue;
    const n = perCategory.get(shop.category) ?? 0;
    if (n >= PER_CATEGORY) continue;
    perCategory.set(shop.category, n + 1);
    chosen.add(shop);
  }
  return ahead.filter((shop) => chosen.has(shop)).map((shop) => questPlace(shop, known.has(shop.id)));
}

function questPlace(shop: ShopAhead, known: boolean): QuestPlace {
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
  if (known) place.known = true;
  return place;
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

/** Words too common to tell one business from another; a name's other words are its own ("tiffany" of "Tiffany & Co."). */
const COMMON_WORDS = new Set([
  ...GENERIC_WORDS,
  ..."the and for with from new old little big great grand royal city town house home place street avenue road square center centre museum gallery art arts park garden hall company world first best good fresh golden green blue red white black day night morning evening time walk rain sun sweet treat family kids fun food drink wine beer style fashion beauty spa studio club lounge table one two three four five six seven eight nine ten".split(
    " ",
  ),
]);

/** Words written with a capital that are not names: "I", and kinds of food by where they come from. */
const CAPITALISED_WORDS = new Set(
  "i italian french japanese korean chinese thai mexican spanish greek indian american british english vietnamese turkish lebanese mediterranean asian european german portuguese brazilian peruvian belgian swiss irish cuban caribbean african ethiopian moroccan persian hawaiian cajun middle eastern western".split(
    " ",
  ),
);

/** A letter from another script than the Latin: the text is to be English. */
const NOT_LATIN = /(?!\p{Script=Latin})\p{L}/u;

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * What the model's text must not contain: each business name and brand,
 * and the first two words of longer ones ("Night Owl" of "Night Owl Mart").
 * Single common words inside longer names are allowed ("glow", "rise").
 */
export function bannedTerms(names: string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const words = wordsOf(name);
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

/** The words that tell the listed businesses apart: three letters or more, neither common nor a kind of food. */
export function nameWords(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const name of names) for (const word of wordsOf(name)) if (word.length >= 3 && !COMMON_WORDS.has(word) && !CAPITALISED_WORDS.has(word)) out.add(word);
  return out;
}

/** What the model's text is checked against: the listed names and brands. */
export type NameCheck = { banned: string[]; words: ReadonlySet<string> };

export function nameCheck(names: string[]): NameCheck {
  return { banned: bannedTerms(names), words: nameWords(names) };
}

/**
 * Whether a line names something: a word with a capital inside a sentence
 * (a name the model brought, "Breakfast at Tiffany's"), or a sentence that
 * opens with a word of a listed name ("Tiffany's windows glitter").
 */
function namesSomething(line: string, words: ReadonlySet<string>): boolean {
  for (const sentence of line.split(/(?<=[.!?:;])\s+/)) {
    const tokens = sentence.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token));
    for (const [i, token] of tokens.entries()) {
      const parts = token.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      if (i === 0 ? parts.some((p) => words.has(p.toLowerCase())) : parts.some((p) => /\p{Lu}/u.test(p) && !CAPITALISED_WORDS.has(p.toLowerCase()))) return true;
    }
  }
  return false;
}

/**
 * One line of model text, or the fallback when it carries a digit, a name,
 * another script or nothing. A title may be in title case, so none of its
 * words may be a word of a listed name; a line has capitals only where a
 * sentence starts.
 */
export function cleanLine(text: unknown, check: NameCheck, fallback: string, maxChars = 110, title = false): string {
  if (typeof text !== "string") return fallback;
  const line = text.replace(/\s+/g, " ").replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (line.length === 0 || line.length > maxChars || /\d/.test(line) || NOT_LATIN.test(line)) return fallback;
  const words = wordsOf(line);
  const joined = ` ${words.join(" ")} `;
  if (check.banned.some((term) => joined.includes(` ${term} `))) return fallback;
  if (title ? words.some((w) => check.words.has(w)) : namesSomething(line, check.words)) return fallback;
  return line;
}

/**
 * The model's answer, checked: stops must be listed places, each once, two to
 * four of them, put in walking order; text without digits or names.
 */
export function parseQuest(raw: unknown, places: QuestPlace[], theme: QuestTheme): Quest {
  if (typeof raw !== "object" || raw === null) throw new Error("the quest is not an object");
  const r = raw as Record<string, unknown>;
  const byId = new Map(places.map((p) => [p.id, p]));
  const check = nameCheck(places.flatMap((p) => (p.brand ? [p.name, p.brand] : [p.name])));
  const seen = new Set<string>();
  const stops: (QuestStop & { distanceM: number })[] = [];
  for (const item of Array.isArray(r.stops) ? r.stops : []) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    const place = typeof s.id === "string" ? byId.get(s.id) : undefined;
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    stops.push({ id: place.id, line: cleanLine(s.line, check, STOP_LINE[place.category]), distanceM: place.distanceM });
    if (stops.length >= MAX_STOPS) break;
  }
  if (stops.length < 2) throw new Error("the quest needs at least two listed places");
  stops.sort((a, b) => a.distanceM - b.distanceM);
  return {
    source: "muse-spark-open",
    theme,
    title: cleanLine(r.title, check, QUEST_THEMES[theme].label, 60, true),
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
