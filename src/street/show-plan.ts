/**
 * The street show without the page: the kinds of place the chips tour and
 * their colours on black, which places are the street's landmarks, how the
 * light runs down the street (slowing at each landmark), and where the
 * camera looks. Pure functions, so they are tested without a browser.
 */
import { bearingDeg, type EN } from "../geo/enu.js";
import type { ShopAhead } from "./ahead.js";
import type { ShopCategory } from "./osm.js";
import { pointAt, type Route } from "./route.js";

// ----- Kinds of place -----

export type GroupKey = "food" | "cafe" | "bar" | "shop" | "beauty" | "fun" | "stay" | "services";

/** A chip: its label, what its places are called when counted ("12 cafés"), its categories and colour. */
export type Group = { key: GroupKey; label: string; noun: string; categories: readonly ShopCategory[]; color: string };

/** The chips, in order. Colours that read on black and apart from one another. */
export const GROUPS: readonly Group[] = [
  { key: "food", label: "Restaurants", noun: "restaurants", categories: ["food"], color: "#ff6b57" },
  { key: "cafe", label: "Cafés", noun: "cafés", categories: ["cafe"], color: "#ffc53d" },
  { key: "bar", label: "Bars", noun: "bars", categories: ["bar"], color: "#b388ff" },
  { key: "shop", label: "Shops", noun: "shops", categories: ["fashion", "shop", "grocery"], color: "#38d9ff" },
  { key: "beauty", label: "Beauty", noun: "beauty spots", categories: ["beauty"], color: "#ff74c8" },
  { key: "fun", label: "Entertainment", noun: "things to do", categories: ["fun"], color: "#8dff6a" },
  { key: "stay", label: "Hotels", noun: "hotels", categories: ["stay"], color: "#7f95ff" },
  { key: "services", label: "Services", noun: "services", categories: ["health", "money"], color: "#a7b4c2" },
];

/** The light when it shows every kind of place. */
export const LIGHT = "#7fe3ff";
/** Quest stops. */
export const QUEST_GOLD = "#ffd54a";

const GROUP_OF = new Map<ShopCategory, Group>(GROUPS.flatMap((g) => g.categories.map((c) => [c, g] as const)));

export function groupOf(category: ShopCategory): Group {
  return GROUP_OF.get(category) ?? GROUPS[3];
}

/** "category=jewelry_store" → "jewelry store"; "amenity=cafe" → "cafe". */
export function kindWord(kind: string): string {
  return kind.slice(kind.indexOf("=") + 1).replace(/_/g, " ");
}

// ----- Landmarks -----

/** Kinds of place a visitor names as a sight, and how strongly. */
const SIGHTS: [RegExp, number][] = [
  [/museum|aquarium|planetarium|zoo|landmark|monument|historic|castle|palace|observation/, 1],
  [/department_store|shopping_mall|shopping_center|mall$/, 0.85],
  [/theat(er|re)|opera|concert|performing_arts|stadium|arena|cinema/, 0.65],
  [/hotel|resort/, 0.55],
  [/gallery|music_venue|bookstore|books$/, 0.3],
];
/** A sight that says what it is in its name ("… Museum of Art", "…미술관") is more likely the real thing. */
const SIGHT_NAME = /museum|gallery|theat(er|re)|cinema|opera|concert hall|cathedral|palace|박물관|미술관|갤러리|극장|공연장|아트홀|아트센터|시네마/i;
/** Everyday kinds a street is rarely known for. */
const EVERYDAY = /coffee|cafe|fast_food|convenience|bank|atm|pharmacy|dent|clinic|doctor|optometr|vision|orthodont|hair|nail|laundry|mobile_phone|vape|smoke/;
const FLAGSHIP = /flagship|brand cent(er|re)|본점|플래그십|직영점/i;
const BUDGET_STAY = /guest ?house|hostel|motel|게스트하우스|모텔/i;

