/**
 * Route handlers on Web-standard Request/Response, shared by the Vercel
 * functions in api/ and the Vite dev server.
 */
import type { DesignFacts } from "../src/design/plan.js";
import { MAX_RADIUS_M } from "../src/data/overpass.js";
import { designWithSpark } from "./design.js";
import { keyPresence, type EnvMap } from "./keys.js";
import { takeCall } from "./limits.js";
import { fetchFootprints, UpstreamError } from "./overpass-client.js";
import { SparkError } from "./spark.js";

/** Large enough for a 1280 px JPEG, well under the 4.5 MB function body limit. */
export const MAX_IMAGE_DATA_URL_CHARS = 2_500_000;

export type Deps = { env?: EnvMap; fetchImpl?: typeof fetch; now?: () => number };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function handleStatus(_request: Request, deps: Deps = {}): Promise<Response> {
  return json({ ok: true, ...keyPresence(deps.env ?? process.env) });
}

export async function handleFootprints(request: Request, deps: Deps = {}): Promise<Response> {
  if (request.method !== "GET") return json({ error: "use GET" }, 405);
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const radius = url.searchParams.has("radius") ? Number(url.searchParams.get("radius")) : 150;
  if (!url.searchParams.has("lat") || !url.searchParams.has("lon") || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: "lat and lon are required numbers" }, 400);
  }
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180 || !Number.isFinite(radius) || radius < 20 || radius > MAX_RADIUS_M) {
    return json({ error: `lat within ±85, lon within ±180, radius 20 to ${MAX_RADIUS_M} m` }, 400);
  }
  if (!takeCall("footprints", (deps.now ?? Date.now)(), deps.env ?? process.env)) {
    return json({ error: "daily footprint lookups for this server instance are used up" }, 429);
  }
  try {
    const set = await fetchFootprints({ lat, lon }, radius, deps);
    return json(set, 200, { "Cache-Control": "public, max-age=3600, s-maxage=86400" });
  } catch (error) {
    if (error instanceof UpstreamError) return json({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `footprint lookup failed: ${message}` }, 502);
  }
}

function factsFrom(value: unknown): DesignFacts | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const finite = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  if (
    !finite(v.heightM, 1, 1000) ||
    !finite(v.floors, 1, 300) ||
    !finite(v.roofAreaM2, 1, 200_000) ||
    !finite(v.widthM, 1, 2000) ||
    !finite(v.depthM, 1, 2000) ||
    typeof v.mainFacadeFacing !== "string" ||
    (v.hemisphere !== "north" && v.hemisphere !== "south")
  ) {
    return null;
  }
  const facts: DesignFacts = {
    heightM: Math.round((v.heightM as number) * 10) / 10,
    floors: Math.round(v.floors as number),
    roofAreaM2: Math.round(v.roofAreaM2 as number),
    widthM: Math.round((v.widthM as number) * 10) / 10,
    depthM: Math.round((v.depthM as number) * 10) / 10,
    mainFacadeFacing: String(v.mainFacadeFacing).slice(0, 20),
    hemisphere: v.hemisphere,
  };
  if (typeof v.buildingKind === "string" && /^[a-z_:;-]{1,40}$/.test(v.buildingKind)) facts.buildingKind = v.buildingKind;
  if (typeof v.facadeColor === "string" && /^#[0-9a-f]{6}$/i.test(v.facadeColor)) facts.facadeColor = v.facadeColor;
  return facts;
}

export async function handleDesign(request: Request, deps: Deps = {}): Promise<Response> {
  if (request.method !== "POST") return json({ error: "use POST" }, 405);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  const facts = factsFrom(body?.facts);
  if (!facts) return json({ error: "facts are missing or out of range" }, 400);
  const image = body.image;
  if (image !== undefined) {
    if (
      typeof image !== "string" ||
      image.length > MAX_IMAGE_DATA_URL_CHARS ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)
    ) {
      return json({ error: `image must be a base64 JPEG, PNG or WebP data URL under ${MAX_IMAGE_DATA_URL_CHARS} characters` }, 400);
    }
  }
  const env = deps.env ?? process.env;
  if (!keyPresence(env).basetenApiKeyConfigured) {
    return json({ error: "BASETEN_API_KEY is not configured; the page uses its local plan" }, 503);
  }
  if (!takeCall("spark", (deps.now ?? Date.now)(), env)) {
    return json({ error: "daily design calls for this server instance are used up" }, 429);
  }
  try {
    const result = await designWithSpark(facts, image as string | undefined, deps);
    return json(result);
  } catch (error) {
    if (error instanceof SparkError) return json({ error: error.message }, error.status === 503 ? 503 : 502);
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `design failed: ${message}` }, 502);
  }
}
