/**
 * Route handlers on Web-standard Request/Response, shared by the Vercel
 * functions in api/ and the Vite dev server.
 */
import type { DesignFacts } from "../src/design/plan.js";
import { MAX_RADIUS_M } from "../src/data/overpass.js";
import { designWithSpark } from "./design.js";
import { keyPresence, type EnvMap } from "./keys.js";
import { takeCall } from "./limits.js";
import { lookupFootprints, UpstreamError } from "./footprint-sources.js";
import { SparkError } from "./spark.js";
import { lookupStreet } from "./street-sources.js";
import { picksWithSpark, questWithSpark, signsWithSpark } from "./street-spark.js";
import { FAMOUS_STREETS } from "../src/street/famous.js";
import { isGroupKey, pickCandidates, PICK_DEMO_MAX_PLACES, PICK_MAX_PLACES, PICK_MIN_PLACES, roughPosition, type PickPlace } from "../src/street/picks.js";
import { showReach } from "../src/street/show-plan.js";
import { isSignPrompt, SamError, SIGN_PROMPT, SIGN_PROMPTS, signsWithSam } from "./sam.js";
import { SHOP_CATEGORIES, type ShopCategory } from "../src/street/osm.js";
import { isQuestTheme, type QuestPlace } from "../src/street/quest.js";
import { MAX_SIGN_BOXES, type SpotPlace } from "../src/street/spotted.js";

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
    const set = await lookupFootprints({ lat, lon }, radius, deps);
    return json(set, 200, { "Cache-Control": "public, max-age=3600, s-maxage=86400" });
  } catch (error) {
    if (error instanceof UpstreamError) return json({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: `footprint lookup failed: ${message}` }, 502);
  }
}

/**
 * How long a street stands in the CDN: a day, then the stale one while a
 * fresh one is looked up (a week), so a street someone opened before (a demo
 * street) opens at once. A new deployment starts with an empty cache.
 */
const STREET_CACHE = "public, max-age=900, s-maxage=86400, stale-while-revalidate=604800";

export async function handleStreet(request: Request, deps: Deps = {}): Promise<Response> {
  if (request.method !== "GET") return json({ error: "use GET" }, 405);
  const url = new URL(request.url);
  const [lat, lon, heading] = ["lat", "lon", "heading"].map((k) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : NaN));
  if (![lat, lon, heading].every(Number.isFinite)) return json({ error: "lat, lon and heading are required numbers" }, 400);
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return json({ error: "lat within ±85, lon within ±180" }, 400);
  const name = url.searchParams.get("street") ?? undefined;
  if (name !== undefined && (name.trim().length === 0 || name.length > 80)) return json({ error: "street must be a name of 1 to 80 characters" }, 400);
  if (!takeCall("street", (deps.now ?? Date.now)(), deps.env ?? process.env)) {
    return json({ error: "daily street lookups for this server instance are used up" }, 429);
  }
  try {
    const street = await lookupStreet({ lat, lon }, ((heading % 360) + 360) % 360, deps, name?.trim());
    return json(street, 200, { "Cache-Control": STREET_CACHE });
  } catch (error) {
    if (error instanceof UpstreamError) return json({ error: error.message }, error.status);
    return json({ error: `street lookup failed: ${error instanceof Error ? error.message : String(error)}` }, 502);
  }
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const ID_PATTERN = /^[A-Za-z0-9_:./-]{1,40}$/;

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : undefined;
}

/** A place as the page sends it, or null when anything is out of shape. */
function placeFrom(value: unknown): (SpotPlace & Partial<QuestPlace>) | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const name = text(v.name, 80);
  if (typeof v.id !== "string" || !ID_PATTERN.test(v.id) || !name) return null;
  if (v.side !== "left" && v.side !== "right") return null;
  if (typeof v.distanceM !== "number" || !Number.isFinite(v.distanceM) || v.distanceM < 0 || v.distanceM > 6000) return null;
  const place: SpotPlace & Partial<QuestPlace> = { id: v.id, name, side: v.side, distanceM: Math.round(v.distanceM) };
  if (typeof v.category === "string" && (SHOP_CATEGORIES as readonly string[]).includes(v.category)) place.category = v.category as ShopCategory;
  if (typeof v.kind === "string" && /^[a-z0-9_;:.-]{1,40}$/.test(v.kind)) place.kind = v.kind;
  const brand = text(v.brand, 80);
  if (brand) place.brand = brand;
  const hours = text(v.openingHours, 120);
  if (hours) place.openingHours = hours;
  const cuisine = text(v.cuisine, 60);
  if (cuisine) place.cuisine = cuisine;
  if (v.known === true) place.known = true;
  return place;
}

function placesFrom(value: unknown, max: number): (SpotPlace & Partial<QuestPlace>)[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return null;
  const places = value.map(placeFrom);
  if (places.some((p) => p === null)) return null;
  const list = places as (SpotPlace & Partial<QuestPlace>)[];
  return new Set(list.map((p) => p.id)).size === list.length ? list : null;
}

