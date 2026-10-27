/**
 * Places every "what if" item from the measured footprint and height. The
 * plan only says which items to use; positions and sizes come from here.
 * Sizes of the items themselves (planter width, pergola height and so on)
 * are design choices, not measurements.
 */
import type { EN, ENU } from "../geo/enu.js";
import { area, centroid, edges, extentAlong, insetRing, pointInRing, type Ring } from "../geo/polygon.js";
import type { DesignPlan } from "./plan.js";
import { hashString, seededRandom } from "./rng.js";

export type PlanterItem = { a: EN; b: EN; width: number; height: number; order: number };
export type ShrubItem = { p: EN; z: number; r: number; order: number };
export type TreeItem = { p: EN; scale: number; order: number };
export type PergolaItem = { center: EN; angleRad: number; length: number; depth: number; height: number };
export type BenchItem = { center: EN; angleRad: number; length: number };
export type PoleItem = { p: EN; height: number };
export type LightStrand = { points: ENU[] };
/** A climbing stem on a facade: distance along the wall (m) and height (m) at each step. */
export type VineStrand = { facade: number; points: { s: number; z: number }[] };
export type WindowBoxItem = { facade: number; s: number; z: number; length: number };
export type AwningItem = { facade: number; s0: number; s1: number; z: number; depth: number };
export type WashItem = { facade: number; s: number; width: number; height: number };

export type Layout = {
  roofZ: number;
  deck: Ring | null;
  planters: PlanterItem[];
  shrubs: ShrubItem[];
  trees: TreeItem[];
  pergola: PergolaItem | null;
  benches: BenchItem[];
  poles: PoleItem[];
  lights: LightStrand[];
  vines: VineStrand[];
  windowBoxes: WindowBoxItem[];
  awning: AwningItem | null;
  washes: WashItem[];
};

export type LayoutInput = {
  id: string;
  ring: Ring;
  heightM: number;
  floors: number;
  floorHeightM: number;
  mainFacade: number;
  plan: DesignPlan;
};

const PLANTER_WIDTH = 0.5;
const PLANTER_HEIGHT = 0.45;
const PLANTER_LENGTH = 1.6;
const POLE_HEIGHT = 2.6;
const MAX_VINE_STRANDS = 48;

function rotate(v: EN, angle: number): EN {
  return { x: v.x * Math.cos(angle) - v.y * Math.sin(angle), y: v.x * Math.sin(angle) + v.y * Math.cos(angle) };
}

/** Catenary-like sag between two points (a parabola is close enough at these spans). */
function sagLine(a: ENU, b: ENU, sag: number, steps = 14): ENU[] {
  const pts: ENU[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    pts.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t - 4 * sag * t * (1 - t),
    });
  }
  return pts;
}

function longestEdgeAngle(ring: Ring): number {
  const longest = edges(ring).reduce((a, b) => (b.length > a.length ? b : a));
  return Math.atan2(longest.dir.y, longest.dir.x);
}

function rectCorners(center: EN, angle: number, length: number, depth: number): EN[] {
  return [
    { x: -length / 2, y: -depth / 2 },
    { x: length / 2, y: -depth / 2 },
    { x: length / 2, y: depth / 2 },
    { x: -length / 2, y: depth / 2 },
  ].map((c) => {
    const r = rotate(c, angle);
    return { x: center.x + r.x, y: center.y + r.y };
  });
}

