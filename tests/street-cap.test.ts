import { describe, expect, it } from "vitest";
import type { ShopAhead } from "../src/street/ahead.js";
import { emptyStretches, EMPTY_PACE, lightRun, REVEAL_PACE, showReach } from "../src/street/show-plan.js";
import { walkText } from "../src/street/signs.js";
import { FAR_MIN, keepNearFirst, NEAR_M } from "../src/street/street.js";

let n = 0;
const place = (s: number, confidence: number): ShopAhead => ({ id: `c${n++}`, name: `P${n}`, category: "food", kind: "category=restaurant", point: { lat: 0, lon: 0 }, s, offset: 12, side: "left", confidence });

describe("which places a busy street keeps", () => {
  it("keeps the first kilometre first, and still the best of the rest", () => {
    const near = Array.from({ length: 700 }, (_, i) => place((i * NEAR_M) / 700, i % 2 ? 0.9 : 0.6));
    const far = Array.from({ length: 500 }, (_, i) => place(NEAR_M + 1 + i * 8, i % 2 ? 0.95 : 0.55));
    const kept = keepNearFirst([...near, ...far], 800);
    expect(kept).toHaveLength(800);
    expect(kept.filter((p) => p.s > NEAR_M)).toHaveLength(FAR_MIN);
    // Within each part, the most certain first.
    expect(kept.filter((p) => p.s <= NEAR_M && p.confidence === 0.9)).toHaveLength(350);
    expect(kept.filter((p) => p.s > NEAR_M).every((p) => p.confidence === 0.95)).toBe(true);
    expect(kept.every((p, i) => i === 0 || p.s >= kept[i - 1].s)).toBe(true);
  });

  it("keeps every near place when the first kilometre is quieter, and gives the rest to the far part", () => {
    const near = Array.from({ length: 300 }, (_, i) => place(i * 3, 0.7));
    const far = Array.from({ length: 900 }, (_, i) => place(NEAR_M + 1 + i * 4, 0.7));
    const kept = keepNearFirst([...near, ...far], 800);
    expect(kept.filter((p) => p.s <= NEAR_M)).toHaveLength(300);
    expect(kept.filter((p) => p.s > NEAR_M)).toHaveLength(500);
    // A small cap still keeps a quarter for the far part.
    expect(keepNearFirst([...near, ...far], 100).filter((p) => p.s > NEAR_M)).toHaveLength(25);
  });
});

describe("how far the show goes, and how fast", () => {
  it("stops a little past the last place when nothing is mapped along the rest", () => {
    const quiet = [place(100, 0.7), place(700, 0.7), place(1000, 0.7)];
    expect(showReach(quiet, 5000)).toBe(1150);
    expect(showReach([...quiet, place(4500, 0.7)], 5000)).toBe(5000);
    expect(showReach([], 5000)).toBe(5000);
  });

  it("finds the empty stretches between places, and runs across them fast", () => {
    const places = [0, 50, 100, 150, 200, 250, 300, 350, 400, 1500, 1550].map((s) => place(s, 0.7));
    const empty = emptyStretches(places, 0, 2000);
    expect(empty).toEqual([[480, 1420]]);
    const plain = lightRun(0, 2000, [], REVEAL_PACE);
    const racing = lightRun(0, 2000, [], REVEAL_PACE, empty);
    expect(racing.duration).toBeLessThan(plain.duration);
    // Across the empty stretch it takes about a quarter of the time.
    const across = (run: typeof plain) => run.when(1300) - run.when(600);
    expect(across(racing) / across(plain)).toBeCloseTo(EMPTY_PACE, 1);
    expect(racing.when(1000)).toBeGreaterThan(racing.when(900));
  });

  it("says near places in minutes on foot, far ones in kilometres", () => {
    expect(walkText(450)).toBe("≈5 min");
    expect(walkText(30)).toBe("≈1 min");
    expect(walkText(2000)).toBe("≈24 min");
    expect(walkText(2500)).toBe("2.5 km");
    expect(walkText(-3)).toBe("here");
  });
});