const normal = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const brandKey = normal;

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const STREET_WORDS = /^(street|st|avenue|ave|road|rd|boulevard|blvd|way|lane|drive|dr|place|pl)\.?$/i;

/**
 * What a place would carry in its name to be named after the street:
 * "Robson" for Robson Street, "5th" or "fifth" for 5th Avenue, the whole
 * name for 강남대로 (its first part is the whole district's).
 */
export function streetCores(streetName: string | undefined): string[] {
  if (!streetName) return [];
  const words = streetName.trim().split(/\s+/);
  const core = words.length > 1 && STREET_WORDS.test(words[words.length - 1]) ? words.slice(0, -1).join(" ") : streetName;
  const out = [normal(core)];
  const ordinal = /^(\d+)(st|nd|rd|th)$/i.exec(core);
  if (ordinal && Number(ordinal[1]) <= ORDINALS.length) out.push(ORDINALS[Number(ordinal[1]) - 1]);
  return out.filter((c) => c.length >= 2);
}

/** How many places on the street carry each brand: a brand seen once is a flagship more often than a chain. */
export function brandCounts(shops: readonly ShopAhead[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const shop of shops) if (shop.brand) counts.set(brandKey(shop.brand), (counts.get(brandKey(shop.brand)) ?? 0) + 1);
  return counts;
}

/**
 * How likely a place is one the street is known for, from what the map
 * says about it: a sight by its kind (museums, department stores, theatres,
 * hotels) or a brand found once on the street (more so with "flagship" or
 * the street's own name in its name), then the source's confidence and its
 * links. A ranking for the show, not a fact about the place.
 */
export function fameScore(shop: ShopAhead, brands: ReadonlyMap<string, number>, cores: readonly string[] = []): number {
  const kind = shop.kind.slice(shop.kind.indexOf("=") + 1);
  let sight = 0;
  for (const [pattern, weight] of SIGHTS) if (pattern.test(kind)) sight = Math.max(sight, weight);
  if (sight > 0 && SIGHT_NAME.test(shop.name)) sight += 0.15;
  let brand = 0;
  if (shop.brand) {
    const n = brands.get(brandKey(shop.brand)) ?? 1;
    brand = n === 1 ? 0.5 : n <= 3 ? 0.15 : 0;
    // A chain restaurant or café is rarely what a street is known for, even its only branch here.
    if (shop.category === "food" || shop.category === "cafe" || shop.category === "bar") brand /= 2;
  }
  let score = Math.max(sight, brand);
  if (FLAGSHIP.test(shop.name)) score += 0.15;
  const name = normal(shop.name);
  if (score > 0 && cores.some((core) => name.includes(core))) score += 0.2;
  if (BUDGET_STAY.test(shop.name)) score -= 0.4;
  if (EVERYDAY.test(kind)) score -= 0.5;
  if (shop.category === "health" || shop.category === "money") score -= 0.5;
  // "608 Fifth Avenue": a building's address rather than a place's name.
  if (/\d{3,}/.test(shop.name)) score -= 0.4;
  score += Math.max(0, (shop.confidence ?? 0.7) - 0.5) * 0.3;
  score += (shop.facebook ? 0.05 : 0) + (shop.website ? 0.05 : 0) + (shop.instagram ? 0.03 : 0);
  return score;
}

/** One landmark per 600 m or so: three to eight. */
export function landmarkCount(lengthM: number): number {
  return Math.max(3, Math.min(8, Math.round(lengthM / 600)));
}

/** Below this a place is a landmark only to make up the first three. */
export const MIN_FAME = 0.6;
/** Places the light stops at are at least this far apart. */
export const MIN_GAP_M = 150;

/**
 * The places the light stops at: the highest scores first, each at least
 * half the average spacing from those already picked, until there are
 * `max` or the scores fall under `minScore` (but at least `keepAtLeast`).
 * In order along the street.
 */
