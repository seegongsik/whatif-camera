/**
 * SYNTHETIC test scene: invented buildings around a placeholder origin.
 * Used only by the tests (and, separately, by the in-browser synthetic demo).
 */
import { pointInRing, type Ring } from "../src/geo/polygon.js";
import { projectPoint, intrinsicsFromLongSideFov, type CameraPose } from "../src/camera/pose.js";
import { bearingDeg, type EN } from "../src/geo/enu.js";
import { nearVertex, silhouette, type CornerMarks } from "../src/estimate/register.js";
import { centroid } from "../src/geo/polygon.js";

export function rect(cx: number, cy: number, w: number, d: number, rotDeg: number): Ring {
  const r = (rotDeg * Math.PI) / 180;
  const ux = { x: Math.cos(r), y: -Math.sin(r) };
  const uy = { x: Math.sin(r), y: Math.cos(r) };
  const corners: [number, number][] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  return corners.map(([a, b]) => ({ x: cx + a * ux.x + b * uy.x, y: cy + a * ux.y + b * uy.y }));
}

/** Deterministic noise in [-1, 1]. */
export function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Six storeys of 3.1 m. */
export const TRUE_HEIGHT_M = 18.6;
export const TARGET = rect(4, 46, 18, 12, 20);

export function truePose(): CameraPose {
  const camera: EN = { x: 3, y: -2 };
  const heading = bearingDeg(camera, centroid(TARGET)) + 4;
  return {
    position: { x: camera.x, y: camera.y, z: 1.6 },
    orientation: { headingDeg: heading, pitchDeg: 14, rollDeg: -2 },
    intrinsics: intrinsicsFromLongSideFov(1080, 1440, 67),
  };
}

/** Marks a careful person would place, with up to `jitterPx` of hand error. */
export function trueMarks(
  pose: CameraPose,
  ring: Ring,
  height: number,
  jitterPx: number,
  seed = 7,
  groundZ = 0,
  withNear = false,
): CornerMarks {
  const rnd = noise(seed);
  const cam = { x: pose.position.x, y: pose.position.y };
  const { left, right } = silhouette(ring, cam);
  const at = (v: EN, z: number) => {
    const p = projectPoint(pose, { x: v.x, y: v.y, z });
    if (!p) throw new Error("corner behind the camera");
    return { u: p.u + rnd() * jitterPx, v: p.v + rnd() * jitterPx };
  };
  const marks: CornerMarks = {
    roofLeft: at(ring[left], height),
    roofRight: at(ring[right], height),
    groundLeft: at(ring[left], groundZ),
    groundRight: at(ring[right], groundZ),
    groundHidden: groundZ > 0,
  };
  if (withNear) marks.nearCorner = at(ring[nearVertex(ring, cam, left, right)], height);
  return marks;
}

export function isOutside(p: EN, rings: Ring[]): boolean {
  return rings.every((r) => !pointInRing(p, r));
}
