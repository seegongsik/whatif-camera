/**
 * Which building is the photo of? Rays are swept across the view from the
 * GPS position; each ray belongs to the first footprint it meets (a 1-D
 * depth buffer), and rays near the middle of the picture count more because
 * people centre the building they photograph and the compass is uncertain.
 */
import { pointInRing, rayHit, type Ring } from "../geo/polygon.js";
import type { EN } from "../geo/enu.js";

export type Candidate = {
  id: string;
  /** Weighted share of the sweep that sees this building first (0 to 1). */
  score: number;
  rays: number;
  nearestM: number;
  /** True when the GPS fix lies inside this footprint. */
  containsCamera: boolean;
};

export type RankOptions = {
  headingDeg: number;
  headingSigmaDeg: number;
  /** Horizontal field of view of the picture. */
  fovDeg: number;
  rayCount?: number;
  maxRangeM?: number;
};

export function rankCandidates(
  footprints: { id: string; ring: Ring }[],
  camera: EN,
  options: RankOptions,
): Candidate[] {
  // Without a usable compass every direction is equally likely: sweep the full circle.
  const noCompass = options.headingSigmaDeg >= 90;
  const rayCount = options.rayCount ?? (noCompass ? 721 : 241);
  const maxRange = options.maxRangeM ?? 250;
  const aimSigma = options.fovDeg / 6;
  const sigma = noCompass ? Infinity : Math.hypot(options.headingSigmaDeg, aimSigma);
  const halfSweep = noCompass ? 180 : Math.min(90, options.fovDeg / 2 + 2 * options.headingSigmaDeg);

  const inside = new Set(footprints.filter((f) => pointInRing(camera, f.ring)).map((f) => f.id));
  const tally = new Map<string, { weight: number; rays: number; nearest: number }>();
  let total = 0;
  for (let i = 0; i < rayCount; i += 1) {
    const offset = rayCount === 1 ? 0 : -halfSweep + (2 * halfSweep * i) / (noCompass ? rayCount : rayCount - 1);
    const b = ((options.headingDeg + offset) * Math.PI) / 180;
    const dir = { x: Math.sin(b), y: Math.cos(b) };
    const weight = Math.exp(-0.5 * (offset / sigma) ** 2);
    total += weight;
    let bestId: string | null = null;
    let bestT = maxRange;
    for (const f of footprints) {
      if (inside.has(f.id)) continue;
      const hit = rayHit(camera, dir, f.ring);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        bestId = f.id;
      }
    }
    if (!bestId) continue;
    const entry = tally.get(bestId) ?? { weight: 0, rays: 0, nearest: Infinity };
    entry.weight += weight;
    entry.rays += 1;
    entry.nearest = Math.min(entry.nearest, bestT);
    tally.set(bestId, entry);
  }

  const out: Candidate[] = [...tally.entries()].map(([id, e]) => ({
    id,
    score: total > 0 ? e.weight / total : 0,
    rays: e.rays,
    nearestM: e.nearest,
    containsCamera: false,
  }));
  // A GPS fix inside a footprint usually means the photographer stood right
  // in front of that building and the fix drifted; keep it as a candidate.
  for (const id of inside) out.push({ id, score: 0.5, rays: 0, nearestM: 0, containsCamera: true });
  return out.sort((a, b) => b.score - a.score);
}