export function pickPlaces(shops: readonly ShopAhead[], lengthM: number, max: number, options: { minScore?: number; keepAtLeast?: number; streetName?: string } = {}): ShopAhead[] {
  if (max <= 0) return [];
  const brands = brandCounts(shops);
  const cores = streetCores(options.streetName);
  const gap = Math.max(MIN_GAP_M, (Math.max(1, lengthM) / max) * 0.5);
  const ranked = shops
    .filter((x) => x.s >= -10 && x.s <= lengthM)
    .map((shop) => ({ shop, score: fameScore(shop, brands, cores) }))
    .sort((a, b) => b.score - a.score || a.shop.s - b.shop.s);
  const picked: ShopAhead[] = [];
  for (const { shop, score } of ranked) {
    if (picked.length >= max) break;
    if (score < (options.minScore ?? -Infinity) && picked.length >= (options.keepAtLeast ?? 0)) break;
    if (picked.some((p) => Math.abs(p.s - shop.s) < gap)) continue;
    picked.push(shop);
  }
  return picked.sort((a, b) => a.s - b.s);
}

export function pickLandmarks(shops: readonly ShopAhead[], lengthM: number, streetName?: string): ShopAhead[] {
  return pickPlaces(shops, lengthM, landmarkCount(lengthM), { minScore: MIN_FAME, keepAtLeast: 3, streetName });
}

/** The places a chip's tour names: the best of that kind along the street. */
export function pickGroup(shops: readonly ShopAhead[], group: Group, lengthM: number, streetName?: string, max = 6): ShopAhead[] {
  return pickPlaces(
    shops.filter((s) => group.categories.includes(s.category)),
    lengthM,
    max,
    { streetName },
  );
}

// ----- The light -----

export type LightRun = {
  from: number;
  to: number;
  /** Seconds. */
  duration: number;
  /** Where the light is, metres along, t seconds after it starts. */
  at(t: number): number;
  /** When the light passes s, seconds after it starts. */
  when(s: number): number;
};

export type RunPace = {
  /** Seconds per kilometre between stops. */
  secondsPerKm: number;
  /** The shortest run between stops, seconds. */
  minTravel: number;
  /** Seconds the light lingers at each stop. */
  dwell: number;
  /** Seconds added to set off and to arrive, each. */
  ease: number;
};

export const REVEAL_PACE: RunPace = { secondsPerKm: 0.75, minTravel: 2.2, dwell: 0.78, ease: 0.45 };
export const TOUR_PACE: RunPace = { secondsPerKm: 0.65, minTravel: 1.8, dwell: 0.6, ease: 0.35 };

const STOP_WIDTH_M = 45;
const SQRT_PI = Math.sqrt(Math.PI);

/**
 * A run of light from `from` to `to` that slows down at each stop. Time per
 * metre is flat between stops with a Gaussian bump at each one, sized so
 * that each stop adds `dwell` seconds, and half-bumps at both ends to set
 * off and arrive gently.
 */
export function lightRun(from: number, to: number, stops: readonly number[], pace: RunPace): LightRun {
  const span = Math.max(1, to - from);
  const travel = Math.max(pace.minTravel, (span / 1000) * pace.secondsPerKm);
  const perM = travel / span;
  const bump = (pace.dwell / perM) / (STOP_WIDTH_M * SQRT_PI);
  const endWidth = Math.max(60, span * 0.06);
  // Half of an end bump lies outside the run, so it is twice as tall.
  const endBump = (2 * pace.ease / perM) / (endWidth * SQRT_PI);
  const inside = stops.filter((s) => s > from && s < from + span);
  const density = (s: number) => {
    let k = 1;
    for (const stop of inside) k += bump * Math.exp(-(((s - stop) / STOP_WIDTH_M) ** 2));
    k += endBump * (Math.exp(-(((s - from) / endWidth) ** 2)) + Math.exp(-(((s - from - span) / endWidth) ** 2)));
    return k * perM;
  };
  const n = Math.min(4000, Math.max(200, Math.ceil(span / 4)));
  const ds = span / n;
  const t = new Float64Array(n + 1);
  let prev = density(from);
  for (let i = 1; i <= n; i += 1) {
    const next = density(from + i * ds);
    t[i] = t[i - 1] + ((prev + next) / 2) * ds;
    prev = next;
  }
  const duration = t[n];
  return {
    from,
    to: from + span,
    duration,
    at(time: number) {
      if (time <= 0) return from;
      if (time >= duration) return from + span;
      let lo = 0;
      let hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (t[mid] <= time) lo = mid;
        else hi = mid;
      }
      return from + (lo + (time - t[lo]) / (t[hi] - t[lo] || 1)) * ds;
    },
    when(s: number) {
      const x = Math.min(n, Math.max(0, (s - from) / ds));
      const i = Math.min(n - 1, Math.floor(x));
      return t[i] + (t[i + 1] - t[i]) * (x - i);
    },
  };
}

