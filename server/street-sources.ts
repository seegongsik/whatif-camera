/**
 * The street ahead of a camera. The street itself comes from OpenStreetMap:
 * Overpass first (exact ways with their nodes), with OpenFreeMap vector
 * tiles loading alongside for when the Overpass servers are full. The places
 * along it come from Overture Maps (most of them from Meta's place data, with
 * Facebook pages and websites); when Overture cannot answer, from
 * OpenStreetMap (Overpass, or the tiles' places). Answers are cached per
 * instance for a quarter of an hour.
 */
import { localFrame, toLatLon, toLocal, type LatLon } from "../src/geo/enu.js";
import { latLonToTile } from "../src/data/mvt.js";
import { shopsFromOverpass, waysFromOverpass, type Shop, type StreetWay } from "../src/street/osm.js";
import { nearStreetsQuery, namedStreetQuery, shopsAlongQuery } from "../src/street/overpass.js";
import { MATCH_WIDE_RADIUS_M, matchStreet, simplify, type LocalWay } from "../src/street/route.js";
import { buildStreetAhead, ROUTE_LENGTH_M, type StreetAhead } from "../src/street/street.js";
import { CORRIDOR_M, DEFAULT_CORRIDOR_M } from "../src/street/ahead.js";
import { boxAround, piecesOf, type Box } from "../src/street/overpass.js";
import { OVERTURE_PLACES } from "./data/overture-places.js";
import { bucketReader, overturePlaces } from "./overture.js";
import { shopsFromTile, streetsFromTile } from "../src/street/tiles.js";
import { OPENFREEMAP_TILEJSON, TILE_ATTRIBUTION, UpstreamError, USER_AGENT, overpassUrls } from "./footprint-sources.js";
import { OSM_ATTRIBUTION } from "../src/data/footprints.js";
import type { EnvMap } from "./keys.js";

const CACHE_MS = 15 * 60 * 1000;
const OVERPASS_TIMEOUT_MS = 20_000;
/**
 * Overpass gets this long in all, server after server, before the tiles
 * (loaded meanwhile) take over. A healthy server answers both street queries
 * in a few seconds; from the deployment on 2026-10-28 it never answered, and
 * a longer wait only made every lookup slower.
 */
const OVERPASS_BUDGET_MS = 6_000;
/** The most places one street keeps: a 5 km street in Seoul has well over a thousand, more signs than a phone should draw. */
export const MAX_PLACES = 400;
export const OVERTURE_ATTRIBUTION = "Places © Overture Maps Foundation (CDLA-Permissive-2.0)";

/** Where to look for places along a street: a box per 250 m, as wide as the street's corridor. */
export function boxesAlong(street: StreetAhead): Box[] {
  const corridor = (CORRIDOR_M[street.highway] ?? DEFAULT_CORRIDOR_M) + 10;
  return piecesOf(street.route.points, 250).map((piece) => boxAround(piece, corridor));
}
const TILE_TIMEOUT_MS = 8_000;
const TILE_ZOOM = 14;
/** At most this many tiles for one street (each covers about 2 km at mid latitudes). */
const MAX_TILES = 12;

type Deps = {
  env?: EnvMap;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Places inside these boxes; Overture Maps from its bucket unless a test passes its own. */
  places?: (boxes: Box[]) => Promise<Shop[]>;
};

const cache = new Map<string, { at: number; value: StreetAhead }>();
let tileTemplate: { at: number; url: string } | null = null;

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 160);
}

async function overpass(url: string, query: string, deps: Deps, deadline: number): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const left = deadline - Date.now();
  if (left < 2000) throw new Error("out of time for Overpass");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": USER_AGENT },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(Math.min(OVERPASS_TIMEOUT_MS, left)),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 120)}`);
  const body = (await response.json()) as { remark?: unknown; elements?: unknown[] };
  if (typeof body.remark === "string" && /runtime error|timed out|out of memory/i.test(body.remark)) {
    throw new Error(`remark: ${body.remark.slice(0, 120)}`);
  }
  return body;
}

