/**
 * Streets and shops from OpenStreetMap, as the Overpass API returns them
 * (`out body geom` for ways, `out center tags` for shops). Only what the
 * street view needs is kept: the street's name and shape, and for each shop
 * its name, kind, brand and the links the map has for it.
 */
import type { LatLon } from "../geo/enu.js";

export type ShopCategory =
  | "food"
  | "cafe"
  | "bar"
  | "fashion"
  | "grocery"
  | "beauty"
  | "health"
  | "money"
  | "fun"
  | "stay"
  | "shop";

export const SHOP_CATEGORIES: readonly ShopCategory[] = ["food", "cafe", "bar", "fashion", "grocery", "beauty", "health", "money", "fun", "stay", "shop"];

export type StreetWay = {
  id: string;
  name?: string;
  ref?: string;
  /** OSM highway=* (or the tile's road class). */
  highway: string;
  /** OSM node ids, when known: they tell which ways meet. */
  nodes?: number[];
  points: LatLon[];
};

export type Shop = {
  id: string;
  name: string;
  brand?: string;
  category: ShopCategory;
  /** The OSM tag that made it a shop, for example "amenity=cafe" or "shop=shoes". */
  kind: string;
  point: LatLon;
  openingHours?: string;
  cuisine?: string;
  website?: string;
  instagram?: string;
  facebook?: string;
  /** How sure the source is that the place exists (0 to 1), when it says. */
  confidence?: number;
};

/** Roads a person can stand beside; sidewalks mapped as their own ways are left out (they have no name). */
export const STREET_HIGHWAYS = [
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "pedestrian",
  "service",
] as const;

const AMENITY: Record<string, ShopCategory> = {
  restaurant: "food",
  fast_food: "food",
  food_court: "food",
  ice_cream: "cafe",
  cafe: "cafe",
  bar: "bar",
  pub: "bar",
  biergarten: "bar",
  nightclub: "bar",
  pharmacy: "health",
  clinic: "health",
  dentist: "health",
  doctors: "health",
  bank: "money",
  bureau_de_change: "money",
  cinema: "fun",
  theatre: "fun",
  arts_centre: "fun",
  karaoke_box: "fun",
};

const SHOP: Record<string, ShopCategory> = {
  coffee: "cafe",
  tea: "cafe",
  bakery: "food",
  pastry: "food",
  confectionery: "food",
  clothes: "fashion",
  shoes: "fashion",
  fashion: "fashion",
  boutique: "fashion",
  bag: "fashion",
  jewelry: "fashion",
  watches: "fashion",
  sports: "fashion",
  fashion_accessories: "fashion",
  supermarket: "grocery",
  convenience: "grocery",
  greengrocer: "grocery",
  butcher: "grocery",
  deli: "grocery",
  alcohol: "grocery",
  beverages: "grocery",
  cosmetics: "beauty",
  beauty: "beauty",
  hairdresser: "beauty",
  perfumery: "beauty",
  chemist: "health",
  optician: "health",
};

const TOURISM: Record<string, ShopCategory> = {
  hotel: "stay",
  hostel: "stay",
  guest_house: "stay",
  museum: "fun",
  gallery: "fun",
  attraction: "fun",
};

const LEISURE: Record<string, ShopCategory> = {
  amusement_arcade: "fun",
  bowling_alley: "fun",
  escape_game: "fun",
};

/** Amenity values worth showing on the street; parking, benches and toilets are not shops. */
export const SHOP_AMENITIES = Object.keys(AMENITY);
export const SHOP_TOURISM = Object.keys(TOURISM);
export const SHOP_LEISURE = Object.keys(LEISURE);

type Tags = Record<string, string>;

function str(tags: Tags, key: string): string | undefined {
  const v = tags[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, 120) : undefined;
}

