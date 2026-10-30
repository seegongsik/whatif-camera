import { describe, expect, it } from "vitest";
import { localFrame, toLatLon } from "../src/geo/enu.js";
import { pointAt } from "../src/street/route.js";
import { clearSaved, readSaved, savePicks, saveStreet } from "../src/street/saved.js";
import { localRoute } from "../src/street/street.js";
import { syntheticStreet } from "../src/street/synthetic.js";
import { nextPlace, passed, ROUGH_FIX_M, simulatedFix, walkStep, type WalkFix } from "../src/street/walk.js";

const street = syntheticStreet();
const route = localRoute(street);
const frame = localFrame(street.origin);

/** A fix `right` metres to the right of the street, `s` metres along it. */
function fixAt(s: number, right: number, accuracyM = 8, at = 0): WalkFix {
  const { at: p, headingDeg } = pointAt(route, s);
  const h = (headingDeg * Math.PI) / 180;
  return { ...toLatLon(frame, { x: p.x + Math.cos(h) * right, y: p.y - Math.sin(h) * right }), accuracyM, at };
}

class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("walking the street (SYNTHETIC)", () => {
  it("puts a fix on the street: how far along, which side", () => {
    const spot = walkStep(null, route, frame, fixAt(400, -12))!;
    expect(spot.s).toBeCloseTo(400, 0);
    expect(spot.offset).toBeCloseTo(-12, 0);
    expect(spot.onStreet).toBe(true);
  });

  it("glides towards a new fix, more for a sharp one than a rough one", () => {
    const start = walkStep(null, route, frame, fixAt(400, 5))!;
    const sharp = walkStep(start, route, frame, fixAt(500, 5, 6))!;
    const rough = walkStep(start, route, frame, fixAt(500, 5, 60))!;
    expect(sharp.s).toBeCloseTo(500, 0);
    expect(rough.s).toBeGreaterThan(410);
    expect(rough.s).toBeLessThan(450);
  });

  it("leaves out a fix too rough to place, and says when you have left the street", () => {
    const start = walkStep(null, route, frame, fixAt(400, 5))!;
    expect(walkStep(start, route, frame, fixAt(900, 5, ROUGH_FIX_M + 1))).toBe(start);
    const away = walkStep(start, route, frame, fixAt(420, 160))!;
    expect(away.onStreet).toBe(false);
    expect(away.awayM).toBeGreaterThan(150);
  });

  it("names the next place ahead and the ones walked past", () => {
    const shops = street.shops;
    const next = nextPlace(shops, 400)!;
    expect(next.s).toBeGreaterThan(405);
    expect(shops.every((x) => x.s <= 405 || x.s >= next.s)).toBe(true);
    expect(nextPlace(shops, route.length + 10)).toBeNull();
    const went = passed(shops, 400, 700);
    expect(went.every((x) => x.s > 400 && x.s <= 700)).toBe(true);
    expect(passed(shops, 700, 400)).toEqual([]);
  });

  it("walks a SIMULATED walk down the street, beside its line", () => {
    let spot = null;
    for (let t = 0; t <= 20_000; t += 1000) spot = walkStep(spot, route, frame, simulatedFix(route, frame, t));
    expect(spot!.onStreet).toBe(true);
    // Twenty seconds at twenty times a walking pace.
    expect(spot!.s).toBeGreaterThan(450);
    expect(spot!.s).toBeLessThan(640);
    expect(Math.abs(spot!.offset)).toBeLessThan(15);
  });
});

describe("the last street from a photo", () => {
  it("is kept until the next one, with Muse Spark's picks for it", () => {
    const storage = new MemoryStorage();
    expect(readSaved(storage)).toBeNull();
    expect(saveStreet({ street, savedAt: "2026-10-30T09:00:00Z", live: true }, storage)).toBe(true);
    const saved = readSaved(storage)!;
    expect(saved.street.name).toBe(street.name);
    expect(saved.live).toBe(true);
    savePicks(street, { landmarks: [{ id: street.shops[0].id, why: "iconic" }], best: {} }, storage);
    expect(readSaved(storage)!.picks?.landmarks[0].why).toBe("iconic");
    // Picks for another street do not land on this one.
    savePicks({ ...street, fetchedAt: "another time" }, { landmarks: [], best: {} }, storage);
    expect(readSaved(storage)!.picks?.landmarks).toHaveLength(1);
    clearSaved(storage);
    expect(readSaved(storage)).toBeNull();
  });

  it("reads nothing from a broken entry or without storage", () => {
    const storage = new MemoryStorage();
    storage.setItem("whats-ahead:last-street", "{not json");
    expect(readSaved(storage)).toBeNull();
    storage.setItem("whats-ahead:last-street", JSON.stringify({ street: { route: { points: [] } }, savedAt: "x" }));
    expect(readSaved(storage)).toBeNull();
    expect(saveStreet({ street, savedAt: "x", live: false }, null)).toBe(false);
    expect(readSaved(null)).toBeNull();
  });
});
