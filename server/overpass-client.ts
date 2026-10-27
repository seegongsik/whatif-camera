/**
 * Fetches building footprints from an Overpass API instance. Answers are
 * cached per instance for a quarter of an hour so a re-try or a second look
 * at the same spot does not query again.
 */
import { buildOverpassQuery, MAX_RADIUS_M, parseOverpass } from "../src/data/overpass.js";
import type { FootprintSet } from "../src/data/footprints.js";
import type { EnvMap } from "./keys.js";

export const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const USER_AGENT = "whatif-camera/0.1 (hackathon prototype; github.com/seegongsik/whatif-camera)";

const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; value: FootprintSet }>();

export class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

export async function fetchFootprints(
  center: { lat: number; lon: number },
  radiusM: number,
  deps: { env?: EnvMap; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<FootprintSet> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const radius = Math.round(Math.min(MAX_RADIUS_M, Math.max(20, radiusM)));
  const key = `${center.lat.toFixed(5)},${center.lon.toFixed(5)},${radius}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.value;

  const url = env.OVERPASS_URL && env.OVERPASS_URL.startsWith("https://") ? env.OVERPASS_URL : DEFAULT_OVERPASS_URL;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: `data=${encodeURIComponent(buildOverpassQuery(center, radius))}`,
    signal: AbortSignal.timeout(28_000),
  });
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
    throw new UpstreamError(response.status === 429 ? 429 : 502, `Overpass answered ${response.status}${text ? `: ${text}` : ""}`);
  }
  const value = parseOverpass(await response.json(), {
    center,
    radiusM: radius,
    fetchedAt: new Date(now()).toISOString(),
  });
  cache.set(key, { at: now(), value });
  return value;
}

export function clearFootprintCacheForTests(): void {
  cache.clear();
}
