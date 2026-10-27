import type { EN } from "./enu.js";

/** A simple polygon: vertices in order, not closed (the last vertex is not repeated). */
export type Ring = EN[];

/** Shoelace area, positive when the ring runs counter-clockwise (east-north axes). */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function area(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

export function centroid(ring: Ring): EN {
  const a = signedArea(ring);
  if (Math.abs(a) < 1e-9) {
    const sx = ring.reduce((s, p) => s + p.x, 0);
    const sy = ring.reduce((s, p) => s + p.y, 0);
    return { x: sx / ring.length, y: sy / ring.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Drops repeated and collinear vertices, then makes the ring counter-clockwise. */
export function cleanRing(input: Ring, epsilon = 0.05): Ring {
  const points: Ring = [];
  for (const p of input) {
    const last = points[points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > epsilon) points.push({ x: p.x, y: p.y });
  }
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= epsilon) points.pop();
  }
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[(i + points.length - 1) % points.length];
      const b = points[i];
      const c = points[(i + 1) % points.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const span = Math.hypot(c.x - a.x, c.y - a.y);
      if (span > 0 && Math.abs(cross) / span < epsilon) {
        points.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return signedArea(points) < 0 ? points.reverse() : points;
}

export function pointInRing(p: EN, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export type RayHit = { t: number; edge: number };

/** Nearest crossing of the ray origin + t·dir (t > 0) with the ring's edges. */
export function rayHit(origin: EN, dir: EN, ring: Ring): RayHit | null {
  let best: RayHit | null = null;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const ax = a.x - origin.x;
    const ay = a.y - origin.y;
    const t = (ax * ey - ay * ex) / denom;
    const s = (ax * dir.y - ay * dir.x) / denom;
    if (t > 1e-9 && s >= 0 && s <= 1 && (!best || t < best.t)) best = { t, edge: i };
  }
  return best;
}

export type Edge = {
  index: number;
  a: EN;
  b: EN;
  length: number;
  /** Unit direction from a to b. */
  dir: EN;
  /** Outward unit normal for a counter-clockwise ring. */
  normal: EN;
};

export function edges(ring: Ring): Edge[] {
  return ring.map((a, index) => {
    const b = ring[(index + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = length > 0 ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 1, y: 0 };
    return { index, a, b, length, dir, normal: { x: dir.y, y: -dir.x } };
  });
}

/**
 * Moves every edge of a counter-clockwise ring inward by `distance` and joins
 * the moved edges at their intersections. Returns null when the result folds
 * over itself (the ring is too small or too thin for that distance).
 */
export function insetRing(ring: Ring, distance: number): Ring | null {
  const es = edges(ring);
  const out: Ring = [];
  for (let i = 0; i < es.length; i += 1) {
    const prev = es[(i + es.length - 1) % es.length];
    const next = es[i];
    // Inward normal is minus the outward one.
    const p1 = { x: prev.a.x - prev.normal.x * distance, y: prev.a.y - prev.normal.y * distance };
    const p2 = { x: next.a.x - next.normal.x * distance, y: next.a.y - next.normal.y * distance };
    const denom = prev.dir.x * next.dir.y - prev.dir.y * next.dir.x;
    if (Math.abs(denom) < 1e-9) {
      out.push(p2);
      continue;
    }
    const t = ((p2.x - p1.x) * next.dir.y - (p2.y - p1.y) * next.dir.x) / denom;
    const corner = { x: p1.x + prev.dir.x * t, y: p1.y + prev.dir.y * t };
    const miter = Math.hypot(corner.x - next.a.x, corner.y - next.a.y);
    if (miter > distance * 4) return null;
    out.push(corner);
  }
  const before = signedArea(ring);
  const after = signedArea(out);
  if (after <= 0 || after >= before) return null;
  for (let i = 0; i < out.length; i += 1) {
    const original = es[i];
    const moved = { x: out[(i + 1) % out.length].x - out[i].x, y: out[(i + 1) % out.length].y - out[i].y };
    if (moved.x * original.dir.x + moved.y * original.dir.y <= 0) return null;
  }
  return out;
}

/** Axis-aligned extent of the ring along a unit direction and its normal. */
export function extentAlong(ring: Ring, dir: EN): { along: number; across: number } {
  let minA = Infinity;
  let maxA = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;
  for (const p of ring) {
    const a = p.x * dir.x + p.y * dir.y;
    const c = -p.x * dir.y + p.y * dir.x;
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
  }
  return { along: maxA - minA, across: maxC - minC };
}
