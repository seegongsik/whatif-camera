/**
 * Places from Overture Maps: which of its categories count as places to
 * shop, eat, drink or stay on a street, and one Parquet row turned into a
 * shop. Most places in Overture come from Meta's place data (Facebook
 * pages), so many carry a Facebook page and a website.
 */
import type { LatLon } from "../geo/enu.js";
import type { Shop, ShopCategory } from "./osm.js";

/**
 * Overture's basic categories that are street-level places, by the kind of
 * place they are here. Offices, services, schools, hospitals and public
 * places are left out, as with OpenStreetMap.
 */
const BASIC: Record<string, ShopCategory> = {
  restaurant: "food",
  casual_eatery: "food",
  fast_food_restaurant: "food",
  food_truck_stand: "food",
  food_court: "food",
  coffee_shop: "cafe",
  cafe: "cafe",
  non_alcoholic_beverage_venue: "cafe",
  smoothie_juice_bar: "cafe",
  bar: "bar",
  lounge: "bar",
  dance_club: "bar",
  nightlife_venue: "bar",
  brewery: "bar",
  winery: "bar",
  distillery: "bar",
  alcoholic_beverage_venue: "bar",
  fashion_and_apparel_store: "fashion",
  sporting_goods_store: "fashion",
  food_and_beverage_store: "grocery",
  convenience_store: "grocery",
  farmers_market: "grocery",
  market: "grocery",
  personal_or_beauty_service: "beauty",
  personal_care_and_beauty_store: "beauty",
  pharmacy_and_drug_store: "health",
  dental_clinic: "health",
  vision_or_eye_care_clinic: "health",
  primary_care_or_general_clinic: "health",
  walk_in_clinic: "health",
  urgent_care_clinic: "health",
  bank_or_credit_union: "money",
  movie_theater: "fun",
  theatre_venue: "fun",
  performing_arts_venue: "fun",
  music_venue: "fun",
  comedy_club: "fun",
  museum: "fun",
  art_gallery: "fun",
  arcade: "fun",
  gaming_venue: "fun",
  amusement_park: "fun",
  amusement_attraction: "fun",
  hotel: "stay",
  lodging: "stay",
  bed_and_breakfast: "stay",
  inn: "stay",
  resort: "stay",
  shopping: "shop",
  specialty_store: "shop",
  flowers_and_gifts_store: "shop",
  electronics_store: "shop",
  books_music_and_video_store: "shop",
  hardware_home_and_garden_store: "shop",
  arts_crafts_and_hobby_store: "shop",
  toys_and_games_store: "shop",
  musical_instrument_and_pro_audio_store: "shop",
  animal_and_pet_store: "shop",
  office_supply_store: "shop",
  department_store: "shop",
  shopping_mall: "shop",
  second_hand_store: "shop",
  discount_store: "shop",
  superstore: "shop",
  kiosk: "shop",
};

export const OVERTURE_CATEGORIES = Object.keys(BASIC);

/** Below this Overture's own confidence that the place exists, it is left out. */
export const MIN_CONFIDENCE = 0.5;

/**
 * The kind of place from the basic category; the kind shown is the finer
 * taxonomy entry when there is one ("korean_restaurant" rather than "restaurant").
 */
export function categoryForOverture(basic: unknown, finer?: unknown): { category: ShopCategory; kind: string } | null {
  if (typeof basic !== "string" || !Object.prototype.hasOwnProperty.call(BASIC, basic)) return null;
  const shown = typeof finer === "string" && /^[a-z0-9_]{2,60}$/.test(finer) ? finer : basic;
  return { category: BASIC[basic], kind: `category=${shown}` };
}

/** A web link from the data: http(s) only, so nothing else can end up in an href. */
export function webLink(value: unknown, host?: string): string | undefined {
  if (typeof value !== "string" || value.length > 300) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (host && url.hostname !== host && !url.hostname.endsWith(`.${host}`)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** One Overture place row (the columns the street lookup reads). */
export type OvertureRow = {
  names?: { primary?: unknown } | null;
  basic_category?: unknown;
  taxonomy?: { primary?: unknown } | null;
  confidence?: unknown;
  websites?: unknown;
  socials?: unknown;
  brand?: { names?: { primary?: unknown } | null } | null;
  bbox?: { xmin?: unknown; ymin?: unknown } | null;
  operating_status?: unknown;
};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A shop from one row, or null when it is not a named, open, likely street-level place. */
export function shopFromOverture(id: string, row: OvertureRow): Shop | null {
  const name = typeof row.names?.primary === "string" ? row.names.primary.trim() : "";
  if (!name) return null;
  if (row.operating_status === "permanently_closed" || row.operating_status === "temporarily_closed") return null;
  if (typeof row.confidence !== "number" || row.confidence < MIN_CONFIDENCE) return null;
  const kind = categoryForOverture(row.basic_category, row.taxonomy?.primary);
  if (!kind) return null;
  const lon = row.bbox?.xmin;
  const lat = row.bbox?.ymin;
  if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const point: LatLon = { lat, lon };
  const shop: Shop = { id, name: name.slice(0, 120), category: kind.category, kind: kind.kind, point, confidence: row.confidence };
  // "korean_restaurant" → cuisine "korean", for the quests.
  const cuisine = /^([a-z_]+)_restaurant$/.exec(kind.kind.slice("category=".length))?.[1];
  if (cuisine) shop.cuisine = cuisine;
  const brand = row.brand?.names?.primary;
  if (typeof brand === "string" && brand.trim()) shop.brand = brand.trim().slice(0, 120);
  const website = list(row.websites).map((w) => webLink(w)).find((w) => w !== undefined);
  if (website) shop.website = website;
  const socials = list(row.socials);
  const facebook = socials.map((s) => webLink(s, "facebook.com")).find((s) => s !== undefined);
  if (facebook) shop.facebook = facebook;
  const instagram = socials.map((s) => webLink(s, "instagram.com")).find((s) => s !== undefined);
  if (instagram) shop.instagram = instagram;
  return shop;
}

/** How much a place is worth a sign when a street has more than the view can show: confidence, then links. */
export function shopRank(shop: Shop): number {
  return (shop.confidence ?? 0.7) + (shop.facebook ? 0.1 : 0) + (shop.website ? 0.05 : 0) + (shop.brand ? 0.05 : 0);
}
