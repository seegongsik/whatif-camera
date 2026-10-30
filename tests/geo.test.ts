import { describe, expect, it } from "vitest";
import { bearingDeg, compassWord, localFrame, toLatLon, toLocal, wrapDeg } from "../src/geo/enu.js";

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

  it("names a bearing by the nearest of the eight compass words", () => {
    expect(compassWord(0)).toBe("north");
    expect(compassWord(134)).toBe("south-east");
    expect(compassWord(359)).toBe("north");
    expect(compassWord(-90)).toBe("west");
  });
});