// ----- The camera -----

/** Where the camera looks: a point on the ground, the compass direction, how far down, from how far. */
export type Pose = { x: number; y: number; yawDeg: number; pitchDeg: number; distance: number };
/** The screen, CSS pixels, and the vertical field of view; `centerX` moves the picture's centre off the middle (default: the middle). */
export type View = { width: number; height: number; fovDeg: number; centerX?: number };
export type Projected = { x: number; y: number; depth: number; pxPerM: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

const rad = (deg: number) => (deg * Math.PI) / 180;

function axes(pose: Pose) {
  const sy = Math.sin(rad(pose.yawDeg));
  const cy = Math.cos(rad(pose.yawDeg));
  const sp = Math.sin(rad(pose.pitchDeg));
  const cp = Math.cos(rad(pose.pitchDeg));
  return {
    forward: { x: sy * cp, y: cy * cp, z: -sp },
    right: { x: cy, y: -sy, z: 0 },
    up: { x: sy * sp, y: cy * sp, z: cp },
    eye: { x: pose.x - sy * cp * pose.distance, y: pose.y - cy * cp * pose.distance, z: sp * pose.distance },
  };
}

export function focalPx(view: View): number {
  return view.height / 2 / Math.tan(rad(view.fovDeg) / 2);
}

/** A point (z metres above the ground) on the screen; null when it is behind the camera. */
export function project(pose: Pose, view: View, p: EN, z = 0): Projected | null {
  const a = axes(pose);
  const v = { x: p.x - a.eye.x, y: p.y - a.eye.y, z: z - a.eye.z };
  const depth = v.x * a.forward.x + v.y * a.forward.y + v.z * a.forward.z;
  if (depth < 1) return null;
  const f = focalPx(view);
  const pxPerM = f / depth;
  return {
    x: (view.centerX ?? view.width / 2) + (v.x * a.right.x + v.y * a.right.y) * pxPerM,
    y: view.height / 2 - (v.x * a.up.x + v.y * a.up.y + v.z * a.up.z) * pxPerM,
    depth,
    pxPerM,
  };
}

/** A projector for one frame: the camera's axes worked out once. */
export function projector(pose: Pose, view: View): (p: EN, z?: number) => Projected | null {
  const a = axes(pose);
  const f = focalPx(view);
  return (p, z = 0) => {
    const vx = p.x - a.eye.x;
    const vy = p.y - a.eye.y;
    const vz = z - a.eye.z;
    const depth = vx * a.forward.x + vy * a.forward.y + vz * a.forward.z;
    if (depth < 1) return null;
    const pxPerM = f / depth;
    return {
      x: (view.centerX ?? view.width / 2) + (vx * a.right.x + vy * a.right.y) * pxPerM,
      y: view.height / 2 - (vx * a.up.x + vy * a.up.y + vz * a.up.z) * pxPerM,
      depth,
      pxPerM,
    };
  };
}

// ----- Exploring: the visitor's own camera -----

/** The point on the ground under a point on the screen; null at or above the horizon. */
export function groundAt(pose: Pose, view: View, sx: number, sy: number): EN | null {
  const a = axes(pose);
  const f = focalPx(view);
  const u = (sx - (view.centerX ?? view.width / 2)) / f;
  const w = (view.height / 2 - sy) / f;
  // The ray from the eye through the point.
  const dx = a.forward.x + a.right.x * u + a.up.x * w;
  const dy = a.forward.y + a.right.y * u + a.up.y * w;
  const dz = a.forward.z + a.right.z * u + a.up.z * w;
  if (dz > -1e-3) return null;
  const t = -a.eye.z / dz;
  return { x: a.eye.x + dx * t, y: a.eye.y + dy * t };
}

/** The camera slid over the ground so that `anchor` lies under the screen point (sx, sy): what a finger dragging the ground does. */
export function poseKeeping(pose: Pose, view: View, anchor: EN, sx: number, sy: number): Pose | null {
  const g = groundAt(pose, view, sx, sy);
  if (!g) return null;
  return { ...pose, x: pose.x + anchor.x - g.x, y: pose.y + anchor.y - g.y };
}

/** How close the visitor's camera may come, how far it may go, and the ground its centre stays over. */
export type ExploreLimits = { minDistance: number; maxDistance: number; box: { minX: number; maxX: number; minY: number; maxY: number } };

export function clampPose(pose: Pose, limits: ExploreLimits): Pose {
  return {
    ...pose,
    distance: Math.min(limits.maxDistance, Math.max(limits.minDistance, pose.distance)),
    x: Math.min(limits.box.maxX, Math.max(limits.box.minX, pose.x)),
    y: Math.min(limits.box.maxY, Math.max(limits.box.minY, pose.y)),
  };
}

/** Closer by `factor` (under 1: farther) about the screen point (sx, sy), which keeps the ground under it. */
export function zoomAbout(pose: Pose, view: View, factor: number, sx: number, sy: number, limits: ExploreLimits): Pose {
  const anchor = groundAt(pose, view, sx, sy);
  const closer = clampPose({ ...pose, distance: pose.distance / factor }, limits);
  if (!anchor) return closer;
  return clampPose(poseKeeping(closer, view, anchor, sx, sy) ?? closer, limits);
}

/** Screen pixels per metre of ground at the middle of the picture. */
export function groundScale(pose: Pose, view: View): number {
  return focalPx(view) / pose.distance;
}

export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Past 1 and back: a pop that overshoots by about a tenth. */
export function easeOutBack(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/** How long a place's arrival rings out, milliseconds. */
export const IMPACT_MS = 900;

/** The camera's punch when the light reaches a landmark: in fast (140 ms), out slowly; 0 outside 0–700 ms. */
export function impactPunch(ageMs: number): number {
  if (ageMs <= 0 || ageMs >= 700) return 0;
  if (ageMs < 140) return 1 - (1 - ageMs / 140) ** 2;
  return 1 - easeInOut((ageMs - 140) / 560);
}

/** Between two poses: the shorter way round, distance on a log scale so a zoom feels even. */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const k = Math.min(1, Math.max(0, t));
  const turn = ((((b.yawDeg - a.yawDeg) % 360) + 540) % 360) - 180;
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    yawDeg: a.yawDeg + turn * k,
    pitchDeg: a.pitchDeg + (b.pitchDeg - a.pitchDeg) * k,
    distance: Math.exp(Math.log(a.distance) + (Math.log(b.distance) - Math.log(a.distance)) * k),
  };
}

