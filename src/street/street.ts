/**
 * Everything the street view shows, from the camera's position and heading,
 * the highway ways around and ahead, and the shops near them: the route
 * along the street and the shops on it, in order.
 */
import { localFrame, toLatLon, toLocal, type LatLon } from "../geo/enu.js";
import { CORRIDOR_M, DEFAULT_CORRIDOR_M, shopsAlong, type ShopAhead } from "./ahead.js";
import { shopRank } from "./overture.js";
import type { Shop, StreetWay } from "./osm.js";
import { followRoute, matchStreet, pointAt, type LocalWay, type Route } from "./route.js";

export const ROUTE_LENGTH_M = 5000;

export type StreetAhead = {
  source: string;
  attribution: string;
  fetchedAt: string;
  synthetic: boolean;
  /** Where the camera stood; the local frame's origin. */
  origin: LatLon;
  headingDeg: number;
  /** The street's direction where the camera stands. */
  streetHeadingDeg: number;
  /** How far the camera stood from the street's line, metres. */
  streetDistanceM: number;
  name?: string;
  highway: string;
  route: { points: LatLon[]; along: number[]; length: number };
  shops: ShopAhead[];
  /** Why the data came from where it did (a busy server, a fallback). */
  notes?: string[];
  /** How many places the street had before it was cut to `shops`, when it was cut. */
  placesFound?: number;
};

export type StreetInput = {
  origin: LatLon;
  headingDeg: number;
  ways: StreetWay[];
  shops: Shop[];
  source: string;
  attribution: string;
  fetchedAt: string;
  synthetic: boolean;
  maxLengthM?: number;
  /** The street's name when the starting point was picked from a list. */
  nameHint?: string;
  /** Why the data came from where it did (a busy server, a fallback). */
  notes?: string[];
  /** Keep at most this many places: the most certain ones, then those with links. */
  maxShops?: number;
};

/** The street ahead, or null when no street runs near the camera in the direction it faces. */
export function buildStreetAhead(input: StreetInput): StreetAhead | null {
  const frame = localFrame(input.origin);
  const local: LocalWay[] = input.ways.map((w) => ({ ...w, points: w.points.map((p) => toLocal(frame, p)) }));
  const match = matchStreet(local, input.headingDeg, input.nameHint);
  if (!match) return null;
  const route = followRoute(local, match, input.maxLengthM ?? ROUTE_LENGTH_M);
  const highway = local[match.way].highway;
  const corridor = CORRIDOR_M[highway] ?? DEFAULT_CORRIDOR_M;
  const found = shopsAlong(
    route,
    input.shops.map((shop) => ({ shop, local: toLocal(frame, shop.point) })),
    corridor,
  );
  const cut = input.maxShops !== undefined && found.length > input.maxShops;
  const shops = cut ? keepNearFirst(found, input.maxShops!) : found;
  return {
    source: input.source,
    attribution: input.attribution,
    fetchedAt: input.fetchedAt,
    synthetic: input.synthetic,
    origin: input.origin,
    headingDeg: input.headingDeg,
    streetHeadingDeg: pointAt(route, 0).headingDeg,
    streetDistanceM: match.distanceM,
    name: route.name,
    highway,
    route: { points: route.points.map((p) => toLatLon(frame, p)), along: route.along, length: route.length },
    shops,
    ...(input.notes && input.notes.length > 0 ? { notes: input.notes } : {}),
    ...(cut ? { placesFound: found.length } : {}),
  };
}

/** Within this distance of the camera (a walk of about 12 minutes) a busy street keeps nearly every place; beyond it, the most certain ones. */
export const NEAR_M = 1000;
/** Places kept beyond NEAR_M however busy the first kilometre is, so the rest of the street still shows. */
export const FAR_MIN = 200;

/**
 * At most `max` places, the first kilometre first: a walker decides what
 * is ahead from the places nearby, so those are not cut to make room for
 * far ones. Within each part the most certain, then those with links
 * (Overture's confidence; `shopRank`). In order along the street.
 */
export function keepNearFirst(found: readonly ShopAhead[], max: number): ShopAhead[] {
  const byRank = (list: ShopAhead[]) => list.sort((a, b) => shopRank(b) - shopRank(a));
  const near = byRank(found.filter((s) => s.s <= NEAR_M));
  const far = byRank(found.filter((s) => s.s > NEAR_M));
  // At least FAR_MIN beyond (a quarter of a small cap), more when the first kilometre leaves room.
  const farKeep = Math.min(far.length, Math.max(Math.min(FAR_MIN, Math.floor(max / 4)), max - near.length));
  const nearKeep = Math.min(near.length, max - farKeep);
  return [...near.slice(0, nearKeep), ...far.slice(0, farKeep)].sort((a, b) => a.s - b.s);
}

/** The street's route back in local metres around where the camera stood. */
export function localRoute(street: StreetAhead): Route {
  const frame = localFrame(street.origin);
  return {
    name: street.name,
    points: street.route.points.map((p) => toLocal(frame, p)),
    along: street.route.along,
    length: street.route.length,
    wayIds: [],
  };
}
