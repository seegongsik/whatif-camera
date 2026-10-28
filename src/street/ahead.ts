/**
 * The shops along the route: each one placed by how far ahead it is and on
 * which side, kept when it stands within the street's corridor, and one entry
 * per place when the map has a shop twice (a node and a building outline).
 */
import type { EN } from "../geo/enu.js";
import type { Shop } from "./osm.js";
import { placeOnRoute, type Route } from "./route.js";

export type ShopAhead = Shop & {
  /** Metres ahead of the camera along the street (negative: just behind). */
  s: number;
  /** Metres to the right (positive) or left (negative) of the street's line. */
  offset: number;
  side: "left" | "right";
};

/** Half-width of the strip along the street where shops count, by road class: wide avenues have far sidewalks. */
export const CORRIDOR_M: Record<string, number> = {
  trunk: 60,
  primary: 55,
  secondary: 45,
  tertiary: 40,
  pedestrian: 30,
  living_street: 30,
  residential: 30,
  unclassified: 30,
  service: 25,
};
export const DEFAULT_CORRIDOR_M = 35;

function normalName(name: string): string {
  return name.toLowerCase().replace(/[\s'’.,·&-]+/g, "");
}

const DETAILS = ["brand", "openingHours", "cuisine", "website", "instagram", "facebook"] as const;

export function shopsAlong(route: Route, shops: { shop: Shop; local: EN }[], corridorM: number): ShopAhead[] {
  const placed: ShopAhead[] = [];
  for (const { shop, local } of shops) {
    const at = placeOnRoute(route, local);
    if (!at || Math.abs(at.offset) > corridorM) continue;
    placed.push({ ...shop, s: at.s, offset: at.offset, side: at.offset >= 0 ? "right" : "left" });
  }
  placed.sort((a, b) => a.s - b.s);
  // One entry per place: the same name on the same side within 25 m. The
  // entries complete each other (a node may have the hours, the building the website).
  const kept: ShopAhead[] = [];
  for (const shop of placed) {
    const twin = kept.find((k) => k.side === shop.side && Math.abs(k.s - shop.s) < 25 && normalName(k.name) === normalName(shop.name));
    if (!twin) {
      kept.push({ ...shop });
      continue;
    }
    for (const key of DETAILS) if (twin[key] === undefined && shop[key] !== undefined) twin[key] = shop[key];
  }
  return kept;
}
