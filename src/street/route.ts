/**
 * The street ahead, in local east-north metres around the camera (which
 * stands at the origin). The camera is matched to the street it looks along;
 * the route then follows that street forward through its junctions, by the
 * nodes the ways share: the same name first, otherwise the straightest way
 * on, until the length runs out or the street ends.
 */
import { bearingDeg, wrapDeg, type EN } from "../geo/enu.js";

export type LocalWay = {
  id: string;
  name?: string;
  ref?: string;
  highway: string;
  nodes?: number[];
  points: EN[];
};

export type Route = {
  name?: string;
  points: EN[];
  /** Distance along the route at each point, metres; 0 is level with the camera, so the first point can be negative. */
  along: number[];
  /** Distance from the camera to the end of the route. */
  length: number;
  wayIds: string[];
};

export type StreetMatch = { way: number; segment: number; t: number; forward: boolean; distanceM: number; angleDeg: number };

/**
 * How far the street may be from the camera, and how far off its direction
 * the camera may point. Between tall buildings a GPS fix is often 50 to 100 m
 * off, so when no street is that near the search widens.
 */
export const MATCH_RADIUS_M = 45;
export const MATCH_WIDE_RADIUS_M = 120;
export const MATCH_ANGLE_DEG = 40;
/** The route starts a little behind the camera, so shops right beside it are on it. */
export const BEHIND_M = 20;

const RANK: Record<string, number> = {
  trunk: 0,
  primary: 0,
  secondary: 0.05,
  pedestrian: 0.05,
  tertiary: 0.1,
  living_street: 0.2,
  residential: 0.2,
  unclassified: 0.2,
  service: 0.5,
};

const sub = (a: EN, b: EN): EN => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: EN): number => Math.hypot(v.x, v.y);
const lerp = (a: EN, b: EN, t: number): EN => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Names compared without case, spaces or punctuation. */
export function sameName(a: string | undefined, b: string): boolean {
  const n = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return a !== undefined && n(a) === n(b) && n(b).length > 0;
}

/**
 * The street the camera stands beside and looks along, or null when none is
 * near enough. With a name (a starting point picked from a list), a street
 * of that name within the wider radius comes first.
 */
export function matchStreet(ways: LocalWay[], headingDeg: number, nameHint?: string): StreetMatch | null {
  if (nameHint) {
    const named = bestMatch(ways, headingDeg, MATCH_WIDE_RADIUS_M, (w) => sameName(w.name, nameHint) || sameName(w.ref, nameHint));
    if (named) return named;
  }
  return bestMatch(ways, headingDeg, MATCH_RADIUS_M) ?? bestMatch(ways, headingDeg, MATCH_WIDE_RADIUS_M);
}

function bestMatch(ways: LocalWay[], headingDeg: number, radiusM: number, keep: (way: LocalWay) => boolean = () => true): StreetMatch | null {
  let best: (StreetMatch & { score: number }) | null = null;
  for (let wi = 0; wi < ways.length; wi += 1) {
    const way = ways[wi];
    if (!keep(way)) continue;
    for (let si = 0; si + 1 < way.points.length; si += 1) {
      const a = way.points[si];
      const b = way.points[si + 1];
      const v = sub(b, a);
      const l2 = v.x * v.x + v.y * v.y;
      if (l2 < 1e-6) continue;
      const t = Math.min(1, Math.max(0, -(a.x * v.x + a.y * v.y) / l2));
      const d = len(lerp(a, b, t));
      if (d > radiusM) continue;
      const delta = Math.abs(wrapDeg(bearingDeg(a, b) - headingDeg));
      const forward = delta <= 90;
      const angle = forward ? delta : 180 - delta;
      if (angle > MATCH_ANGLE_DEG) continue;
      const score = d / radiusM + angle / MATCH_ANGLE_DEG + (RANK[way.highway] ?? 0.3) + (way.name ? 0 : 0.3);
      if (!best || score < best.score) best = { way: wi, segment: si, t, forward, distanceM: d, angleDeg: angle, score };
    }
  }
  if (!best) return null;
  const { score: _score, ...match } = best;
  return match;
}

function sameNode(a: LocalWay, i: number, b: LocalWay, j: number): boolean {
  if (a.nodes && b.nodes) return a.nodes[i] === b.nodes[j];
  return len(sub(a.points[i], b.points[j])) < 1.0;
}

/** Points of a way walked from vertex `from` in one direction, to its end. */
function walk(way: LocalWay, from: number, forward: boolean): EN[] {
  const out: EN[] = [];
  for (let i = from; forward ? i < way.points.length : i >= 0; i += forward ? 1 : -1) out.push(way.points[i]);
  return out;
}

/** Appends points to a polyline until it reaches `limit` metres; returns whether the limit was reached. */
function extend(points: EN[], total: { m: number }, more: EN[], limit: number): boolean {
  for (const p of more) {
    const last = points[points.length - 1];
    const step = len(sub(p, last));
    if (step < 1e-6) continue;
    if (total.m + step >= limit) {
      points.push(lerp(last, p, (limit - total.m) / step));
      total.m = limit;
      return true;
    }
    points.push(p);
    total.m += step;
  }
  return false;
}