/** Straight down on where the camera stands, the direction it faced at the top of the screen. */
export function radarPose(headingDeg: number): Pose {
  return { x: 0, y: 0, yawDeg: headingDeg, pitchDeg: 90, distance: 560 };
}

export type Follow = { ahead: number; distance: number; pitchDeg: number };
export const FOLLOW: Follow = { ahead: 150, distance: 900, pitchDeg: 38 };
export const TOUR_FOLLOW: Follow = { ahead: 180, distance: 1050, pitchDeg: 40 };
/**
 * The signs' flight from the photo to the street, in milliseconds: the
 * camera glides in over where you stood, then one sign after another lifts
 * out of the photo and lands on its place, then the photo goes and the
 * camera goes back.
 */
export const FLIGHT = { glideMs: 700, firstMs: 1000, stepMs: 450, flyMs: 750, holdMs: 1100, outMs: 800 };

export function flightLength(n: number): number {
  return FLIGHT.firstMs + Math.max(0, n - 1) * FLIGHT.stepMs + FLIGHT.flyMs + FLIGHT.holdMs + FLIGHT.outMs;
}

/** How far sign i is on its way, `t` ms into the flight: 0 still in the photo, 1 on the street. */
export function flightProgress(i: number, t: number): number {
  return Math.min(1, Math.max(0, (t - FLIGHT.firstMs - i * FLIGHT.stepMs) / FLIGHT.flyMs));
}

