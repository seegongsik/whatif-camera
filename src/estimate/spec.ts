/**
 * The building specification: one object that every scene of the video is
 * drawn from, so the model, the dimension lines, the captions and the
 * decorations always agree with each other.
 */
import { localFrame, type EN, type LocalFrame } from "../geo/enu.js";
import { area, centroid, edges, pointInRing, type Ring } from "../geo/polygon.js";
import { eveningSun, sunPosition, type SunPosition } from "../geo/sun.js";
import {
  horizontalFovDeg,
  intrinsicsFromLongSideFov,
  projectPoint,
  type CameraPose,
  type Intrinsics,
} from "../camera/pose.js";
import { gpsSigmaM, headingSigmaDeg, type CaptureMeta } from "../capture/types.js";
import { toLocalFootprints, type FootprintSet, type LocalFootprint } from "../data/footprints.js";
import { rankCandidates, type Candidate } from "./identify.js";
import { register, type CornerMarks, type Registration } from "./register.js";
import { ASSUMED_CAMERA_HEIGHT_M, ASSUMED_FLOOR_HEIGHT_M, estimateHeight, type HeightEstimate } from "./height.js";

/** Height given to neighbouring buildings OSM has no height or levels for. Context only. Assumption. */
export const ASSUMED_NEIGHBOUR_HEIGHT_M = 9;

export type Located = {
  frame: LocalFrame;
  footprints: LocalFootprint[];
  intrinsics: Intrinsics;
  priorPose: CameraPose;
  candidates: Candidate[];
};

/**
 * Another outline of the selected building itself: map tiles carry a
 * building's outline and its parts as separate shapes, and a part as large as
 * the building (its centre inside, at least half its area) would bury the
 * model. Smaller parts inside it, such as a tower, stay.
 */
export function sameBuilding(target: Ring, other: Ring): boolean {
  return pointInRing(centroid(other), target) && area(other) >= 0.5 * area(target);
}

export function locate(capture: CaptureMeta, photo: { width: number; height: number }, set: FootprintSet): Located {
  const frame = localFrame({ lat: capture.lat, lon: capture.lon });
  const footprints = toLocalFootprints(set, frame);
  const centred = intrinsicsFromLongSideFov(photo.width, photo.height, capture.fovLongDeg);
  const pp = capture.principalPoint;
  const intrinsics = pp ? { ...centred, cx: pp.u, cy: pp.v } : centred;
  const priorPose: CameraPose = {
    position: { x: 0, y: 0, z: ASSUMED_CAMERA_HEIGHT_M },
    orientation: { headingDeg: capture.headingDeg, pitchDeg: capture.pitchDeg, rollDeg: capture.rollDeg },
    intrinsics,
  };
  const candidates = rankCandidates(footprints, { x: 0, y: 0 }, {
    headingDeg: capture.headingDeg,
    headingSigmaDeg: headingSigmaDeg(capture),
    fovDeg: horizontalFovDeg(intrinsics),
  });
  return { frame, footprints, intrinsics, priorPose, candidates };
}

/**
 * First guess for the four marks: the footprint's outer edges projected with
 * the sensor pose, at the ground and at a guessed height, kept inside the frame.
 */
export function predictMarks(target: LocalFootprint, pose: CameraPose): CornerMarks {
  const ring = target.ring;
  const c = centroid(ring);
  const guessH =
    target.tags.heightM ?? (target.tags.levels ? target.tags.levels * ASSUMED_FLOOR_HEIGHT_M : (target.tags.tileHeightM ?? 12));
  const cam = { x: pose.position.x, y: pose.position.y };
  // Outer vertices by angle around the view of the centroid.
  const base = Math.atan2(c.x - cam.x, c.y - cam.y);
  let left = ring[0];
  let right = ring[0];
  let minA = Infinity;
  let maxA = -Infinity;
  for (const v of ring) {
    let a = Math.atan2(v.x - cam.x, v.y - cam.y) - base;
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    if (a < minA) {
      minA = a;
      left = v;
    }
    if (a > maxA) {
      maxA = a;
      right = v;
    }
  }
  const { width, height } = pose.intrinsics;
  const clampPx = (p: { u: number; v: number } | null, fallback: { u: number; v: number }) => {
    const q = p ?? fallback;
    return {
      u: Math.min(width * 0.97, Math.max(width * 0.03, q.u)),
      v: Math.min(height * 0.97, Math.max(height * 0.03, q.v)),
    };
  };
  const proj = (v: EN, z: number) => projectPoint(pose, { x: v.x, y: v.y, z });
  return {
    roofLeft: clampPx(proj(left, guessH), { u: width * 0.25, v: height * 0.25 }),
    roofRight: clampPx(proj(right, guessH), { u: width * 0.75, v: height * 0.25 }),
    groundLeft: clampPx(proj(left, 0), { u: width * 0.25, v: height * 0.8 }),
    groundRight: clampPx(proj(right, 0), { u: width * 0.75, v: height * 0.8 }),
    groundHidden: false,
  };
}

export type NeighbourSource =
  | "OpenStreetMap height"
  | "OpenStreetMap levels × assumed storey height"
  | "map tiles (approximate)"
  | "assumption"
  | "synthetic";

export type Neighbour = { id: string; ring: Ring; heightM: number; heightSource: NeighbourSource };

export type SunSetting = { day: SunPosition; dayIsDefault: boolean; evening: SunPosition | null };