/** Streets and shops from one Overpass server: the street beside the camera, the same street ahead, then its shops. */
/** Streets (and, when `withShops`, the shops along them) from one Overpass server. */
async function fromOverpass(
  url: string,
  origin: LatLon,
  headingDeg: number,
  nameHint: string | undefined,
  deps: Deps,
  deadline: number,
  withShops: boolean,
): Promise<{ ways: StreetWay[]; shops: Shop[] }> {
  const near = waysFromOverpass(await overpass(url, nearStreetsQuery(origin, MATCH_WIDE_RADIUS_M + 10), deps, deadline));
  const frame = localFrame(origin);
  const local: LocalWay[] = near.map((w) => ({ ...w, points: w.points.map((p) => toLocal(frame, p)) }));
  const match = matchStreet(local, headingDeg, nameHint);
  if (!match) return { ways: near, shops: [] };
  const way = near[match.way];
  const key = way.name ? "name" : way.ref ? "ref" : null;
  const ahead = key ? waysFromOverpass(await overpass(url, namedStreetQuery(origin, key, (way.name ?? way.ref)!, ROUTE_LENGTH_M + 300), deps, deadline)) : [];
  const ways = [...near, ...ahead.filter((w) => !near.some((n) => n.id === w.id))];
  const street = buildStreetAhead({ origin, headingDeg, nameHint, ways, shops: [], source: "", attribution: "", fetchedAt: "", synthetic: false });
  if (!street || !withShops) return { ways, shops: [] };
  const corridor = (CORRIDOR_M[street.highway] ?? DEFAULT_CORRIDOR_M) + 10;
  const line = simplify(
    street.route.points.map((p) => toLocal(frame, p)),
    6,
  ).map((p) => toLatLon(frame, p));
  const shops = shopsFromOverpass(await overpass(url, shopsAlongQuery(line.slice(0, 400), corridor), deps, deadline));
  return { ways, shops };
}

async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Tiles over a strip from the camera along its heading, wide enough for a street that bends a little. */
export function tilesAhead(origin: LatLon, headingDeg: number, lengthM = ROUTE_LENGTH_M, halfWidthM = 400): { x: number; y: number }[] {
  const frame = localFrame(origin);
  const h = (headingDeg * Math.PI) / 180;
  const fwd = { x: Math.sin(h), y: Math.cos(h) };
  const right = { x: fwd.y, y: -fwd.x };
  const seen = new Map<string, { x: number; y: number }>();
  for (let m = -100; m <= lengthM + 100; m += 250) {
    for (const w of [-halfWidthM, 0, halfWidthM]) {
      const p = toLatLon(frame, { x: fwd.x * m + right.x * w, y: fwd.y * m + right.y * w });
      const t = latLonToTile(TILE_ZOOM, p);
      const tile = { x: Math.floor(t.x), y: Math.floor(t.y) };
      seen.set(`${tile.x}/${tile.y}`, tile);
    }
  }
  return [...seen.values()];
}

async function fromTiles(origin: LatLon, headingDeg: number, deps: Deps): Promise<{ ways: StreetWay[]; shops: Shop[] }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = (deps.now ?? Date.now)();
  if (!tileTemplate || now - tileTemplate.at > 60 * 60 * 1000) {
    const res = await fetchImpl(OPENFREEMAP_TILEJSON, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`TileJSON ${res.status}`);
    const json = (await res.json()) as { tiles?: unknown };
    const url = Array.isArray(json.tiles) && typeof json.tiles[0] === "string" ? json.tiles[0] : null;
    if (!url || !url.startsWith("https://") || !url.includes("{z}")) throw new Error("TileJSON has no tile URL");
    tileTemplate = { at: now, url };
  }
  const template = tileTemplate.url;
  const tiles = tilesAhead(origin, headingDeg).slice(0, MAX_TILES);
  const parts = await Promise.all(
    tiles.map(async ({ x, y }) => {
      const url = template.replace("{z}", String(TILE_ZOOM)).replace("{x}", String(x)).replace("{y}", String(y));
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
      if (res.status === 204 || res.status === 404) return { ways: [], shops: [] };
      if (!res.ok) throw new Error(`tile ${x}/${y} ${res.status}`);
      const bytes = await gunzipIfNeeded(new Uint8Array(await res.arrayBuffer()));
      return { ways: streetsFromTile(bytes, TILE_ZOOM, x, y), shops: shopsFromTile(bytes, TILE_ZOOM, x, y) };
    }),
  );
  return { ways: parts.flatMap((p) => p.ways), shops: parts.flatMap((p) => p.shops) };
}