/** A point on the flight's arc: eased along the straight line, lifted in the middle. */
export function arcPoint(from: { x: number; y: number }, to: { x: number; y: number }, k: number, lift: number): { x: number; y: number } {
  const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - Math.sin(Math.PI * k) * lift };
}

/** Walking the street: closer in, so the places around you have room for their names. */
export const WALK_FOLLOW: Follow = { ahead: 110, distance: 520, pitchDeg: 44 };

/**
 * Where the camera is along the street while the light runs: behind it,
 * catching up with a lag of `lagS` seconds (exponential smoothing), so the
 * light shoots ahead up the screen between stops and the camera settles on
 * it at each stop. A function of seconds since the light set off.
 */
export function chaseTrack(light: LightRun, lagS = 0.45, hz = 60): (t: number) => number {
  const dt = 1 / hz;
  const n = Math.ceil((light.duration + 4 * lagS) * hz) + 1;
  const track = new Float64Array(n);
  const k = 1 - Math.exp(-dt / lagS);
  track[0] = light.from;
  for (let i = 1; i < n; i += 1) track[i] = track[i - 1] + (light.at(i * dt) - track[i - 1]) * k;
  return (t: number) => {
    if (t <= 0) return light.from;
    const x = t * hz;
    const i = Math.floor(x);
    if (i >= n - 1) return track[n - 1] + (light.to - track[n - 1]) * (1 - Math.exp(-(t - (n - 1) * dt) / lagS));
    return track[i] + (track[i + 1] - track[i]) * (x - i);
  };
}

/** Behind and above the light, looking down the street; the direction is the street's over 400 m, so bends turn the view gently. */
export function followPose(route: Route, s: number, follow: Follow = FOLLOW): Pose {
  const back = pointAt(route, s - 150).at;
  const fore = pointAt(route, s + 250).at;
  const target = pointAt(route, s + follow.ahead).at;
  const yaw = Math.hypot(fore.x - back.x, fore.y - back.y) > 1 ? bearingDeg(back, fore) : pointAt(route, s).headingDeg;
  return { x: target.x, y: target.y, yawDeg: yaw, pitchDeg: follow.pitchDeg, distance: follow.distance };
}

/** The street's main direction: its principal axis, pointing from start to end. */
export function mainBearing(points: readonly EN[]): number {
  const n = points.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x / n;
    my += p.y / n;
  }
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const span = { x: points[n - 1].x - points[0].x, y: points[n - 1].y - points[0].y };
  if (axis.x * span.x + axis.y * span.y < 0) axis = { x: -axis.x, y: -axis.y };
  return bearingDeg({ x: 0, y: 0 }, axis);
}

