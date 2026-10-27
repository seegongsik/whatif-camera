import { describe, expect, it } from "vitest";
import { tiltFromVerticals } from "../src/estimate/verticals.js";
import { register } from "../src/estimate/register.js";
import { estimateHeight } from "../src/estimate/height.js";
import { TARGET, TRUE_HEIGHT_M, trueMarks, truePose } from "./scene-fixture.js";

describe("tilt from the building's vertical edges", () => {
  it("recovers pitch and roll from exact marks", () => {
    const pose = truePose();
    const t = tiltFromVerticals(trueMarks(pose, TARGET, TRUE_HEIGHT_M, 0), pose.intrinsics)!;
    expect(t.pitchDeg).toBeCloseTo(14, 6);
    expect(t.rollDeg).toBeCloseTo(-2, 6);
  });

  it("with 1.5 px of hand error: pitch within about a degree, height still within 3%", () => {
    const pose = truePose();
    const marks = trueMarks(pose, TARGET, TRUE_HEIGHT_M, 1.5);
    const t = tiltFromVerticals(marks, pose.intrinsics)!;
    expect(Math.abs(t.pitchDeg - 14)).toBeLessThan(1.5);
    expect(Math.abs(t.rollDeg + 2)).toBeLessThan(1);
    // An upload has no gravity reading: use the tilt from the edges instead.
    const reg = register({
      ring: TARGET,
      obstacles: [TARGET],
      prior: {
        position: { x: pose.position.x + 6, y: pose.position.y - 5 },
        positionSigmaM: 10,
        headingDeg: pose.orientation.headingDeg + 8,
        headingSigmaDeg: 20,
        pitchDeg: t.pitchDeg,
        rollDeg: t.rollDeg,
      },
      intrinsics: pose.intrinsics,
      marks,
    });
    const h = estimateHeight(reg, marks, pose.intrinsics, t.pitchDeg, t.rollDeg, {});
    expect(Math.abs(h.heightM - TRUE_HEIGHT_M) / TRUE_HEIGHT_M).toBeLessThan(0.03);
  });

  it("reads a camera tipped down, and a level one", () => {
    for (const pitch of [-8, 0]) {
      const pose = truePose();
      pose.orientation = { ...pose.orientation, pitchDeg: pitch, rollDeg: 3 };
      pose.position = { ...pose.position, z: 25 };
      const t = tiltFromVerticals(trueMarks(pose, TARGET, TRUE_HEIGHT_M, 0), pose.intrinsics)!;
      expect(t.pitchDeg).toBeCloseTo(pitch, 4);
      expect(t.rollDeg).toBeCloseTo(3, 4);
    }
  });
});
