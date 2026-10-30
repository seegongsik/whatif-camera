import { describe, expect, it } from "vitest";
import { misplaced, MISPLACED } from "../src/street/errata.js";

describe("places the data has in the wrong spot", () => {
  it("are known by name and where the data has them, not by a row number that changes each release", () => {
    const mall = MISPLACED[0];
    expect(misplaced({ name: "Palo Alto - Stanford Mall", point: { lat: 37.47490, lon: -122.13925 } })).toBe(true);
    expect(misplaced({ name: "palo alto – stanford mall", point: mall.at })).toBe(true);
    // The same name where a real place could stand, or another place at that spot, stays.
    expect(misplaced({ name: "Palo Alto - Stanford Mall", point: { lat: 37.4434, lon: -122.171 } })).toBe(false);
    expect(misplaced({ name: "Las Michoacanitas", point: mall.at })).toBe(false);
    expect(MISPLACED.every((m) => m.why.length > 20)).toBe(true);
  });
});