export async function lookupStreet(origin: LatLon, headingDeg: number, deps: Deps = {}, nameHint?: string): Promise<StreetAhead> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const key = `${origin.lat.toFixed(4)},${origin.lon.toFixed(4)},${Math.round(headingDeg / 10) * 10},${nameHint ?? ""}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.value;

  const failures: string[] = [];
  const useOverture = env.OVERTURE_PLACES !== "off";
  // The tiles load alongside Overpass, so the fallback is ready the moment Overpass gives up.
  const tiles: Promise<{ ways: StreetWay[]; shops: Shop[] } | Error> | null =
    env.FOOTPRINT_TILES !== "off" ? fromTiles(origin, headingDeg, deps).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error)))) : null;
  const tilesResult = async () => {
    const result = tiles ? await tiles : null;
    if (result instanceof Error) failures.push(`tiles: ${errorText(result)}`);
    return result instanceof Error ? null : result;
  };

  // The street: Overpass, else the tiles.
  let base: { ways: StreetWay[]; shops: Shop[]; source: string; attribution: string; overpass: boolean } | null = null;
  const deadline = Date.now() + OVERPASS_BUDGET_MS;
  for (const url of overpassUrls(env)) {
    try {
      const data = await fromOverpass(url, origin, headingDeg, nameHint, deps, deadline, !useOverture);
      base = { ...data, source: `OpenStreetMap via Overpass API (${new URL(url).host})`, attribution: OSM_ATTRIBUTION, overpass: true };
      break;
    } catch (error) {
      failures.push(`${new URL(url).host}: ${errorText(error)}`);
    }
  }
  if (!base) {
    const data = await tilesResult();
    if (data) base = { ...data, source: "OpenStreetMap via OpenFreeMap vector tiles", attribution: TILE_ATTRIBUTION, overpass: false };
  }
  if (!base) throw new UpstreamError(502, `No map source answered. ${failures.join(" | ")}`);
  const fetchedAt = new Date(now()).toISOString();
  const bare = buildStreetAhead({ origin, headingDeg, nameHint, ways: base.ways, shops: [], source: base.source, attribution: base.attribution, fetchedAt, synthetic: false });
  if (!bare) {
    if (base.overpass) throw new UpstreamError(404, "No street runs beside you in the direction the camera faces (OpenStreetMap).");
    const why = failures.length > 0 ? ` Overpass did not answer first (${failures.join(" | ")}).` : "";
    throw new UpstreamError(404, `No named street runs beside you in the direction the camera faces (map tiles).${why}`);
  }

  // The places: Overture, else what the map had.
  let shops = base.shops;
  let source = base.source;
  let attribution = base.attribution;
  if (useOverture) {
    try {
      const read = deps.places ?? (async (boxes: Box[]) => (await overturePlaces(boxes, bucketReader(OVERTURE_PLACES, deps.fetchImpl))).shops);
      const places = await read(boxesAlong(bare));
      if (places.length > 0) {
        shops = places;
        source = `${source}; places: Overture Maps (release ${OVERTURE_PLACES.release})`;
        attribution = `${attribution} · ${OVERTURE_ATTRIBUTION}`;
      } else failures.push("overture: no places along this street");
    } catch (error) {
      failures.push(`overture: ${errorText(error)}`);
    }
    if (shops.length === 0 && base.overpass) {
      // Overpass was asked for the street only; the tiles' places stand in.
      const data = await tilesResult();
      if (data) {
        shops = data.shops;
        source = `${source}; places: OpenFreeMap vector tiles`;
        attribution = TILE_ATTRIBUTION;
      }
    }
  }
  const street = buildStreetAhead({ origin, headingDeg, nameHint, ways: base.ways, shops, source, attribution, fetchedAt, synthetic: false, notes: failures, maxShops: MAX_PLACES });
  if (!street) throw new UpstreamError(502, "The street did not build twice the same way.");
  cache.set(key, { at: now(), value: street });
  return street;
}

export function clearStreetCachesForTests(): void {
  cache.clear();
  tileTemplate = null;
}