export function layoutDesign(input: LayoutInput): Layout {
  const { ring, plan } = input;
  const rnd = seededRandom(hashString(input.id));
  const roofZ = input.heightM;
  const layout: Layout = {
    roofZ,
    deck: null,
    planters: [],
    shrubs: [],
    trees: [],
    pergola: null,
    benches: [],
    poles: [],
    lights: [],
    vines: [],
    windowBoxes: [],
    awning: null,
    washes: [],
  };
  const c = centroid(ring);

  // Roof: deck, planters and shrubs.
  if (plan.roof.deck) {
    const deck = insetRing(ring, 1.1);
    if (deck && area(deck) >= 10) layout.deck = deck;
  }
  if (plan.roof.planters === "edge") {
    const line = insetRing(ring, PLANTER_WIDTH / 2 + 0.2);
    if (line) {
      for (const e of edges(line)) {
        const count = Math.floor((e.length - 0.4) / (PLANTER_LENGTH + 0.3));
        if (count < 1) continue;
        const gap = (e.length - count * PLANTER_LENGTH) / (count + 1);
        for (let k = 0; k < count; k += 1) {
          const s0 = gap + k * (PLANTER_LENGTH + gap);
          const a = { x: e.a.x + e.dir.x * s0, y: e.a.y + e.dir.y * s0 };
          const b = { x: a.x + e.dir.x * PLANTER_LENGTH, y: a.y + e.dir.y * PLANTER_LENGTH };
          layout.planters.push({ a, b, width: PLANTER_WIDTH, height: PLANTER_HEIGHT, order: 0 });
        }
      }
    }
  } else if (plan.roof.planters === "clusters") {
    const line = insetRing(ring, 1.0);
    if (line) {
      for (const v of line) {
        const toC = { x: c.x - v.x, y: c.y - v.y };
        const d = Math.hypot(toC.x, toC.y) || 1;
        const a = { x: v.x + (toC.x / d) * 0.1, y: v.y + (toC.y / d) * 0.1 };
        const b = { x: v.x + (toC.x / d) * 1.0, y: v.y + (toC.y / d) * 1.0 };
        layout.planters.push({ a, b, width: 0.9, height: PLANTER_HEIGHT, order: 0 });
      }
    }
  }
  // Grow the planters around the roof starting from the first one.
  layout.planters.forEach((p, i) => {
    p.order = layout.planters.length > 1 ? i / (layout.planters.length - 1) : 0;
  });
  for (const p of layout.planters) {
    const len = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
    const n = Math.max(2, Math.floor(len / 0.42));
    for (let k = 0; k < n; k += 1) {
      const t = (k + 0.5) / n + (rnd() - 0.5) * 0.05;
      const side = (rnd() - 0.5) * p.width * 0.4;
      const dir = { x: (p.b.x - p.a.x) / len, y: (p.b.y - p.a.y) / len };
      layout.shrubs.push({
        p: { x: p.a.x + (p.b.x - p.a.x) * t - dir.y * side, y: p.a.y + (p.b.y - p.a.y) * t + dir.x * side },
        z: roofZ + p.height,
        r: 0.2 + rnd() * 0.14,
        order: Math.min(1, p.order + rnd() * 0.15),
      });
    }
  }

  // Pergola at the middle of the roof, along the longest wall, if it fits.
  const angle = longestEdgeAngle(ring);
  const inner = insetRing(ring, 1.3);
  if (plan.roof.pergola && inner) {
    const ext = extentAlong(ring, { x: Math.cos(angle), y: Math.sin(angle) });
    let length = Math.min(4.2, 0.5 * ext.along);
    let depth = Math.min(3.0, 0.5 * ext.across);
    for (let attempt = 0; attempt < 4 && length >= 2 && depth >= 1.6; attempt += 1) {
      if (rectCorners(c, angle, length, depth).every((p) => pointInRing(p, inner))) {
        layout.pergola = { center: c, angleRad: angle, length, depth, height: 2.4 };
        break;
      }
      length *= 0.8;
      depth *= 0.8;
    }
  }
  const pergola = layout.pergola;
  const insidePergola = (p: EN, margin: number) => {
    if (!pergola) return false;
    const rel = rotate({ x: p.x - pergola.center.x, y: p.y - pergola.center.y }, -pergola.angleRad);
    return Math.abs(rel.x) < pergola.length / 2 + margin && Math.abs(rel.y) < pergola.depth / 2 + margin;
  };

  // Trees in pots towards the roof corners, then the middles of the sides.
  const treeLine = insetRing(ring, 1.7);
  if (plan.roof.trees > 0 && treeLine) {
    const spots: EN[] = [...treeLine];
    edges(treeLine).forEach((e) => {
      if (e.length > 5) spots.push({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
    });
    const free = spots.filter((p) => !insidePergola(p, 0.9));
    const step = free.length / Math.min(plan.roof.trees, free.length);
    for (let k = 0; k < Math.min(plan.roof.trees, free.length); k += 1) {
      layout.trees.push({ p: free[Math.floor(k * step)], scale: 0.85 + rnd() * 0.35, order: k / Math.max(1, plan.roof.trees) });
    }
  }

  if (plan.roof.seating) {
    const benchAngle = pergola ? pergola.angleRad : angle;
    const offset = pergola ? pergola.depth / 2 - 0.45 : 1.0;
    for (const sign of [-1, 1]) {
      const o = rotate({ x: 0, y: sign * offset }, benchAngle);
      const center = { x: c.x + o.x, y: c.y + o.y };
      if (inner && pointInRing(center, inner)) {
        layout.benches.push({ center, angleRad: benchAngle, length: pergola ? Math.min(2.2, pergola.length * 0.6) : 1.8 });
      }
    }
  }

  // String lights: across the pergola and out to poles, or a loop of poles.
  if (plan.roof.stringLights) {
    const poleLine = insetRing(ring, 0.9);
    if (pergola) {
      const corners = rectCorners(pergola.center, pergola.angleRad, pergola.length, pergola.depth);
      const top = roofZ + pergola.height;
      for (let k = 0; k <= 3; k += 1) {
        const t = (k + 0.5) / 4;
        const a = { x: corners[0].x + (corners[1].x - corners[0].x) * t, y: corners[0].y + (corners[1].y - corners[0].y) * t, z: top };
        const b = { x: corners[3].x + (corners[2].x - corners[3].x) * t, y: corners[3].y + (corners[2].y - corners[3].y) * t, z: top };
        layout.lights.push({ points: sagLine(a, b, 0.22) });
      }
      if (poleLine) {
        for (const corner of corners) {
          let nearest = poleLine[0];
          for (const v of poleLine) if (Math.hypot(v.x - corner.x, v.y - corner.y) < Math.hypot(nearest.x - corner.x, nearest.y - corner.y)) nearest = v;
          const span = Math.hypot(nearest.x - corner.x, nearest.y - corner.y);
          if (span < 1 || span > 9) continue;
          layout.poles.push({ p: nearest, height: POLE_HEIGHT });
          layout.lights.push({
            points: sagLine({ x: corner.x, y: corner.y, z: top }, { x: nearest.x, y: nearest.y, z: roofZ + POLE_HEIGHT }, 0.3),
          });
        }
      }
    } else if (poleLine) {
      poleLine.forEach((v) => layout.poles.push({ p: v, height: POLE_HEIGHT }));
      poleLine.forEach((v, i) => {
        const w = poleLine[(i + 1) % poleLine.length];
        const span = Math.hypot(w.x - v.x, w.y - v.y);
        if (span > 14) return;
        layout.lights.push({
          points: sagLine({ x: v.x, y: v.y, z: roofZ + POLE_HEIGHT }, { x: w.x, y: w.y, z: roofZ + POLE_HEIGHT }, 0.06 * span),
        });
      });
    }
  }

  // Facades: climbing stems at the corners or across the walls.
  const es = edges(ring);
  if (plan.facade.vines !== "none") {
    const starts: { facade: number; s: number }[] = [];
    es.forEach((e, i) => {
      if (e.length < 2) return;
      if (plan.facade.vines === "corners") {
        for (let k = 0; k < 3; k += 1) {
          starts.push({ facade: i, s: 0.15 + k * 0.35 + rnd() * 0.1 });
          starts.push({ facade: i, s: e.length - 0.15 - k * 0.35 - rnd() * 0.1 });
        }
      } else {
        const n = Math.max(2, Math.floor(e.length / 0.9));
        for (let k = 0; k < n; k += 1) starts.push({ facade: i, s: ((k + 0.5) / n) * e.length });
      }
    });
    const keep = starts.length > MAX_VINE_STRANDS ? MAX_VINE_STRANDS / starts.length : 1;
    for (const start of starts) {
      if (keep < 1 && rnd() > keep) continue;
      const length = es[start.facade].length;
      const topFrac = plan.facade.vines === "corners" ? 0.45 + rnd() * 0.4 : 0.3 + rnd() * 0.6;
      const top = Math.min(input.heightM - 0.3, topFrac * input.heightM);
      const points: { s: number; z: number }[] = [];
      let s = start.s;
      for (let z = 0; z <= top; z += 0.25) {
        s = Math.min(length - 0.05, Math.max(0.05, s + (rnd() - 0.5) * 0.16));
        points.push({ s, z });
      }
      if (points.length > 1) layout.vines.push({ facade: start.facade, points });
    }
  }

  // Window boxes on the main facade, from the second floor up.
  const main = es[input.mainFacade];
  if (plan.facade.windowBoxes && main) {
    for (let floor = 2; floor <= Math.min(input.floors, 12); floor += 1) {
      for (let s = 1.6; s <= main.length - 1.6; s += 3.0) {
        layout.windowBoxes.push({ facade: input.mainFacade, s, z: (floor - 1) * input.floorHeightM + 0.9, length: 1.1 });
      }
    }
  }
  if (plan.facade.awning && main && main.length >= 4) {
    layout.awning = {
      facade: input.mainFacade,
      s0: main.length * 0.18,
      s1: main.length * 0.82,
      z: Math.min(3.1, input.floorHeightM * 0.9),
      depth: 1.1,
    };
  }
  if (plan.facade.washLights) {
    es.forEach((e, i) => {
      if (e.length < 3) return;
      const n = Math.max(1, Math.round(e.length / 4.5));
      for (let k = 0; k < n; k += 1) {
        layout.washes.push({ facade: i, s: ((k + 0.5) / n) * e.length, width: Math.min(3.2, e.length / n), height: Math.min(9, 0.6 * input.heightM) });
      }
    });
  }
  return layout;
}
