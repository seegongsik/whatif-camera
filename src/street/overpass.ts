/**
 * Overpass API queries for the street view: the streets beside the camera,
 * the ways that carry the same name ahead, and the shops along the route.
 */
import type { LatLon } from "../geo/enu.js";
import { SHOP_AMENITIES, SHOP_LEISURE, SHOP_TOURISM, STREET_HIGHWAYS } from "./osm.js";

const at = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/** Overpass QL string literal. */
export function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Streets within `radiusM` of the camera, with node ids and geometry. */
export function nearStreetsQuery(origin: LatLon, radiusM = 60): string {
  return `[out:json][timeout:20];way(around:${Math.round(radiusM)},${at(origin)})[highway~"^(${STREET_HIGHWAYS.join("|")})$"];out body geom;`;
}

/** Every highway way carrying this name (or ref) within `radiusM`: the street ahead and its junctions. */
export function namedStreetQuery(origin: LatLon, key: "name" | "ref", value: string, radiusM: number): string {
  return `[out:json][timeout:25];way(around:${Math.round(radiusM)},${at(origin)})[highway][${key}=${quote(value)}];out body geom;`;
}

/** Shops within `radiusM` of a polyline (at most a few hundred points). */
export function shopsAlongQuery(line: LatLon[], radiusM: number): string {
  const around = `around:${Math.round(radiusM)},${line.map(at).join(",")}`;
  const parts = [
    `nwr(${around})[shop]`,
    `nwr(${around})[amenity~"^(${SHOP_AMENITIES.join("|")})$"]`,
    `nwr(${around})[tourism~"^(${SHOP_TOURISM.join("|")})$"]`,
    `nwr(${around})[leisure~"^(${SHOP_LEISURE.join("|")})$"]`,
  ];
  return `[out:json][timeout:25];(${parts.join(";")};);out center tags;`;
}