function imageError(image: unknown): string | null {
  if (typeof image === "string" && image.length <= MAX_IMAGE_DATA_URL_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return null;
  return `image must be a base64 JPEG, PNG or WebP data URL under ${MAX_IMAGE_DATA_URL_CHARS} characters`;
}

/** Checks shared by the street's model routes: a key, then one call from the daily allowance. */
function sparkGate(deps: Deps, what: string): Response | null {
  const env = deps.env ?? process.env;
  if (!keyPresence(env).basetenApiKeyConfigured) return json({ error: `BASETEN_API_KEY is not configured; the page ${what}` }, 503);
  if (!takeCall("spark", (deps.now ?? Date.now)(), env)) return json({ error: "daily model calls for this server instance are used up" }, 429);
  return null;
}

function sparkFailure(error: unknown, what: string): Response {
  if (error instanceof SparkError) return json({ error: error.message }, error.status === 503 ? 503 : 502);
  return json({ error: `${what} failed: ${error instanceof Error ? error.message : String(error)}` }, 502);
}

/** The street's name and position as the page sends them, both optional; a message when either is out of shape. */
function whereFrom(body: Record<string, unknown>): { street?: string; near?: { lat: number; lon: number } } | string {
  const street = body.street === undefined ? undefined : text(body.street, 80);
  if (body.street !== undefined && !street) return "street must be a name of 1 to 80 characters";
  if (body.near === undefined) return { street };
  const near = body.near as { lat?: unknown; lon?: unknown } | null;
  if (typeof near !== "object" || near === null || typeof near.lat !== "number" || typeof near.lon !== "number" || !(Math.abs(near.lat) <= 85) || !(Math.abs(near.lon) <= 180)) {
    return "near must be {lat, lon}";
  }
  return { street, near: { lat: near.lat, lon: near.lon } };
}

/** POST {theme, places, localTime?, street?, near?}: a quest along the street from Muse Spark Open. */
export async function handleQuest(request: Request, deps: Deps = {}): Promise<Response> {
  if (request.method !== "POST") return json({ error: "use POST" }, 405);
  const body = await jsonBody(request);
  if (!body) return json({ error: "body must be a JSON object" }, 400);
  if (!isQuestTheme(body.theme)) return json({ error: "theme must be one of the quest themes" }, 400);
  const places = placesFrom(body.places, 80);
  if (!places || places.some((p) => !p.category || !p.kind)) return json({ error: "places must be 1 to 80 distinct places with id, name, category, kind, side and distanceM" }, 400);
  const localTime = typeof body.localTime === "string" && /^(Mo|Tu|We|Th|Fr|Sa|Su) [0-2]\d:[0-5]\d$/.test(body.localTime) ? body.localTime : undefined;
  const where = whereFrom(body);
  if (typeof where === "string") return json({ error: where }, 400);
  const gate = sparkGate(deps, "picks the stops itself");
  if (gate) return gate;
  try {
    return json(await questWithSpark(places as QuestPlace[], body.theme, { localTime, ...where }, deps));
  } catch (error) {
    return sparkFailure(error, "quest");
  }
}

/** A place to pick from as the page sends it, or null when anything is out of shape. */
function pickPlaceFrom(value: unknown): PickPlace | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const name = text(v.name, 80);
  const kind = text(v.kind, 40);
  if (typeof v.id !== "string" || !ID_PATTERN.test(v.id) || !name || !kind || !isGroupKey(v.group)) return null;
  if (v.side !== "left" && v.side !== "right") return null;
  if (typeof v.distanceM !== "number" || !Number.isFinite(v.distanceM) || v.distanceM < 0 || v.distanceM > 6000) return null;
  return { id: v.id, name, kind, group: v.group, side: v.side, distanceM: Math.round(v.distanceM) };
}

/**
 * POST {places, street?, near?}: the places the show names, picked by Muse
 * Spark Open from the street's places (list numbers and a reason word only).
 * GET ?demo=<id>: the same for a demo street, looked up here, so the answer
 * stands in the CDN like the street itself for everyone who opens it.
 */
export async function handleLandmarks(request: Request, deps: Deps = {}): Promise<Response> {
  if (request.method === "GET") return demoLandmarks(new URL(request.url).searchParams.get("demo"), deps);
  if (request.method !== "POST") return json({ error: "use POST, or GET with a demo street" }, 405);
  const body = await jsonBody(request);
  if (!body) return json({ error: "body must be a JSON object" }, 400);
  const list = Array.isArray(body.places) && body.places.length > 0 && body.places.length <= PICK_MAX_PLACES ? body.places.map(pickPlaceFrom) : null;
  const places = list && list.every((p) => p !== null) ? (list as PickPlace[]) : null;
  if (!places || new Set(places.map((p) => p.id)).size !== places.length) {
    return json({ error: `places must be 1 to ${PICK_MAX_PLACES} distinct places with id, name, kind, group, side and distanceM` }, 400);
  }
  const where = whereFrom(body);
  if (typeof where === "string") return json({ error: where }, 400);
  const gate = sparkGate(deps, "names the places by the map's own ranking");
  if (gate) return gate;
  try {
    return json(await picksWithSpark(places, where, deps));
  } catch (error) {
    return sparkFailure(error, "picks");
  }
}

