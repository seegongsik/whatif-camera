/**
 * Puts the photo on the map. The footprint (top view) fixes where the
 * building's outer vertical edges stand; the photo (front view) fixes the
 * directions to those edges. Their angular separation tells how far away the
 * camera was, which turns the footprint's width into a ruler for the photo.
 *
 * Unknowns: camera position (x, y) and a heading offset. Pitch and roll come
 * from the gravity sensor and are kept. GPS and compass enter as priors with
 * their own uncertainty, so a drifting fix or a magnetised compass is
 * corrected by the picture rather than trusted.
 *
 * Two outer edges alone leave the camera free to slide around a circle (every
 * point on it sees them the same angle apart). The roof line settles that:
 * the roof is taken to stand at the same height at both outer edges (an
 * assumption that holds for flat roofs), which fixes how much nearer one
 * edge is than the other.
 */
import { bearingDeg, wrapDeg, type EN } from "../geo/enu.js";
import { centroid, pointInRing, type Ring } from "../geo/polygon.js";
import { bearingElevation, pixelRay, type Intrinsics } from "../camera/pose.js";

export type Pixel = { u: number; v: number };

/** The building outline's outer left and right vertical edges, at the roof and at the ground. */
export type CornerMarks = {
  roofLeft: Pixel;
  roofRight: Pixel;
  groundLeft: Pixel;
  groundRight: Pixel;
  /** The foot of the walls is hidden (cars, trees): ground marks are only the lowest visible points. */
  groundHidden: boolean;
  /**
   * Optional: the top of the nearest corner when two sides of the building
   * show. A third vertical edge fixes the camera's sideways position on the
   * circle the outer edges allow (three-point resection), and with it the heading.
   */
  nearCorner?: Pixel;
};

export type Prior = {
  position: EN;
  positionSigmaM: number;
  headingDeg: number;
  headingSigmaDeg: number;
  pitchDeg: number;
  rollDeg: number;
};

export type RegistrationInput = {
  ring: Ring;
  /** Footprints the camera cannot stand inside (the target included). */
  obstacles: Ring[];
  prior: Prior;
  intrinsics: Intrinsics;
  marks: CornerMarks;
  /** Angular noise of one mark. */
  markSigmaDeg?: number;
};

export type Registration = {
  position: EN;
  headingDeg: number;
  leftVertex: number;
  rightVertex: number;
  /** -1 when no near corner was marked. */
  nearVertex: number;
  /** roofLeft, groundLeft, roofRight, groundRight, then the near corner if marked. */
  residualsDeg: number[];
  rmsDeg: number;
  positionShiftM: number;
  headingShiftDeg: number;
  /** Horizontal distances from the camera to the left, right and near edges. */
  leftDistanceM: number;
  rightDistanceM: number;
  nearDistanceM: number | null;
};

export const DEFAULT_MARK_SIGMA_DEG = 0.4;
/** Same roof height at the outer edges, within this share of the height (or 0.5 m). Assumption. */
export const ROOF_LEVEL_TOLERANCE = 0.05;
/** Phone held at eye level when the foot of the wall is hidden. Assumption. */
export const ASSUMED_CAMERA_HEIGHT_M = 1.5;

/** Heights of the left, right and near edges seen from a camera at those distances. */
export function edgeHeights(
  rays: MarkRay[],
  groundHidden: boolean,
  dL: number,
  dR: number,
  dNear: number | null,
): { left: number; right: number; near: number | null; cameraHeight: number } {
  const t = rays.map((r) => Math.tan((r.elevationDeg * Math.PI) / 180));
  const [roofL, groundL, roofR, groundR] = t;
  const cameraHeight = groundHidden ? ASSUMED_CAMERA_HEIGHT_M : (-dL * groundL - dR * groundR) / 2;
  const left = groundHidden ? cameraHeight + dL * roofL : dL * (roofL - groundL);
  const right = groundHidden ? cameraHeight + dR * roofR : dR * (roofR - groundR);
  const nearIndex = rays.findIndex((r) => r.edge === "near");
  const near = nearIndex >= 0 && dNear !== null ? cameraHeight + dNear * t[nearIndex] : null;
  return { left, right, near, cameraHeight };
}

export type MarkRay = { relBearingDeg: number; elevationDeg: number; edge: "left" | "right" | "near" };

/**
 * Each mark as a direction relative to the camera heading (elevation does
 * not depend on heading): roofLeft, groundLeft, roofRight, groundRight, then
 * the near corner when it is marked.
 */
export function markRays(marks: CornerMarks, intrinsics: Intrinsics, pitchDeg: number, rollDeg: number): MarkRay[] {
  const o = { headingDeg: 0, pitchDeg, rollDeg };
  const list: [Pixel, MarkRay["edge"]][] = [
    [marks.roofLeft, "left"],
    [marks.groundLeft, "left"],
    [marks.roofRight, "right"],
    [marks.groundRight, "right"],
  ];
  if (marks.nearCorner) list.push([marks.nearCorner, "near"]);
  return list.map(([p, edge]) => {
    const be = bearingElevation(pixelRay(o, intrinsics, p.u, p.v));
    return { relBearingDeg: wrapDeg(be.bearingDeg), elevationDeg: be.elevationDeg, edge };
  });
}