export function followRoute(ways: LocalWay[], match: StreetMatch, maxLengthM = 5000): Route {
  const first = ways[match.way];
  const start = lerp(first.points[match.segment], first.points[match.segment + 1], match.t);

  // A short way back, on the same way only.
  const back: EN[] = [start];
  const backTotal = { m: 0 };
  extend(back, backTotal, walk(first, match.forward ? match.segment : match.segment + 1, !match.forward), BEHIND_M);
  back.reverse();

  const points: EN[] = [...back];
  const total = { m: 0 };
  const wayIds = [first.id];
  const visited = new Set([first.id]);
  let way = first;
  let endIndex = match.forward ? way.points.length - 1 : 0;
  let done = extend(points, total, walk(way, match.forward ? match.segment + 1 : match.segment, match.forward), maxLengthM);

  while (!done) {
    const end = way.points[endIndex];
    const prev = points[points.length - 2] ?? back[0];
    const inBearing = bearingDeg(prev, end);
    type Option = { way: LocalWay; index: number; forward: boolean; turn: number };
    const options: Option[] = [];
    for (const other of ways) {
      if (visited.has(other.id)) continue;
      for (let k = 0; k < other.points.length; k += 1) {
        if (!sameNode(way, endIndex, other, k)) continue;
        for (const forward of [true, false]) {
          const next = forward ? k + 1 : k - 1;
          if (next < 0 || next >= other.points.length) continue;
          const turn = Math.abs(wrapDeg(bearingDeg(other.points[k], other.points[next]) - inBearing));
          options.push({ way: other, index: k, forward, turn });
        }
      }
    }
    const named = (o: Option) => (first.name && o.way.name === first.name) || (first.ref && o.way.ref === first.ref);
    const pick =
      options.filter((o) => named(o) && o.turn <= 60).sort((a, b) => a.turn - b.turn)[0] ??
      options.filter((o) => o.turn <= 30).sort((a, b) => a.turn - b.turn || Number(Boolean(b.way.name)) - Number(Boolean(a.way.name)))[0];
    if (!pick) break;
    visited.add(pick.way.id);
    wayIds.push(pick.way.id);
    way = pick.way;
    endIndex = pick.forward ? way.points.length - 1 : 0;
    done = extend(points, total, walk(way, pick.index, pick.forward).slice(1), maxLengthM);
  }

  const along: number[] = [-backTotal.m];
  for (let i = 1; i < points.length; i += 1) along.push(along[i - 1] + len(sub(points[i], points[i - 1])));
  return { name: first.name ?? first.ref, points, along, length: total.m, wayIds };
}

export type Placement = { s: number; offset: number; at: EN };

/**
 * Where a point stands along the route: s from the camera, offset to the
 * right (positive) or left (negative) of the direction of travel. Null when
 * it lies before the start or past the end.
 */
export function placeOnRoute(route: Route, p: EN): Placement | null {
  const best = nearestOnRoute(route, p);
  if (!best || best.outside) return null;
  const { outside: _outside, ...placement } = best;
  return placement;
}

/** The route's nearest point to p, also when p lies before its start or past its end (`outside`). */
export function nearestOnRoute(route: Route, p: EN): (Placement & { outside: boolean }) | null {
  let best: (Placement & { outside: boolean }) | null = null;
  let bestD = Infinity;
  const n = route.points.length;
  for (let i = 0; i + 1 < n; i += 1) {
    const a = route.points[i];
    const b = route.points[i + 1];
    const v = sub(b, a);
    const l = len(v);
    if (l < 1e-6) continue;
    const raw = ((p.x - a.x) * v.x + (p.y - a.y) * v.y) / (l * l);
    const t = Math.min(1, Math.max(0, raw));
    const at = lerp(a, b, t);
    const d = len(sub(p, at));
    if (d < bestD) {
      bestD = d;
      const right = { x: v.y / l, y: -v.x / l };
      const outside = (i === 0 && raw < 0) || (i === n - 2 && raw > 1);
      best = { s: route.along[i] + t * l, offset: (p.x - at.x) * right.x + (p.y - at.y) * right.y, at, outside };
    }
  }
  return best;
}

/** Douglas–Peucker: fewer points, none further than `tolerance` metres from the original line. */
export function simplify(points: EN[], tolerance: number): EN[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    const a = points[i];
    const v = sub(points[j], a);
    const l = len(v) || 1;
    let worst = -1;
    let worstD = tolerance;
    for (let k = i + 1; k < j; k += 1) {
      const d = Math.abs((points[k].x - a.x) * v.y - (points[k].y - a.y) * v.x) / l;
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worst > 0) {
      keep[worst] = true;
      stack.push([i, worst], [worst, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** The point at distance s along the route, and the direction of travel there (compass degrees). */
export function pointAt(route: Route, s: number): { at: EN; headingDeg: number } {
  const n = route.points.length;
  const clamped = Math.min(route.along[n - 1], Math.max(route.along[0], s));
  let i = 0;
  while (i < n - 2 && route.along[i + 1] < clamped) i += 1;
  const a = route.points[i];
  const b = route.points[i + 1] ?? a;
  const seg = route.along[i + 1] - route.along[i] || 1;
  return { at: lerp(a, b, (clamped - route.along[i]) / seg), headingDeg: bearingDeg(a, b) };
}