/** What kind of place the tags describe, or null when it is not one the street view shows. */
export function categorize(tags: Tags): { category: ShopCategory; kind: string } | null {
  const amenity = tags.amenity;
  if (amenity && AMENITY[amenity]) return { category: AMENITY[amenity], kind: `amenity=${amenity}` };
  const shop = tags.shop;
  if (shop && shop !== "no" && shop !== "vacant") return { category: SHOP[shop] ?? "shop", kind: `shop=${shop}` };
  const tourism = tags.tourism;
  if (tourism && TOURISM[tourism]) return { category: TOURISM[tourism], kind: `tourism=${tourism}` };
  const leisure = tags.leisure;
  if (leisure && LEISURE[leisure]) return { category: LEISURE[leisure], kind: `leisure=${leisure}` };
  return null;
}

/** A social handle or link as an https URL on that site, or undefined when it is neither. */
export function socialUrl(value: string | undefined, site: "instagram.com" | "facebook.com"): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const url = /^https?:\/\//i.test(v) ? v : null;
  if (url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\.|^m\./, "");
      return host === site ? `https://${site}${u.pathname}` : undefined;
    } catch {
      return undefined;
    }
  }
  const handle = v.replace(/^@/, "");
  return /^[A-Za-z0-9._-]{1,60}$/.test(handle) ? `https://${site}/${handle}` : undefined;
}

export function shopFromTags(id: string, point: LatLon, tags: Tags): Shop | null {
  const kind = categorize(tags);
  const name = str(tags, "name") ?? str(tags, "brand");
  if (!kind || !name) return null;
  const website = str(tags, "website") ?? str(tags, "contact:website");
  return {
    id,
    name,
    brand: str(tags, "brand"),
    category: kind.category,
    kind: kind.kind,
    point,
    openingHours: str(tags, "opening_hours"),
    cuisine: str(tags, "cuisine"),
    website: website && /^https?:\/\//i.test(website) ? website : undefined,
    instagram: socialUrl(str(tags, "contact:instagram") ?? str(tags, "instagram"), "instagram.com"),
    facebook: socialUrl(str(tags, "contact:facebook") ?? str(tags, "facebook"), "facebook.com"),
  };
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function tagsOf(raw: unknown): Tags {
  const out: Tags = {};
  const t = asRecord(raw);
  if (!t) return out;
  for (const [k, v] of Object.entries(t)) if (typeof v === "string") out[k] = v;
  return out;
}

function elementsOf(body: unknown): JsonRecord[] {
  const root = asRecord(body);
  if (!root || !Array.isArray(root.elements)) throw new TypeError("Overpass answer has no elements array");
  return root.elements.map(asRecord).filter((e): e is JsonRecord => e !== null);
}

/** Highway ways with their node ids and geometry (`out body geom`). */
export function waysFromOverpass(body: unknown): StreetWay[] {
  const out: StreetWay[] = [];
  for (const el of elementsOf(body)) {
    if (el.type !== "way" || typeof el.id !== "number" || !Array.isArray(el.geometry)) continue;
    const tags = tagsOf(el.tags);
    if (!tags.highway) continue;
    const points: LatLon[] = [];
    for (const raw of el.geometry) {
      const p = asRecord(raw);
      if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") {
        points.length = 0;
        break;
      }
      points.push({ lat: p.lat, lon: p.lon });
    }
    if (points.length < 2) continue;
    const nodes = Array.isArray(el.nodes) && el.nodes.length === points.length && el.nodes.every((n) => typeof n === "number") ? (el.nodes as number[]) : undefined;
    out.push({ id: `way/${el.id}`, name: tags.name, ref: tags.ref, highway: tags.highway, nodes, points });
  }
  return out;
}

/** Shops from nodes (their position) and ways or relations (their centre, `out center tags`). */
export function shopsFromOverpass(body: unknown): Shop[] {
  const out: Shop[] = [];
  for (const el of elementsOf(body)) {
    if (typeof el.id !== "number" || typeof el.type !== "string") continue;
    const center = asRecord(el.center);
    const lat = typeof el.lat === "number" ? el.lat : typeof center?.lat === "number" ? center.lat : null;
    const lon = typeof el.lon === "number" ? el.lon : typeof center?.lon === "number" ? center.lon : null;
    if (lat === null || lon === null) continue;
    const shop = shopFromTags(`${el.type}/${el.id}`, { lat, lon }, tagsOf(el.tags));
    if (shop) out.push(shop);
  }
  return out;
}
