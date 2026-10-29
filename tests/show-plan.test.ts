import { describe, expect, it } from "vitest";
import type { ShopAhead } from "../src/street/ahead.js";
import { SHOP_CATEGORIES } from "../src/street/osm.js";
import {
  brandCounts,
  chaseTrack,
  dotOffset,
  fameScore,
  followPose,
  GROUPS,
  groupOf,
  histogram,
  kindWord,
  landmarkCount,
  lerpPose,
  lightRun,
  overviewPose,
  pickGroup,
  pickLandmarks,
  project,
  radarPose,
  REVEAL_PACE,
  sampleRoute,
  screenSide,
  streetCores,
  type View,
} from "../src/street/show-plan.js";
import { localRoute } from "../src/street/street.js";
import { syntheticStreet } from "../src/street/synthetic.js";

let nextId = 1;
function shop(s: number, name: string, kind: string, extra: Partial<ShopAhead> = {}): ShopAhead {
  return {
    id: `t${nextId++}`,
    name,
    category: "shop",
    kind: `category=${kind}`,
    point: { lat: 0, lon: 0 },
    s,
    offset: 15,
    side: "right",
    confidence: 0.9,
    ...extra,
  };
}

const view: View = { width: 390, height: 844, fovDeg: 50 };

describe("kinds of place", () => {
  it("put every category in exactly one chip", () => {
    for (const category of SHOP_CATEGORIES) expect(GROUPS.filter((g) => g.categories.includes(category))).toHaveLength(1);
    expect(groupOf("fashion").key).toBe("shop");
    expect(groupOf("fun").label).toBe("Entertainment");
  });

  it("read a kind as words", () => {
    expect(kindWord("category=jewelry_store")).toBe("jewelry store");
    expect(kindWord("amenity=cafe")).toBe("cafe");
  });
});

describe("landmarks", () => {
  it("rank sights and one-off brands above clinics, chain cafés and addresses", () => {
    const museum = shop(900, "City Museum of Art", "art_museum", { category: "fun" });
    const flagship = shop(1200, "Northwind Flagship", "clothing_store", { brand: "Northwind", category: "fashion" });
    const clinic = shop(1500, "Smile Dental", "dental_clinic", { category: "health" });
    const cafe = shop(1800, "Bean Corner", "coffee_shop", { brand: "Bean Corner", category: "cafe" });
    const address = shop(2100, "608 Main Avenue", "shopping_mall");
    const all = [museum, flagship, clinic, cafe, address];
    const brands = brandCounts(all);
    const score = (x: ShopAhead) => fameScore(x, brands);
    expect(score(museum)).toBeGreaterThan(score(flagship));
    expect(score(flagship)).toBeGreaterThan(score(cafe));
    expect(score(cafe)).toBeGreaterThan(score(clinic));
    expect(score(address)).toBeLessThan(score(shop(2100, "Main Mall", "shopping_mall")));
  });

  it("count a brand seen many times on the street as a chain", () => {
    const chain = [0, 400, 800, 1200].map((s) => shop(s, "Quick Mart", "clothing_store", { brand: "Quick Mart" }));
    const once = shop(1600, "Solo Store", "clothing_store", { brand: "Solo" });
    const brands = brandCounts([...chain, once]);
    expect(fameScore(once, brands)).toBeGreaterThan(fameScore(chain[0], brands));
  });

  it("know what a place named after the street carries in its name", () => {
    expect(streetCores("Robson Street")).toEqual(["robson"]);
    expect(streetCores("5th Avenue")).toEqual(["5th", "fifth"]);
    expect(streetCores("강남대로")).toEqual(["강남대로"]);
    expect(streetCores(undefined)).toEqual([]);
    const brands = new Map<string, number>();
    const named = shop(300, "Apple Fifth Avenue", "electronics_store", { brand: "Apple" });
    const plain = shop(300, "Apple", "electronics_store", { brand: "Apple" });
    expect(fameScore(named, brands, streetCores("5th Avenue"))).toBeGreaterThan(fameScore(plain, brands, streetCores("5th Avenue")));
  });

  it("are spread out, in order, at most one per 600 m, and at least three", () => {
    const shops: ShopAhead[] = [];
    for (let s = 0; s < 5000; s += 50) shops.push(shop(s, `Museum ${s}`, "museum", { category: "fun" }));
    const picked = pickLandmarks(shops, 5000);
    expect(picked.length).toBe(landmarkCount(5000));
    expect(picked.map((p) => p.s)).toEqual([...picked.map((p) => p.s)].sort((a, b) => a - b));
    for (let i = 1; i < picked.length; i += 1) expect(picked[i].s - picked[i - 1].s).toBeGreaterThanOrEqual(150);
    // Plain places only: still three to stop at.
    const plain = [100, 900, 1700, 2500].map((s) => shop(s, `Shop ${s}`, "clothing_store", { confidence: 0.6 }));
    expect(pickLandmarks(plain, 3000)).toHaveLength(3);
  });

  it("for a chip, come from that kind only", () => {
    const cafes = [200, 1200, 2200].map((s) => shop(s, `Cafe ${s}`, "coffee_shop", { category: "cafe" }));
    const others = [700, 1700].map((s) => shop(s, `Bar ${s}`, "bar", { category: "bar" }));
    const picked = pickGroup([...cafes, ...others], GROUPS.find((g) => g.key === "cafe")!, 3000);
    expect(picked.map((p) => p.name)).toEqual(["Cafe 200", "Cafe 1200", "Cafe 2200"]);
  });
});

