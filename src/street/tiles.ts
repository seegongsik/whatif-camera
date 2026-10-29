/**
 * Streets and shops from OpenMapTiles-schema vector tiles, for when the
 * Overpass servers are full: named roads from the "transportation_name"
 * layer and places from the "poi" layer. Tiles carry names and kinds but no
 * brands, hours or social links. Lines are cut at the tile's edge so the
 * pieces of neighbouring tiles meet end to end.
 */
import { geometryParts, layerFeatures, tileToLatLon } from "../data/mvt.js";
import { categorize, STREET_HIGHWAYS, type Shop, type StreetWay } from "./osm.js";

type P = { x: number; y: number };

/** Cuts a polyline to the box [0, size]²; a line that leaves and comes back gives several pieces. */
export function clipLine(line: P[], size: number): P[][] {
  const inside = (p: P) => p.x >= 0 && p.x <= size && p.y >= 0 && p.y <= size;
  const pieces: P[][] = [];
  let current: P[] = [];
  for (let i = 0; i + 1 < line.length; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    // Liang–Barsky on the segment.
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const checks: [number, number][] = [
      [-dx, a.x],
      [dx, size - a.x],
      [-dy, a.y],
      [dy, size - a.y],
    ];
    let visible = true;
    for (const [p, q] of checks) {
      if (p === 0) {
        if (q < 0) visible = false;
      } else {
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    if (!visible || t0 > t1) {
      if (current.length > 1) pieces.push(current);
      current = [];
      continue;
    }
    const start = { x: a.x + dx * t0, y: a.y + dy * t0 };
    const end = { x: a.x + dx * t1, y: a.y + dy * t1 };
    if (current.length === 0) current.push(start);
    current.push(end);
    if (!inside(b)) {
      if (current.length > 1) pieces.push(current);
      current = [];
    }
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

/** OpenMapTiles road classes that match an OSM highway value. */
const CLASS_TO_HIGHWAY: Record<string, string> = { minor: "residential" };

/**
 * The OSM highway value of a tile's road. A pedestrian street (a shopping
 * street closed to cars, such as Santa Monica's Third Street Promenade)
 * comes as class "path" with subclass "pedestrian"; other paths (footways,
 * cycleways, steps) are not streets.
 */
export function highwayOf(cls: string, subclass: string): string {
  if (cls === "path") return subclass === "pedestrian" ? "pedestrian" : "";
  return CLASS_TO_HIGHWAY[cls] ?? cls;
}

export function streetsFromTile(tile: Uint8Array, z: number, tx: number, ty: number): StreetWay[] {
  const layer = layerFeatures(tile, "transportation_name");
  if (!layer) return [];
  const out: StreetWay[] = [];
  layer.features.forEach((f, index) => {
    if (f.type !== 2) return;
    const name = typeof f.props.name === "string" ? f.props.name : undefined;
    const ref = typeof f.props.ref === "string" ? f.props.ref : undefined;
    const cls = typeof f.props.class === "string" ? f.props.class : "";
    const highway = highwayOf(cls, typeof f.props.subclass === "string" ? f.props.subclass : "");
    if (!(STREET_HIGHWAYS as readonly string[]).includes(highway) || (!name && !ref)) return;
    let part = 0;
    for (const line of geometryParts(f.geometry)) {
      for (const piece of clipLine(line, layer.extent)) {
        out.push({
          id: `tile/${z}/${tx}/${ty}/${index}/${part}`,
          name,
          ref,
          highway,
          points: piece.map((p) => tileToLatLon(z, tx, ty, p.x, p.y, layer.extent)),
        });
        part += 1;
      }
    }
  });
  return out;
}

/**
 * POI classes and values in the tiles that are not places to shop, eat or
 * stay: public buildings, street furniture, and offices (the tile keeps an
 * office's value, such as "company", without saying it is an office).
 */
const NOT_SHOPS = new Set([
  "school", "college", "university", "kindergarten", "hospital", "place_of_worship", "parking", "bicycle_parking",
  "bus", "railway", "ferry_terminal", "aerialway", "police", "fire_station", "town_hall", "townhall", "post", "post_office",
  "library", "toilets", "drinking_water", "information", "park", "playground", "garden", "campsite", "cemetery",
  "grave_yard", "shelter", "fuel", "charging_station", "atm", "bench", "waste_basket", "recycling", "entrance",
  "bicycle_rental", "vending_machine", "parcel_locker", "post_box", "telephone", "taxi",
  "office", "company", "insurance", "diplomatic", "government", "lawyer", "estate_agent", "employment_agency", "it", "ngo",
  "coworking", "telecommunication", "financial", "tax_advisor", "accountant", "architect", "association", "consulting",
  "educational_institution", "religion", "political_party", "notary", "research", "foundation", "newspaper", "advertising_agency",
]);

export function shopsFromTile(tile: Uint8Array, z: number, tx: number, ty: number): Shop[] {
  const layer = layerFeatures(tile, "poi");
  if (!layer) return [];
  const out: Shop[] = [];
  layer.features.forEach((f, index) => {
    if (f.type !== 1) return;
    const name = typeof f.props.name === "string" ? f.props.name.trim() : "";
    const sub = typeof f.props.subclass === "string" ? f.props.subclass : "";
    if (!name || !sub) return;
    // The tile keeps the OSM value in subclass; the key it came from is not kept.
    const cls = typeof f.props.class === "string" ? f.props.class : "";
    const kind =
      NOT_SHOPS.has(cls) || NOT_SHOPS.has(sub)
        ? null
        : (categorize({ amenity: sub }) ?? categorize({ tourism: sub }) ?? categorize({ leisure: sub }) ?? categorize({ shop: sub }));
    if (!kind) return;
    for (const [p] of geometryParts(f.geometry)) {
      if (!p || p.x < 0 || p.y < 0 || p.x > layer.extent || p.y > layer.extent) continue;
      out.push({
        id: `tile/${z}/${tx}/${ty}/poi/${index}`,
        name: name.slice(0, 120),
        category: kind.category,
        kind: kind.kind,
        point: tileToLatLon(z, tx, ty, p.x, p.y, layer.extent),
      });
    }
  });
  return out;
}
