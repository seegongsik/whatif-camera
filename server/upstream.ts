/**
 * The outside services the street lookup reads, and how it names them: the
 * Overpass API instances (OpenStreetMap ways and tags) and OpenFreeMap's
 * vector tiles, with the credits each one asks for, and the error that
 * carries an upstream failure to the page with its status.
 */
import type { EnvMap } from "./keys.js";

export const DEFAULT_OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
export const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";
export const TILE_ATTRIBUTION = "© OpenStreetMap contributors (ODbL) · OpenMapTiles · OpenFreeMap";
export const USER_AGENT = "whatif-camera/0.1 (What's Ahead, hackathon entry; github.com/seegongsik/whatif-camera)";

export class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

/** OVERPASS_URLS (comma-separated) or OVERPASS_URL first, then the defaults; HTTPS only. */
export function overpassUrls(env: EnvMap): string[] {
  const listed = (env.OVERPASS_URLS ?? env.OVERPASS_URL ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.startsWith("https://"));
  return [...new Set([...listed, ...DEFAULT_OVERPASS_URLS])];
}
