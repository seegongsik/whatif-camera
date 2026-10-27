import { describe, expect, it } from "vitest";
import {
  alphaForCompassHeading,
  basisFromOrientation,
  deviceAxesFromEuler,
  intrinsicsFrom35mm,
  intrinsicsFromLongSideFov,
  longSideFovDeg,
  orientationFromBasis,
  orientationFromEuler,
  pixelRay,
  projectPoint,
} from "../src/camera/pose.js";
import { noise } from "./scene-fixture.js";

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

describe("pinhole camera", () => {
  it("projects a point back onto the ray through its pixel", () => {
    const pose = {
      position: { x: 2, y: -3, z: 1.5 },
      orientation: { headingDeg: 31, pitchDeg: 12, rollDeg: 4 },
      intrinsics: intrinsicsFromLongSideFov(1080, 1440, 67),
    };
    const p = { x: 20, y: 30, z: 14 };
    const px = projectPoint(pose, p)!;
    const ray = pixelRay(pose.orientation, pose.intrinsics, px.u, px.v);
    const rel = { x: p.x - 2, y: p.y + 3, z: p.z - 1.5 };
    const n = Math.hypot(rel.x, rel.y, rel.z);
    expect(ray.x).toBeCloseTo(rel.x / n, 9);
    expect(ray.y).toBeCloseTo(rel.y / n, 9);
    expect(ray.z).toBeCloseTo(rel.z / n, 9);
  });

  it("puts the optical axis at the picture centre and returns null behind", () => {
    const pose = {
      position: { x: 0, y: 0, z: 0 },
      orientation: { headingDeg: 90, pitchDeg: 0, rollDeg: 0 },
      intrinsics: intrinsicsFromLongSideFov(800, 600, 60),
    };
    const ahead = projectPoint(pose, { x: 10, y: 0, z: 0 })!;
    expect(ahead.u).toBeCloseTo(400);
    expect(ahead.v).toBeCloseTo(300);
    expect(projectPoint(pose, { x: -10, y: 0, z: 0 })).toBeNull();
  });

  it("matches 35 mm equivalent focal lengths on the diagonal", () => {
    // 26 mm on a 4:3 frame: about 67° across the long side.
    const k = intrinsicsFrom35mm(4032, 3024, 26);
    expect(longSideFovDeg(k)).toBeGreaterThan(66.5);
    expect(longSideFovDeg(k)).toBeLessThan(68);
  });
});
