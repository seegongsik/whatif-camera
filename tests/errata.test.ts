import { describe, expect, it } from "vitest";
import { MISNAMED, misplaced, MISPLACED, rightName } from "../src/street/errata.js";

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

  it("give a place named by its web address its own name, there and nowhere else", () => {
    const theatre = { id: "ovt/2/1/1", name: "graumanschinese.org", point: { lat: 34.10177, lon: -118.34104 } };
    expect(rightName(theatre)).toEqual({ ...theatre, name: "TCL Chinese Theatre" });
    expect(rightName({ ...theatre, point: { lat: 40.7, lon: -74 } }).name).toBe("graumanschinese.org");
    expect(rightName({ ...theatre, name: "Musso & Frank Grill" }).name).toBe("Musso & Frank Grill");
    expect(MISNAMED.every((m) => m.why.length > 20 && m.as.length > 0)).toBe(true);
  });
});