describe("the light", () => {
  it("runs from start to end, never backwards, and slows down at each stop", () => {
    const run = lightRun(-20, 5000, [1500, 3500], REVEAL_PACE);
    expect(run.at(0)).toBe(-20);
    expect(run.at(run.duration)).toBe(5000);
    let last = -Infinity;
    for (let t = 0; t <= run.duration; t += 0.05) {
      const s = run.at(t);
      expect(s).toBeGreaterThanOrEqual(last - 1e-9);
      last = s;
      expect(run.when(s)).toBeCloseTo(t, 1);
    }
    const travel = (5020 / 1000) * REVEAL_PACE.secondsPerKm;
    expect(run.duration).toBeCloseTo(travel + 2 * REVEAL_PACE.dwell + 2 * REVEAL_PACE.ease, 1);
    const speed = (s: number) => 1 / (run.when(s + 1) - run.when(s - 1)) * 2;
    expect(speed(1500)).toBeLessThan(0.2 * speed(2500));
  });

  it("is chased by the camera, which lags behind and then arrives", () => {
    const run = lightRun(0, 3000, [1500], REVEAL_PACE);
    const chase = chaseTrack(run);
    expect(chase(0)).toBe(0);
    for (let t = 0.1; t < run.duration; t += 0.1) expect(chase(t)).toBeLessThanOrEqual(run.at(t) + 1e-6);
    expect(chase(run.duration * 0.3)).toBeLessThan(run.at(run.duration * 0.3) - 50);
    expect(chase(run.duration + 5)).toBeCloseTo(3000, 0);
  });
});

