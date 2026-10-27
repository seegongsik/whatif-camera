/**
 * Building footprints around a point, from the first source that answers:
 * Overpass API instances in turn (exact OpenStreetMap ways and tags), then
 * OpenStreetMap vector tiles from OpenFreeMap (a CDN, so it answers when the
 * public Overpass servers are full). Answers are cached per instance for a
 * quarter of an hour.
 */
import { buildOverpassQuery, MAX_RADIUS_M, parseOverpass } from "../src/data/overpass.js";
import { buildingsFromTile, latLonToTile } from "../src/data/mvt.js";
import type { FootprintSet } from "../src/data/footprints.js";
import { localFrame, toLocal, type LatLon } from "../src/geo/enu.js";
import type { EnvMap } from "./keys.js";

export const DEFAULT_OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
export const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet";
export const TILE_ATTRIBUTION = "© OpenStreetMap contributors (ODbL) · OpenMapTiles · OpenFreeMap";
export const USER_AGENT = "whatif-camera/0.1 (hackathon prototype; github.com/seegongsik/whatif-camera)";

const CACHE_MS = 15 * 60 * 1000;
const OVERPASS_TIMEOUT_MS = 6_000;
/** How much longer an Overpass answer is awaited once the tiles have answered. */
const TILES_GRACE_MS = 1_500;
const TILE_TIMEOUT_MS = 6_000;
const TILE_ZOOM = 14;

const cache = new Map<string, { at: number; value: FootprintSet }>();
let tileTemplate: { at: number; url: string } | null = null;

export class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

type Deps = { env?: EnvMap; fetchImpl?: typeof fetch; now?: () => number; graceMs?: number };

/** OVERPASS_URLS (comma-separated) or OVERPASS_URL first, then the defaults; HTTPS only. */
export function overpassUrls(env: EnvMap): string[] {
  const listed = (env.OVERPASS_URLS ?? env.OVERPASS_URL ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.startsWith("https://"));
  return [...new Set([...listed, ...DEFAULT_OVERPASS_URLS])];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}

function shortText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

async function fromOverpass(url: string, center: LatLon, radius: number, deps: Deps): Promise<FootprintSet> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": USER_AGENT },
    body: `data=${encodeURIComponent(buildOverpassQuery(center, radius))}`,
    signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${shortText(await response.text().catch(() => ""))}`);
  const body = (await response.json()) as { remark?: unknown; elements?: unknown[] };
  // A query that ran out of time or memory still answers 200, with a remark and no elements.
  if (typeof body.remark === "string" && (!Array.isArray(body.elements) || body.elements.length === 0)) {
    throw new Error(`remark: ${shortText(body.remark)}`);
  }
  const set = parseOverpass(body, { center, radiusM: radius, fetchedAt: new Date((deps.now ?? Date.now)()).toISOString() });
  return { ...set, source: `OpenStreetMap via Overpass API (${hostOf(url)})` };
}

async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function fromTiles(center: LatLon, radius: number, deps: Deps): Promise<FootprintSet> {
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
  const frame = localFrame(center);
  // Tiles touched by the square around the point.
  const dLat = radius / frame.metersPerDegLat;
  const dLon = radius / frame.metersPerDegLon;
  const a = latLonToTile(TILE_ZOOM, { lat: center.lat + dLat, lon: center.lon - dLon });
  const b = latLonToTile(TILE_ZOOM, { lat: center.lat - dLat, lon: center.lon + dLon });
  const tiles: { x: number; y: number }[] = [];
  for (let x = Math.floor(a.x); x <= Math.floor(b.x); x += 1) {
    for (let y = Math.floor(a.y); y <= Math.floor(b.y); y += 1) tiles.push({ x, y });
  }
  const template = tileTemplate.url;
  const parts = await Promise.all(
    tiles.slice(0, 4).map(async ({ x, y }) => {
      const url = template.replace("{z}", String(TILE_ZOOM)).replace("{x}", String(x)).replace("{y}", String(y));
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
      if (res.status === 204 || res.status === 404) return [];
      if (!res.ok) throw new Error(`tile ${x}/${y} ${res.status}`);
      return buildingsFromTile(await gunzipIfNeeded(new Uint8Array(await res.arrayBuffer())), TILE_ZOOM, x, y);
    }),
  );
  const buildings = parts.flat().filter((building) => {
    const near = building.ring.some((p) => {
      const q = toLocal(frame, p);
      return Math.hypot(q.x, q.y) <= radius + 30;
    });
    return near;
  });
  return {
    source: "OpenStreetMap via OpenFreeMap vector tiles",
    attribution: TILE_ATTRIBUTION,
    fetchedAt: new Date(now).toISOString(),
    center,
    radiusM: radius,
    buildings,
  };
}

export async function lookupFootprints(center: LatLon, radiusM: number, deps: Deps = {}): Promise<FootprintSet> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const radius = Math.round(Math.min(MAX_RADIUS_M, Math.max(20, radiusM)));
  const key = `${center.lat.toFixed(5)},${center.lon.toFixed(5)},${radius}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.value;

  const failures: string[] = [];
  // The tiles are asked at once, in parallel; Overpass is preferred (exact ways
  // and tags) but not waited for long once the tiles have answered.
  const tiles: Promise<FootprintSet | null> =
    env.FOOTPRINT_TILES === "off"
      ? Promise.resolve(null)
      : fromTiles(center, radius, deps).catch((error: unknown) => {
          failures.push(`tiles: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        });
  let tilesAnswered = false;
  void tiles.then((t) => {
    tilesAnswered = t !== null;
  });
  const grace = deps.graceMs ?? TILES_GRACE_MS;
  type Outcome = { kind: "overpass"; value: FootprintSet } | { kind: "error"; message: string } | { kind: "tiles-first" };
  for (const url of overpassUrls(env)) {
    if (tilesAnswered) break;
    const attempt: Promise<Outcome> = fromOverpass(url, center, radius, deps).then(
      (value) => ({ kind: "overpass", value }),
      (error: unknown) => ({ kind: "error", message: error instanceof Error ? error.message : String(error) }),
    );
    const tilesFirst: Promise<Outcome> = tiles.then((t) =>
      t ? new Promise<Outcome>((resolve) => setTimeout(() => resolve({ kind: "tiles-first" }), grace)) : new Promise<Outcome>(() => undefined),
    );
    const outcome = await Promise.race([attempt, tilesFirst]);
    if (outcome.kind === "overpass") {
      cache.set(key, { at: now(), value: outcome.value });
      return outcome.value;
    }
    if (outcome.kind === "error") {
      failures.push(`${hostOf(url)}: ${outcome.message}`);
      continue;
    }
    failures.push(`${hostOf(url)}: no answer within ${grace} ms of the tiles`);
    break;
  }
  const fromTileSet = await tiles;
  if (fromTileSet) {
    cache.set(key, { at: now(), value: fromTileSet });
    return fromTileSet;
  }
  throw new UpstreamError(502, `No footprint source answered. ${failures.join(" | ")}`);
}

export function clearFootprintCachesForTests(): void {
  cache.clear();
  tileTemplate = null;
}