export type BuildingSpec = {
  synthetic: boolean;
  frame: LocalFrame;
  target: LocalFootprint;
  neighbours: Neighbour[];
  priorPose: CameraPose;
  pose: CameraPose;
  registration: Registration;
  height: HeightEstimate;
  marks: CornerMarks;
  /** Edge of the footprint that faces the camera most. */
  mainFacade: number;
  /** An edge next to the main facade that the camera also sees, for the depth dimension. */
  sideFacade: number;
  widthM: number;
  depthM: number;
  roofAreaM2: number;
  capturedAt: string;
  sun: SunSetting;
  attribution: string;
  footprintSource: string;
};

function facadeScores(ring: Ring, camera: EN): number[] {
  return edges(ring).map((e) => {
    const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
    const to = { x: camera.x - mid.x, y: camera.y - mid.y };
    const d = Math.hypot(to.x, to.y) || 1;
    const facing = (e.normal.x * to.x + e.normal.y * to.y) / d;
    return facing > 0 ? facing * e.length : -1;
  });
}

function sunSetting(capturedAt: string, lat: number, lon: number): SunSetting {
  const at = new Date(capturedAt);
  const valid = Number.isFinite(at.getTime());
  const when = valid ? at : new Date();
  const day = sunPosition(when, lat, lon);
  const evening = eveningSun(new Date(when.getTime() - 6 * 3600_000), lat, lon);
  if (day.elevationDeg >= 8) return { day, dayIsDefault: false, evening: evening?.sun ?? null };
  // Night or dawn capture: light the model from a mid-day sun on the equator side.
  return {
    day: { azimuthDeg: lat >= 0 ? 190 : 10, elevationDeg: 45 },
    dayIsDefault: true,
    evening: evening?.sun ?? null,
  };
}

export function buildSpec(args: {
  synthetic: boolean;
  capture: CaptureMeta;
  located: Located;
  footprintSet: FootprintSet;
  selectionId: string;
  marks: CornerMarks;
}): BuildingSpec {
  const { capture, located, selectionId, marks } = args;
  const target = located.footprints.find((f) => f.id === selectionId);
  if (!target) throw new Error(`Building ${selectionId} is not in the footprints`);
  const registration = register({
    ring: target.ring,
    obstacles: located.footprints.map((f) => f.ring),
    prior: {
      position: { x: 0, y: 0 },
      positionSigmaM: gpsSigmaM(capture.accuracyM),
      headingDeg: capture.headingDeg,
      headingSigmaDeg: headingSigmaDeg(capture),
      pitchDeg: capture.pitchDeg,
      rollDeg: capture.rollDeg,
    },
    intrinsics: located.intrinsics,
    marks,
  });
  const height = estimateHeight(
    registration,
    marks,
    located.intrinsics,
    capture.pitchDeg,
    capture.rollDeg,
    target.tags,
  );
  const pose: CameraPose = {
    position: { x: registration.position.x, y: registration.position.y, z: height.cameraHeightM },
    orientation: { headingDeg: registration.headingDeg, pitchDeg: capture.pitchDeg, rollDeg: capture.rollDeg },
    intrinsics: located.intrinsics,
  };
  const scores = facadeScores(target.ring, registration.position);
  const mainFacade = scores.indexOf(Math.max(...scores));
  const n = target.ring.length;
  const es = edges(target.ring);
  const main = es[mainFacade];
  // A side wall for the depth line: next to the main facade, at least a quarter
  // as long and roughly square to it. Outlines with notches may have none.
  const sides = [(mainFacade + n - 1) % n, (mainFacade + 1) % n].filter(
    (i) => es[i].length >= 0.25 * main.length && Math.abs(es[i].dir.x * main.dir.x + es[i].dir.y * main.dir.y) <= 0.5,
  );
  const sideFacade = sides.length === 0 ? mainFacade : sides.reduce((a, b) => (scores[b] > scores[a] ? b : a));
  // Depth: how far the footprint reaches behind the main facade.
  const depthM = Math.max(...target.ring.map((p) => -((p.x - main.a.x) * main.normal.x + (p.y - main.a.y) * main.normal.y)));
  const neighbours: Neighbour[] = located.footprints
    .filter((f) => f.id !== target.id && !sameBuilding(target.ring, f.ring))
    .map((f) => {
      if (args.synthetic && f.tags.heightM !== undefined) {
        return { id: f.id, ring: f.ring, heightM: f.tags.heightM, heightSource: "synthetic" as const };
      }
      if (f.tags.heightM !== undefined) {
        return { id: f.id, ring: f.ring, heightM: f.tags.heightM, heightSource: "OpenStreetMap height" as const };
      }
      if (f.tags.levels !== undefined) {
        return {
          id: f.id,
          ring: f.ring,
          heightM: f.tags.levels * ASSUMED_FLOOR_HEIGHT_M,
          heightSource: "OpenStreetMap levels × assumed storey height" as const,
        };
      }
      if (f.tags.tileHeightM !== undefined) {
        return { id: f.id, ring: f.ring, heightM: f.tags.tileHeightM, heightSource: "map tiles (approximate)" as const };
      }
      return { id: f.id, ring: f.ring, heightM: ASSUMED_NEIGHBOUR_HEIGHT_M, heightSource: "assumption" as const };
    });
  return {
    synthetic: args.synthetic,
    frame: located.frame,
    target,
    neighbours,
    priorPose: located.priorPose,
    pose,
    registration,
    height,
    marks,
    mainFacade,
    sideFacade,
    widthM: main.length,
    depthM,
    roofAreaM2: area(target.ring),
    capturedAt: capture.takenAt,
    sun: sunSetting(capture.takenAt, capture.lat, capture.lon),
    attribution: args.footprintSet.attribution,
    footprintSource: args.footprintSet.source,
  };
}