/** Nearest vertex that is not one of the two outer ones, or -1. */
export function nearVertex(ring: Ring, p: EN, left: number, right: number): number {
  let best = -1;
  let bestD = Infinity;
  ring.forEach((v, i) => {
    if (i === left || i === right) return;
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Outer left and right vertices of a ring as seen from p (bearings unwrapped around the centroid). */
export function silhouette(ring: Ring, p: EN): { left: number; right: number } {
  const c = bearingDeg(p, centroid(ring));
  let left = 0;
  let right = 0;
  let minRel = Infinity;
  let maxRel = -Infinity;
  ring.forEach((v, i) => {
    const rel = wrapDeg(bearingDeg(p, v) - c);
    if (rel < minRel) {
      minRel = rel;
      left = i;
    }
    if (rel > maxRel) {
      maxRel = rel;
      right = i;
    }
  });
  return { left, right };
}

type Evaluation = {
  cost: number;
  headingDeg: number;
  left: number;
  right: number;
  near: number;
  residuals: number[];
};

function evaluate(input: RegistrationInput, rays: MarkRay[], p: EN, sigmaMark: number): Evaluation | null {
  for (const obstacle of input.obstacles) if (pointInRing(p, obstacle)) return null;
  const { left, right } = silhouette(input.ring, p);
  const hasNear = rays.some((r) => r.edge === "near");
  const near = hasNear ? nearVertex(input.ring, p, left, right) : -1;
  if (hasNear && near < 0) return null;
  const vertexFor = (edge: MarkRay["edge"]) => (edge === "left" ? left : edge === "right" ? right : near);
  const target = rays.map((r) => bearingDeg(p, input.ring[vertexFor(r.edge)]));
  // Best heading offset in closed form: weighted mean of the misfits, pulled
  // towards zero by the compass prior.
  const wm = 1 / (sigmaMark * sigmaMark);
  const wh = 1 / (input.prior.headingSigmaDeg * input.prior.headingSigmaDeg);
  let sum = 0;
  rays.forEach((r, i) => {
    sum += wrapDeg(target[i] - input.prior.headingDeg - r.relBearingDeg) * wm;
  });
  const delta = sum / (rays.length * wm + wh);
  const heading = input.prior.headingDeg + delta;
  const residuals = rays.map((r, i) => wrapDeg(heading + r.relBearingDeg - target[i]));
  const dx = p.x - input.prior.position.x;
  const dy = p.y - input.prior.position.y;
  const lv = input.ring[left];
  const rv = input.ring[right];
  const nv = near >= 0 ? input.ring[near] : null;
  const h = edgeHeights(
    rays,
    input.marks.groundHidden,
    Math.hypot(lv.x - p.x, lv.y - p.y),
    Math.hypot(rv.x - p.x, rv.y - p.y),
    nv ? Math.hypot(nv.x - p.x, nv.y - p.y) : null,
  );
  const mean = (h.left + h.right) / 2;
  const sigmaH = Math.max(0.5, ROOF_LEVEL_TOLERANCE * Math.abs(mean));
  let level = ((h.left - h.right) / sigmaH) ** 2;
  if (h.near !== null) level += ((h.near - mean) / sigmaH) ** 2;
  const cost =
    residuals.reduce((s, e) => s + e * e, 0) * wm +
    (dx * dx + dy * dy) / (input.prior.positionSigmaM * input.prior.positionSigmaM) +
    delta * delta * wh +
    level;
  return { cost, headingDeg: heading, left, right, near, residuals };
}

export function register(input: RegistrationInput): Registration {
  const sigmaMark = input.markSigmaDeg ?? DEFAULT_MARK_SIGMA_DEG;
  const rays = markRays(input.marks, input.intrinsics, input.prior.pitchDeg, input.prior.rollDeg);
  const radius = Math.min(80, Math.max(6, 3 * input.prior.positionSigmaM));

  let best: { p: EN; e: Evaluation } | null = null;
  const consider = (p: EN) => {
    const e = evaluate(input, rays, p, sigmaMark);
    if (e && (!best || e.cost < best.e.cost)) best = { p, e };
  };

  let step = radius / 20;
  for (let i = -20; i <= 20; i += 1) {
    for (let j = -20; j <= 20; j += 1) {
      if (i * i + j * j > 400) continue;
      consider({ x: input.prior.position.x + i * step, y: input.prior.position.y + j * step });
    }
  }
  for (let round = 0; round < 4; round += 1) {
    const found = best as { p: EN; e: Evaluation } | null;
    if (!found) break;
    const center = found.p;
    step /= 4;
    for (let i = -8; i <= 8; i += 1) {
      for (let j = -8; j <= 8; j += 1) consider({ x: center.x + i * step, y: center.y + j * step });
    }
  }
  const result = best as { p: EN; e: Evaluation } | null;
  if (!result) {
    throw new Error("No camera position outside the buildings fits the marks; check the selected building.");
  }
  const { p, e } = result;
  const rms = Math.sqrt(e.residuals.reduce((s, r) => s + r * r, 0) / e.residuals.length);
  const lv = input.ring[e.left];
  const rv = input.ring[e.right];
  const nv = e.near >= 0 ? input.ring[e.near] : null;
  return {
    position: p,
    headingDeg: ((e.headingDeg % 360) + 360) % 360,
    leftVertex: e.left,
    rightVertex: e.right,
    nearVertex: e.near,
    residualsDeg: e.residuals,
    rmsDeg: rms,
    positionShiftM: Math.hypot(p.x - input.prior.position.x, p.y - input.prior.position.y),
    headingShiftDeg: wrapDeg(e.headingDeg - input.prior.headingDeg),
    leftDistanceM: Math.hypot(lv.x - p.x, lv.y - p.y),
    rightDistanceM: Math.hypot(rv.x - p.x, rv.y - p.y),
    nearDistanceM: nv ? Math.hypot(nv.x - p.x, nv.y - p.y) : null,
  };
}