describe("the camera", () => {
  it("puts what it looks at in the middle, east on the right when facing north", () => {
    const pose = { x: 100, y: 200, yawDeg: 0, pitchDeg: 40, distance: 500 };
    const centre = project(pose, view, { x: 100, y: 200 })!;
    expect(centre.x).toBeCloseTo(195, 6);
    expect(centre.y).toBeCloseTo(422, 6);
    expect(project(pose, view, { x: 150, y: 200 })!.x).toBeGreaterThan(195);
    // Further along the view is higher on the screen.
    expect(project(pose, view, { x: 100, y: 400 })!.y).toBeLessThan(422);
    // Behind the camera: not drawn.
    expect(project(pose, view, { x: 100, y: -2000 })).toBeNull();
  });

  it("from straight above, puts the heading at the top of the screen", () => {
    const pose = { ...radarPose(90), distance: 400 };
    const east = project(pose, view, { x: 100, y: 0 })!;
    expect(east.y).toBeLessThan(422);
    expect(east.x).toBeCloseTo(195, 6);
  });

  it("turns the short way round", () => {
    const a = { x: 0, y: 0, yawDeg: 350, pitchDeg: 30, distance: 100 };
    const b = { x: 0, y: 0, yawDeg: 10, pitchDeg: 60, distance: 400 };
    const mid = lerpPose(a, b, 0.5);
    expect(((mid.yawDeg % 360) + 360) % 360).toBeCloseTo(0, 6);
    expect(mid.pitchDeg).toBeCloseTo(45, 6);
    expect(mid.distance).toBeCloseTo(200, 6);
  });

  it("follows the light from behind, with the light on the screen", () => {
    const route = localRoute(syntheticStreet());
    const pose = followPose(route, 600);
    const head = project(pose, view, { x: route.points[0].x, y: 600 })!;
    expect(head.x).toBeGreaterThan(0);
    expect(head.x).toBeLessThan(view.width);
    expect(head.y).toBeGreaterThan(view.height / 2);
    expect(head.y).toBeLessThan(view.height);
  });

  it("fits the whole street inside the room it is given", () => {
    const route = localRoute(syntheticStreet());
    const { points } = sampleRoute(route, 50);
    const insets = { top: 200, right: 50, bottom: 180, left: 30 };
    const pose = overviewPose(points, view, insets);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of points) {
      const q = project(pose, view, p)!;
      xs.push(q.x);
      ys.push(q.y);
      expect(q.x).toBeGreaterThanOrEqual(insets.left - 0.5);
      expect(q.x).toBeLessThanOrEqual(view.width - insets.right + 0.5);
      expect(q.y).toBeGreaterThanOrEqual(insets.top - 0.5);
      expect(q.y).toBeLessThanOrEqual(view.height - insets.bottom + 0.5);
    }
    // Tight in at least one direction, so the street is as large as it can be.
    const usedX = (Math.max(...xs) - Math.min(...xs)) / (view.width - insets.left - insets.right);
    const usedY = (Math.max(...ys) - Math.min(...ys)) / (view.height - insets.top - insets.bottom);
    expect(Math.max(usedX, usedY)).toBeGreaterThan(0.97);
  });
});

describe("places in the picture", () => {
  it("get their tags on the screen side that matches their side of the street", () => {
    const route = localRoute(syntheticStreet());
    // Looking north, up the street: its left is the screen's left.
    const up = { x: 0, y: 300, yawDeg: 0, pitchDeg: 50, distance: 800 };
    const alongUp = (p: { x: number; y: number }) => project(up, view, p);
    expect(screenSide(alongUp, route, { s: 300, side: "left" })).toBe("left");
    expect(screenSide(alongUp, route, { s: 300, side: "right" })).toBe("right");
    // Looking south, the street comes down the screen: its left is the screen's right.
    const down = { ...up, yawDeg: 180 };
    expect(screenSide((p) => project(down, view, p), route, { s: 300, side: "left" })).toBe("right");
  });

  it("stand beside the street on their side, neither on the line nor far off", () => {
    expect(dotOffset(shop(0, "a", "x", { offset: 2, side: "right" }))).toBe(8);
    expect(dotOffset(shop(0, "a", "x", { offset: -60, side: "left" }))).toBe(-24);
    expect(dotOffset(shop(0, "a", "x", { offset: 15, side: "right" }))).toBe(15);
  });

  it("are counted per stretch for the rail", () => {
    expect(histogram([{ s: 10 }, { s: 20 }, { s: 990 }, { s: 1000 }, { s: -5 }], 1000, 4)).toEqual([3, 0, 0, 2]);
  });
});
