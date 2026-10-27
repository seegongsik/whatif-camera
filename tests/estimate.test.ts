import { describe, expect, it } from "vitest";
import { rankCandidates } from "../src/estimate/identify.js";
import { register } from "../src/estimate/register.js";
import { estimateHeight } from "../src/estimate/height.js";
import { sameBuilding } from "../src/estimate/spec.js";
import { isOutside, rect, TARGET, TRUE_HEIGHT_M, trueMarks, truePose } from "./scene-fixture.js";

const NEIGHBOURS = [rect(-22, 44, 14, 14, 20), rect(30, 52, 12, 16, 20), rect(6, 80, 30, 14, 20), rect(-8, -30, 20, 10, 0)];
const ALL = [TARGET, ...NEIGHBOURS];

describe("identify", () => {
  it("picks the building in the middle of the view, not the one behind it", () => {
    const pose = truePose();
    const list = rankCandidates(
      ALL.map((ring, i) => ({ id: `b${i}`, ring })),
      { x: pose.position.x, y: pose.position.y },
      { headingDeg: pose.orientation.headingDeg + 9, headingSigmaDeg: 20, fovDeg: 52 },
    );
    expect(list[0].id).toBe("b0");
    expect(list[0].score).toBeGreaterThan(1.5 * list[1].score);
    expect(list.find((c) => c.id === "b4")).toBeUndefined(); // behind the camera
  });
});

describe("registration and height (SYNTHETIC scene)", () => {
  const pose = truePose();
  const truth = { x: pose.position.x, y: pose.position.y };

  function run(gpsOffset: { x: number; y: number }, compassError: number, groundZ = 0, withNear = false) {
    const marks = trueMarks(pose, TARGET, TRUE_HEIGHT_M, 1.5, 7, groundZ, withNear);
    const prior = {
      position: { x: truth.x + gpsOffset.x, y: truth.y + gpsOffset.y },
      positionSigmaM: 8,
      headingDeg: pose.orientation.headingDeg + compassError,
      headingSigmaDeg: 20,
      pitchDeg: pose.orientation.pitchDeg,
      rollDeg: pose.orientation.rollDeg,
    };
    const reg = register({ ring: TARGET, obstacles: ALL, prior, intrinsics: pose.intrinsics, marks });
    const h = estimateHeight(reg, marks, pose.intrinsics, prior.pitchDeg, prior.rollDeg, {});
    return { reg, h };
  }

  it("recovers position, heading and height when GPS is 9 m off and the compass 11° off", () => {
    const { reg, h } = run({ x: 7, y: -6 }, 11);
    // The outer edges fix the distance; the level roof line fixes the
    // sideways position, so the priors' errors are corrected.
    expect(Math.hypot(reg.position.x - truth.x, reg.position.y - truth.y)).toBeLessThan(2);
    expect(Math.abs(reg.headingDeg - pose.orientation.headingDeg)).toBeLessThan(2);
    expect(reg.rmsDeg).toBeLessThan(0.3);
    expect(Math.abs(h.heightM - TRUE_HEIGHT_M) / TRUE_HEIGHT_M).toBeLessThan(0.05);
    expect(h.cameraHeightSource).toBe("measured from the wall foot");
    expect(h.cameraHeightM).toBeGreaterThan(1.2);
    expect(h.cameraHeightM).toBeLessThan(2.0);
    expect(h.floors).toBe(6);
    expect(h.floorsSource).toBe("estimate from height");
  });

  it("pins position and heading down when the near corner is marked too", () => {
    const { reg, h } = run({ x: 7, y: -6 }, 11, 0, true);
    expect(reg.nearVertex).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(reg.position.x - truth.x, reg.position.y - truth.y)).toBeLessThan(1.5);
    expect(Math.abs(reg.headingDeg - pose.orientation.headingDeg)).toBeLessThan(1);
    expect(h.nearHeightM).not.toBeNull();
    expect(Math.abs(h.heightM - TRUE_HEIGHT_M) / TRUE_HEIGHT_M).toBeLessThan(0.04);
  });

  it("keeps the estimate when the wall foot is hidden, using the assumed eye height", () => {
    const { h } = run({ x: -5, y: 4 }, -8, 2.5);
    expect(h.cameraHeightSource).toBe("assumption");
    expect(Math.abs(h.heightM - TRUE_HEIGHT_M) / TRUE_HEIGHT_M).toBeLessThan(0.06);
  });

  it("prefers OSM levels for the floor count", () => {
    const { reg } = run({ x: 0, y: 0 }, 0);
    const marks = trueMarks(pose, TARGET, TRUE_HEIGHT_M, 0);
    const h = estimateHeight(reg, marks, pose.intrinsics, 14, -2, { levels: 5 });
    expect(h.floors).toBe(5);
    expect(h.floorsSource).toBe("OpenStreetMap building:levels");
    expect(h.floorHeightM).toBeCloseTo(h.heightM / 5);
  });

  it("never places the camera inside a building, even when the GPS fix is inside one", () => {
    const prior = { x: truth.x, y: truth.y + 44 };
    expect(isOutside(prior, ALL)).toBe(false);
    const { reg } = run({ x: 0, y: 44 }, 0);
    expect(isOutside(reg.position, ALL)).toBe(true);
  });
});

describe("identify without a compass", () => {
  it("sweeps the full circle and still finds the nearby buildings", () => {
    const pose = truePose();
    const list = rankCandidates(
      ALL.map((ring, i) => ({ id: `b${i}`, ring })),
      { x: pose.position.x, y: pose.position.y },
      { headingDeg: 0, headingSigmaDeg: 180, fovDeg: 52 },
    );
    const ids = list.map((c) => c.id);
    // The one behind the camera is now a candidate too.
    expect(ids).toContain("b0");
    expect(ids).toContain("b4");
  });
});

describe("outlines of the same building", () => {
  const outline = rect(0, 0, 40, 20, 0);
  it("treats a part as large as the building as the building itself", () => {
    expect(sameBuilding(outline, rect(0.3, -0.2, 39, 19.5, 0))).toBe(true);
  });
  it("keeps a tower inside the building and a separate building next door", () => {
    expect(sameBuilding(outline, rect(2, 1, 8, 8, 0))).toBe(false);
    expect(sameBuilding(outline, rect(45, 0, 40, 20, 0))).toBe(false);
  });
});