function bounds(project: (p: EN) => Projected | null, points: readonly EN[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const q = project(p);
    if (!q) return null;
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y);
    maxY = Math.max(maxY, q.y);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * The whole street at a glance: looking along its main direction from above
 * at `pitchDeg`, as close as it can be with every point inside the screen
 * less the insets, and centred there.
 */
export function overviewPose(points: readonly EN[], view: View, insets: Insets, pitchDeg = 52): Pose {
  const yaw = mainBearing(points);
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x / points.length;
    y += p.y / points.length;
  }
  const pose: Pose = { x, y, yawDeg: yaw, pitchDeg, distance: 1000 };
  const left = insets.left;
  const right = view.width - insets.right;
  const top = insets.top;
  const bottom = view.height - insets.bottom;
  const fits = (d: number) => {
    const b = bounds(projector({ ...pose, distance: d }, view), points);
    return b !== null && b.minX >= left && b.maxX <= right && b.minY >= top && b.maxY <= bottom;
  };
  const a = axes(pose);
  const ground = Math.sin(rad(pitchDeg));
  for (let round = 0; round < 6; round += 1) {
    let lo = 30;
    let hi = 200_000;
    for (let i = 0; i < 40; i += 1) {
      const mid = Math.sqrt(lo * hi);
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    pose.distance = hi;
    const b = bounds(projector(pose, view), points);
    if (!b) break;
    const dx = (b.minX + b.maxX) / 2 - (left + right) / 2;
    const dy = (b.minY + b.maxY) / 2 - (top + bottom) / 2;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
    const mPerPx = pose.distance / focalPx(view);
    // Right on the screen is right on the ground; down on the screen is towards the camera, stretched by the pitch.
    pose.x += a.right.x * dx * mPerPx - (Math.sin(rad(yaw)) * dy * mPerPx) / ground;
    pose.y += a.right.y * dx * mPerPx - (Math.cos(rad(yaw)) * dy * mPerPx) / ground;
  }
  return pose;
}

// ----- Where places stand in the picture -----

/** How far beside the street's line a place's dot stands: its mapped offset, kept between 8 and 24 m so dots neither sit on the line nor stray. */
export function dotOffset(shop: ShopAhead): number {
  const off = Math.min(24, Math.max(8, Math.abs(shop.offset)));
  return shop.side === "right" ? off : -off;
}

/** A place's dot on the ground, beside the street on its side. */
export function dotSpot(route: Route, shop: ShopAhead): EN {
  const { at, headingDeg } = pointAt(route, shop.s);
  const h = rad(headingDeg);
  const off = dotOffset(shop);
  return { x: at.x + Math.cos(h) * off, y: at.y - Math.sin(h) * off };
}

/**
 * The side of the screen a place's tag belongs on: the street's left, as
 * you go along it, is the screen's left while the street runs up the
 * screen, and its right where the street turns back down. Where the street
 * runs straight across the screen, the place's own side.
 */
export function screenSide(project: (p: EN) => Projected | null, route: Route, shop: { s: number; side: "left" | "right" }): "left" | "right" {
  const a = project(pointAt(route, shop.s - 15).at);
  const b = project(pointAt(route, shop.s + 15).at);
  if (!a || !b) return shop.side;
  // Left of the direction of travel on the screen (y grows downward): (dy, -dx).
  const leftX = b.y - a.y;
  if (Math.abs(leftX) < 0.05 * Math.hypot(b.x - a.x, b.y - a.y)) return shop.side;
  const leftIsScreenLeft = leftX < 0;
  return (shop.side === "left") === leftIsScreenLeft ? "left" : "right";
}

/** The street every `stepM` metres from its start to its end, with the distance along at each point. */
export function sampleRoute(route: Route, stepM = 12): { points: EN[]; along: number[] } {
  const from = route.along[0];
  const to = route.along[route.along.length - 1];
  const points: EN[] = [];
  const along: number[] = [];
  for (let s = from; s < to; s += stepM) {
    points.push(pointAt(route, s).at);
    along.push(s);
  }
  points.push(pointAt(route, to).at);
  along.push(to);
  return { points, along };
}

/** Places per bin along the street, for the rail's bars. */
export function histogram(shops: readonly { s: number }[], lengthM: number, bins: number): number[] {
  const out = new Array<number>(bins).fill(0);
  for (const shop of shops) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((shop.s / Math.max(1, lengthM)) * bins)));
    out[i] += 1;
  }
  return out;
}