/** The street's own cache, for the model's picks along a demo street. */
const DEMO_PICKS_CACHE = STREET_CACHE;

async function demoLandmarks(id: string | null, deps: Deps): Promise<Response> {
  const demo = FAMOUS_STREETS.find((s) => s.id === id);
  if (!demo) return json({ error: `demo must be one of ${FAMOUS_STREETS.map((s) => s.id).join(", ")}` }, 400);
  const gate = sparkGate(deps, "names the places by the map's own ranking");
  if (gate) return gate;
  try {
    // The street the page gets for the same demo, so the ids answer for its places.
    const street = await lookupStreet({ lat: demo.lat, lon: demo.lon }, demo.headingDeg, deps, demo.street);
    const places = pickCandidates(street.shops, showReach(street.shops, street.route.length), street.name, PICK_DEMO_MAX_PLACES);
    if (places.length < PICK_MIN_PLACES) return json({ error: "the street has too few places to pick from" }, 404);
    const answer = await picksWithSpark(places, { street: street.name?.slice(0, 80), near: roughPosition(demo) }, deps);
    return json(answer, 200, { "Cache-Control": DEMO_PICKS_CACHE });
  } catch (error) {
    if (error instanceof UpstreamError) return json({ error: error.message }, error.status);
    return sparkFailure(error, "picks");
  }
}

/** POST {image, places, boxes?}: which of the mapped places Muse Spark Open can read in the photo (boxes: numbered SAM 3.1 boxes drawn on it). */
export async function handleSigns(request: Request, deps: Deps = {}): Promise<Response> {
  if (request.method !== "POST") return json({ error: "use POST" }, 405);
  const body = await jsonBody(request);
  if (!body) return json({ error: "body must be a JSON object" }, 400);
  const problem = imageError(body.image);
  if (problem) return json({ error: problem }, 400);
  const places = placesFrom(body.places, 40);
  if (!places) return json({ error: "places must be 1 to 40 distinct places with id, name, side and distanceM" }, 400);
  // How many numbered SAM 3.1 boxes the page drew on the photo; none is the plain check.
  const boxes = body.boxes ?? 0;
  if (typeof boxes !== "number" || !Number.isInteger(boxes) || boxes < 0 || boxes > MAX_SIGN_BOXES) {
    return json({ error: `boxes must be a whole number from 0 to ${MAX_SIGN_BOXES}` }, 400);
  }
  const gate = sparkGate(deps, "shows the map's labels without the check");
  if (gate) return gate;
  try {
    const spotPlaces = places.map(({ id, name, side, distanceM }) => ({ id, name, side, distanceM }));
    return json(await signsWithSpark(spotPlaces, body.image as string, deps, boxes));
  } catch (error) {
    return sparkFailure(error, "sign check");
  }
}

/** POST {image, prompt?}: every sign in the photo, found by SAM 3.1, as boxes and outlines ("sign" unless another phrase from the menu is asked for). */
export async function handleSam(request: Request, deps: Deps = {}): Promise<Response> {
  if (request.method !== "POST") return json({ error: "use POST" }, 405);
  const body = await jsonBody(request);
  if (!body) return json({ error: "body must be a JSON object" }, 400);
  const problem = imageError(body.image);
  if (problem) return json({ error: problem }, 400);
  const prompt = body.prompt === undefined ? SIGN_PROMPT : isSignPrompt(body.prompt) ? body.prompt : null;
  if (prompt === null) return json({ error: `prompt must be one of: ${SIGN_PROMPTS.join(", ")}` }, 400);
  const env = deps.env ?? process.env;
  // A switch to turn SAM off on this server without a code change; the page goes on as before.
  if (env.SAM_DISABLED === "1") return json({ error: "SAM is switched off on this server (SAM_DISABLED); the page goes on without it" }, 503);
  if (!keyPresence(env).modelApiKeyConfigured) return json({ error: "MODEL_API_KEY is not configured; the page goes on without the cut-outs" }, 503);
  if (!takeCall("sam", (deps.now ?? Date.now)(), env)) return json({ error: "daily SAM calls for this server instance are used up" }, 429);
  try {
    return json(await signsWithSam(body.image as string, deps, prompt));
  } catch (error) {
    if (error instanceof SamError) return json({ error: error.message }, error.status === 503 || error.status === 429 ? error.status : 502);
    return json({ error: `segmentation failed: ${error instanceof Error ? error.message : String(error)}` }, 502);
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
