/**
 * Everything the street view shows, from the camera's position and heading,
 * the highway ways around and ahead, and the shops near them: the route
 * along the street and the shops on it, in order.
 */
import { localFrame, toLatLon, toLocal, type LatLon } from "../geo/enu.js";
import { CORRIDOR_M, DEFAULT_CORRIDOR_M, shopsAlong, type ShopAhead } from "./ahead.js";
import type { Shop, StreetWay } from "./osm.js";
import { followRoute, matchStreet, pointAt, type LocalWay } from "./route.js";

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
  const shops = shopsAlong(
    route,
    input.shops.map((shop) => ({ shop, local: toLocal(frame, shop.point) })),
    corridor,
  );
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
  };
}
