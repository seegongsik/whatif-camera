/**
 * Height from the photo once it sits on the map: the horizontal distance to
 * each outer edge (from the registration) times the tangent of the angle up
 * to the roof line, minus the same for the foot of the wall.
 */
import type { BuildingTags } from "../data/footprints.js";
import type { Intrinsics } from "../camera/pose.js";
import { edgeHeights, markRays, type CornerMarks, type Registration } from "./register.js";

export { ASSUMED_CAMERA_HEIGHT_M } from "./register.js";
/** Storey height used to turn a height into floors when OSM has no level count. Assumption. */
export const ASSUMED_FLOOR_HEIGHT_M = 3.0;

export type HeightEstimate = {
  heightM: number;
  leftHeightM: number;
  rightHeightM: number;
  nearHeightM: number | null;
  cameraHeightM: number;
  cameraHeightSource: "measured from the wall foot" | "assumption";
  floors: number;
  floorsSource: "OpenStreetMap building:levels" | "estimate from height";
  floorHeightM: number;
};

export function estimateHeight(
  registration: Registration,
  marks: CornerMarks,
  intrinsics: Intrinsics,
  pitchDeg: number,
  rollDeg: number,
  tags: BuildingTags,
): HeightEstimate {
  const rays = markRays(marks, intrinsics, pitchDeg, rollDeg);
  const h = edgeHeights(
    rays,
    marks.groundHidden,
    registration.leftDistanceM,
    registration.rightDistanceM,
    registration.nearDistanceM,
  );
  const cameraHeightSource: HeightEstimate["cameraHeightSource"] = marks.groundHidden
    ? "assumption"
    : "measured from the wall foot";
  const samples = h.near !== null ? [h.left, h.right, h.near] : [h.left, h.right];
  const heightM = Math.max(1, samples.reduce((sum, x) => sum + x, 0) / samples.length);
  const osmLevels = tags.levels !== undefined ? Math.round(tags.levels) : undefined;
  const floors = osmLevels && osmLevels >= 1 ? osmLevels : Math.max(1, Math.round(heightM / ASSUMED_FLOOR_HEIGHT_M));
  return {
    heightM,
    leftHeightM: h.left,
    rightHeightM: h.right,
    nearHeightM: h.near,
    cameraHeightM: h.cameraHeight,
    cameraHeightSource,
    floors,
    floorsSource: osmLevels && osmLevels >= 1 ? "OpenStreetMap building:levels" : "estimate from height",
    floorHeightM: heightM / floors,
  };
}
