import { describe, expect, it } from "vitest";
import { bearingDeg, localFrame, toLatLon, toLocal, wrapDeg } from "../src/geo/enu.js";
import { area, centroid, cleanRing, insetRing, pointInRing, rayHit, signedArea } from "../src/geo/polygon.js";
import { eveningSun, sunPosition } from "../src/geo/sun.js";

describe("local frame", () => {
  it("has about 111 km per degree of latitude at 37.5°", () => {
    const f = localFrame({ lat: 37.5, lon: 127 });
    expect(f.metersPerDegLat).toBeGreaterThan(110_900);
    expect(f.metersPerDegLat).toBeLessThan(111_050);
    // A degree of longitude shrinks with cos(latitude).
    expect(f.metersPerDegLon / f.metersPerDegLat).toBeCloseTo(Math.cos((37.5 * Math.PI) / 180), 2);
  });

  it("round-trips a point 200 m away", () => {
    const f = localFrame({ lat: 37.5, lon: 127 });
    const p = toLatLon(f, { x: 150, y: -132 });
    const back = toLocal(f, p);
    expect(back.x).toBeCloseTo(150, 6);
    expect(back.y).toBeCloseTo(-132, 6);
  });

  it("measures bearings clockwise from north", () => {
    expect(bearingDeg({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0);
    expect(bearingDeg({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90);
    expect(bearingDeg({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(270);
    expect(wrapDeg(350)).toBeCloseTo(-10);
    expect(wrapDeg(-190)).toBeCloseTo(170);
  });
});

describe("polygons", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 0, y: 20 },
    { x: 10, y: 20 },
    { x: 10, y: 0 },
  ];

  it("cleans a clockwise ring into a counter-clockwise one", () => {
    expect(signedArea(square)).toBeLessThan(0);
    const ring = cleanRing([...square, { x: 0, y: 0 }]);
    expect(ring).toHaveLength(4);
    expect(signedArea(ring)).toBeCloseTo(200);
    expect(centroid(ring)).toEqual({ x: 5, y: 10 });
  });

  it("drops a collinear vertex", () => {
    const ring = cleanRing([...square.slice(0, 2), { x: 5, y: 20 }, ...square.slice(2)]);
    expect(ring).toHaveLength(4);
  });

  it("finds the nearest wall a ray meets", () => {
    const ring = cleanRing(square);
    const hit = rayHit({ x: 5, y: -30 }, { x: 0, y: 1 }, ring);
    expect(hit?.t).toBeCloseTo(30);
    expect(rayHit({ x: 5, y: -30 }, { x: 0, y: -1 }, ring)).toBeNull();
    expect(pointInRing({ x: 5, y: 5 }, ring)).toBe(true);
    expect(pointInRing({ x: 15, y: 5 }, ring)).toBe(false);
  });

  it("insets a rectangle by a metre on every side", () => {
    const inner = insetRing(cleanRing(square), 1);
    expect(inner).not.toBeNull();
    expect(area(inner!)).toBeCloseTo(8 * 18);
    expect(insetRing(cleanRing(square), 6)).toBeNull();
  });
});

describe("sun", () => {
  // At the June solstice the noon sun stands 90° - latitude + obliquity high.
  it("peaks near 90 - 37.5 + 23.44 degrees at the June solstice", () => {
    let best = { el: -90, az: 0 };
    const start = Date.UTC(2026, 5, 21, 0, 0);
    for (let m = 0; m < 24 * 60; m += 1) {
      const s = sunPosition(new Date(start + m * 60_000), 37.5, 127);
      if (s.elevationDeg > best.el) best = { el: s.elevationDeg, az: s.azimuthDeg };
    }
    expect(best.el).toBeCloseTo(90 - 37.5 + 23.44, 0);
    expect(Math.abs(best.az - 180)).toBeLessThan(2);
  });

  it("sets in the north-west on a June evening in the northern hemisphere", () => {
    const evening = eveningSun(new Date(Date.UTC(2026, 5, 21, 0, 0)), 37.5, 127, 7);
    expect(evening).not.toBeNull();
    expect(evening!.sun.elevationDeg).toBeLessThan(7);
    expect(evening!.sun.elevationDeg).toBeGreaterThan(6);
    expect(evening!.sun.azimuthDeg).toBeGreaterThan(285);
    expect(evening!.sun.azimuthDeg).toBeLessThan(305);
  });
});
