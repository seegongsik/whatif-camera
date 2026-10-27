/**
 * OpenStreetMap building footprints through the Overpass API.
 * The query asks for every building way and multipolygon relation within a
 * radius, with tags and inline geometry (`out tags geom`).
 */
import type { LatLon } from "../geo/enu.js";
import { OSM_ATTRIBUTION, type BuildingTags, type FootprintRecord, type FootprintSet } from "./footprints.js";

export const MAX_RADIUS_M = 300;

export function buildOverpassQuery(center: LatLon, radiusM: number): string {
  const r = Math.round(Math.min(MAX_RADIUS_M, Math.max(10, radiusM)));
  const at = `${center.lat.toFixed(6)},${center.lon.toFixed(6)}`;
  return (
    `[out:json][timeout:25];(` +
    `way["building"](around:${r},${at});` +
    `relation["building"]["type"="multipolygon"](around:${r},${at});` +
    `);out tags geom;`
  );
}

/** "12", "12.5 m", "12m" → metres; "40'" or "40 ft" → metres; anything else → undefined. */
export function parseLengthTag(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  const metric = /^(-?\d+(?:\.\d+)?)\s*(m|meters?|metres?)?$/.exec(text);
  if (metric) {
    const n = Number(metric[1]);
    return Number.isFinite(n) && n >= 0 && n < 1000 ? n : undefined;
  }
  const feet = /^(\d+(?:\.\d+)?)\s*('|ft|feet)$/.exec(text);
  if (feet) {
    const n = Number(feet[1]) * 0.3048;
    return Number.isFinite(n) && n < 1000 ? n : undefined;
  }
  return undefined;
}

export function parseLevelsTag(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n <= 0 || n > 200) return undefined;
  return n;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

export function tagsFrom(raw: unknown): BuildingTags {
  const t = asRecord(raw) ?? {};
  const tags: BuildingTags = {};
  if (typeof t.building === "string") tags.kind = t.building;
  const levels = parseLevelsTag(t["building:levels"]);
  if (levels !== undefined) tags.levels = levels;
  const height = parseLengthTag(t.height);
  if (height !== undefined) tags.heightM = height;
  const minHeight = parseLengthTag(t.min_height);
  if (minHeight !== undefined) tags.minHeightM = minHeight;
  if (typeof t["roof:shape"] === "string") tags.roofShape = t["roof:shape"];
  return tags;
}

function ringFromGeometry(geometry: unknown): LatLon[] | null {
  if (!Array.isArray(geometry)) return null;
  const ring: LatLon[] = [];
  for (const raw of geometry) {
    const p = asRecord(raw);
    if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") return null;
    ring.push({ lat: p.lat, lon: p.lon });
  }
  if (ring.length < 4) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  // Building ways are closed: the last node repeats the first.
  if (first.lat !== last.lat || first.lon !== last.lon) return null;
  ring.pop();
  return ring;
}

export function parseOverpass(
  body: unknown,
  meta: { center: LatLon; radiusM: number; fetchedAt: string },
): FootprintSet {
  const root = asRecord(body);
  if (!root || !Array.isArray(root.elements)) {
    throw new TypeError("Overpass answer has no elements array");
  }
  const buildings: FootprintRecord[] = [];
  for (const raw of root.elements) {
    const el = asRecord(raw);
    if (!el || typeof el.id !== "number") continue;
    if (el.type === "way") {
      const ring = ringFromGeometry(el.geometry);
      if (ring) buildings.push({ id: `way/${el.id}`, ring, tags: tagsFrom(el.tags) });
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      // Outer members that are closed on their own; split outer rings and
      // courtyards (inner rings) are not assembled.
      const tags = tagsFrom(el.tags);
      let part = 0;
      for (const rawMember of el.members) {
        const m = asRecord(rawMember);
        if (!m || m.type !== "way" || m.role !== "outer") continue;
        const ring = ringFromGeometry(m.geometry);
        if (!ring) continue;
        buildings.push({ id: `relation/${el.id}/${part}`, ring, tags });
        part += 1;
      }
    }
  }
  return {
    source: "OpenStreetMap via Overpass API",
    attribution: OSM_ATTRIBUTION,
    fetchedAt: meta.fetchedAt,
    center: meta.center,
    radiusM: meta.radiusM,
    buildings,
  };
}
