import { describe, expect, it } from "vitest";
import {
  alphaForCompassHeading,
  basisFromOrientation,
  deviceAxesFromEuler,
  orientationFromBasis,
  orientationFromEuler,
} from "../src/camera/pose.js";

/** Repeatable numbers in [-1, 1) from a seed. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

describe("device orientation", () => {
  it("reads an upright phone facing north as heading 0, level", () => {
    const o = orientationFromEuler(0, 90, 0);
    expect(o.headingDeg).toBeCloseTo(0, 6);
    expect(o.pitchDeg).toBeCloseTo(0, 6);
    expect(o.rollDeg).toBeCloseTo(0, 6);
  });

  it("turns alpha counter-clockwise: alpha 270 faces east", () => {
    const o = orientationFromEuler(270, 100, 0);
    expect(o.headingDeg).toBeCloseTo(90, 6);
    // beta past 90 tips the camera up.
    expect(o.pitchDeg).toBeCloseTo(10, 6);
    expect(o.rollDeg).toBeCloseTo(0, 6);
  });

  it("finds the alpha that matches an iOS compass heading", () => {
    const alpha = alphaForCompassHeading(100, 3, 123);
    expect(orientationFromEuler(alpha, 100, 3).headingDeg).toBeCloseTo(123, 6);
  });

  it("agrees with the device axes for any orientation", () => {
    const rnd = noise(11);
    for (let i = 0; i < 200; i += 1) {
      const alpha = (rnd() + 1) * 180;
      const beta = 20 + (rnd() + 1) * 70;
      const gamma = rnd() * 60;
      const axes = deviceAxesFromEuler(alpha, beta, gamma);
      const b = basisFromOrientation(orientationFromEuler(alpha, beta, gamma));
      expect(b.right.x).toBeCloseTo(axes.x.x, 9);
      expect(b.right.y).toBeCloseTo(axes.x.y, 9);
      expect(b.right.z).toBeCloseTo(axes.x.z, 9);
      expect(b.up.z).toBeCloseTo(axes.y.z, 9);
      expect(b.forward.x).toBeCloseTo(-axes.z.x, 9);
      expect(b.forward.z).toBeCloseTo(-axes.z.z, 9);
    }
  });

  it("round-trips heading, pitch and roll", () => {
    const o = { headingDeg: 217, pitchDeg: 18, rollDeg: -7 };
    const b = basisFromOrientation(o);
    const back = orientationFromBasis(b.up, b.forward);
    expect(back.headingDeg).toBeCloseTo(217, 9);
    expect(back.pitchDeg).toBeCloseTo(18, 9);
    expect(back.rollDeg).toBeCloseTo(-7, 9);
  });

  it("dips the right side of the picture for positive roll", () => {
    const b = basisFromOrientation({ headingDeg: 0, pitchDeg: 0, rollDeg: 10 });
    expect(b.right.z).toBeLessThan(0);
  });
});
