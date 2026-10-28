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

type Box = { south: number; west: number; north: number; east: number };

const box = (b: Box) => `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;

/** A box around points, grown by `marginM` on every side. */
export function boxAround(points: LatLon[], marginM: number): Box {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const dLat = marginM / 111_320;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLon = marginM / (111_320 * Math.max(0.05, Math.cos((midLat * Math.PI) / 180)));
  return { south: Math.min(...lats) - dLat, west: Math.min(...lons) - dLon, north: Math.max(...lats) + dLat, east: Math.max(...lons) + dLon };
}

/**
 * Every highway way carrying this name (or ref) within `radiusM`: the street
 * ahead and its junctions. A box rather than a radius: the server answers a
 * tag inside a box from its indexes, which is much cheaper.
 */
export function namedStreetQuery(origin: LatLon, key: "name" | "ref", value: string, radiusM: number): string {
  return `[out:json][timeout:25];way[highway][${key}=${quote(value)}](${box(boxAround([origin], radiusM))});out body geom;`;
}

/** The polyline cut into pieces of at most `maxM` metres (flat-earth distances are fine at street scale). */
export function piecesOf(line: LatLon[], maxM: number): LatLon[][] {
  const kLat = 111_320;
  const kLon = 111_320 * Math.cos(((line[0]?.lat ?? 0) * Math.PI) / 180);
  const pieces: LatLon[][] = [];
  let current: LatLon[] = line.length > 0 ? [line[0]] : [];
  let used = 0;
  for (let i = 1; i < line.length; i += 1) {
    let a = current[current.length - 1];
    const b = line[i];
    let step = Math.hypot((b.lat - a.lat) * kLat, (b.lon - a.lon) * kLon);
    while (used + step > maxM && step > 0) {
      const t = (maxM - used) / step;
      const cut = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
      current.push(cut);
      pieces.push(current);
      current = [cut];
      used = 0;
      a = cut;
      step = Math.hypot((b.lat - a.lat) * kLat, (b.lon - a.lon) * kLon);
    }
    current.push(b);
    used += step;
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

/**
 * Shops near a polyline: one box per 250 m stretch of the line, grown by
 * `radiusM`. A box is far cheaper for the server than a distance from a long
 * line; places in a box's corners beyond the corridor are dropped when they
 * are placed on the route.
 */
export function shopsAlongQuery(line: LatLon[], radiusM: number, stretchM = 250): string {
  const pieces = piecesOf(line, stretchM);
  const boxes = (pieces.length > 0 ? pieces : [line]).map((piece) => box(boxAround(piece, radiusM)));
  const filters = ["[shop]", `[amenity~"^(${SHOP_AMENITIES.join("|")})$"]`, `[tourism~"^(${SHOP_TOURISM.join("|")})$"]`, `[leisure~"^(${SHOP_LEISURE.join("|")})$"]`];
  const parts = boxes.flatMap((b) => filters.map((f) => `nwr${f}(${b})`));
  return `[out:json][timeout:25];(${parts.join(";")};);out center tags;`;
}
