/**
 * Building footprints (the top view). Shared by the server, which fetches
 * them from OpenStreetMap, and the page, which works in local metres.
 */
import { localFrame, toLocal, type LatLon, type LocalFrame } from "../geo/enu.js";
import { area, cleanRing, type Ring } from "../geo/polygon.js";

export type BuildingTags = {
  /** OSM building=* value, for example "yes", "apartments" or "retail". */
  kind?: string;
  /** OSM building:levels (storeys above ground). */
  levels?: number;
  /** OSM height in metres. */
  heightM?: number;
  /** OSM min_height in metres (a raised part). */
  minHeightM?: number;
  /** OSM roof:shape. */
  roofShape?: string;
  /**
   * Height from a vector tile (OpenMapTiles render_height). Tiles fill in a
   * default when OSM has none, so it is only ever used as an approximation.
   */
  tileHeightM?: number;
};

export type FootprintRecord = {
  id: string;
  /** Outer ring, not closed. */
  ring: LatLon[];
  tags: BuildingTags;
};

export type FootprintSet = {
  /** Where the footprints came from, for example "OpenStreetMap via Overpass API" or "SYNTHETIC". */
  source: string;
  attribution: string;
  fetchedAt: string;
  center: LatLon;
  radiusM: number;
  buildings: FootprintRecord[];
};

export type LocalFootprint = {
  id: string;
  /** Counter-clockwise ring in local east-north metres. */
  ring: Ring;
  tags: BuildingTags;
  areaM2: number;
};

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

export function toLocalFootprints(set: FootprintSet, frame: LocalFrame): LocalFootprint[] {
  const out: LocalFootprint[] = [];
  for (const building of set.buildings) {
    const ring = cleanRing(building.ring.map((p) => toLocal(frame, p)));
    if (ring.length < 3) continue;
    const a = area(ring);
    if (a < 4) continue;
    out.push({ id: building.id, ring, tags: building.tags, areaM2: a });
  }
  return out;
}

export function frameFor(center: LatLon): LocalFrame {
  return localFrame(center);
}

/** Basic structural check for a footprint set read from a preset or the API. */
export function isFootprintSet(value: unknown): value is FootprintSet {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.source !== "string" || !Array.isArray(v.buildings)) return false;
  const center = v.center as Record<string, unknown> | undefined;
  if (!center || typeof center.lat !== "number" || typeof center.lon !== "number") return false;
  return v.buildings.every((b) => {
    if (typeof b !== "object" || b === null) return false;
    const r = b as Record<string, unknown>;
    return (
      typeof r.id === "string" &&
      Array.isArray(r.ring) &&
      r.ring.every(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as LatLon).lat === "number" &&
          typeof (p as LatLon).lon === "number",
      )
    );
  });
}
