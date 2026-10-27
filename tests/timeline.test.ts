import { describe, expect, it } from "vitest";
import { monotoneSpline, orbitPose, photoOrbit } from "../src/scene/timeline.js";
import { truePose, TARGET, TRUE_HEIGHT_M } from "./scene-fixture.js";
import type { BuildingSpec } from "../src/estimate/spec.js";

describe("camera path", () => {
  it("starts exactly at the photo's pose", () => {
    const pose = truePose();
    const spec = { pose, target: { ring: TARGET }, height: { heightM: TRUE_HEIGHT_M } } as unknown as BuildingSpec;
    const back = orbitPose(photoOrbit(spec));
    expect(back.position.x).toBeCloseTo(pose.position.x, 9);
    expect(back.position.y).toBeCloseTo(pose.position.y, 9);
    expect(back.position.z).toBeCloseTo(pose.position.z, 9);
    expect(back.orientation.headingDeg).toBeCloseTo(pose.orientation.headingDeg, 9);
    expect(back.orientation.pitchDeg).toBeCloseTo(pose.orientation.pitchDeg, 9);
    expect(back.orientation.rollDeg).toBeCloseTo(pose.orientation.rollDeg, 9);
  });

  it("holds still at a hold and never overshoots", () => {
    const f = monotoneSpline([0, 1, 2, 3], [5, 5, 10, 10]);
    expect(f(0.5)).toBe(5);
    for (let t = 1; t <= 2; t += 0.01) {
      expect(f(t)).toBeGreaterThanOrEqual(5);
      expect(f(t)).toBeLessThanOrEqual(10);
    }
    expect(f(2.5)).toBe(10);
  });
});
