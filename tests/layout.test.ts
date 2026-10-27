import { describe, expect, it } from "vitest";
import { layoutDesign } from "../src/design/layout.js";
import { localPlan } from "../src/design/plan.js";
import { insetRing, pointInRing } from "../src/geo/polygon.js";
import { rect } from "./scene-fixture.js";

const ring = rect(0, 0, 18, 12, 20);
const facts = { heightM: 18.6, floors: 6, roofAreaM2: 216, widthM: 18, depthM: 12, mainFacadeFacing: "south", hemisphere: "north" as const };

describe("layout", () => {
  const plan = localPlan(facts);
  const layout = layoutDesign({ id: "way/1", ring, heightM: 18.6, floors: 6, floorHeightM: 3.1, mainFacade: 0, plan });

  it("keeps every roof item on the roof", () => {
    for (const p of layout.planters) {
      expect(pointInRing(p.a, ring)).toBe(true);
      expect(pointInRing(p.b, ring)).toBe(true);
    }
    for (const t of layout.trees) expect(pointInRing(t.p, ring)).toBe(true);
    for (const s of layout.shrubs) expect(s.z).toBeCloseTo(18.6 + 0.45);
    expect(layout.deck).not.toBeNull();
    expect(layout.pergola).not.toBeNull();
  });

  it("keeps the pergola clear of the roof edge and trees out of it", () => {
    const inner = insetRing(ring, 1.3)!;
    expect(pointInRing(layout.pergola!.center, inner)).toBe(true);
    expect(layout.trees).toHaveLength(plan.roof.trees);
  });

  it("is the same garden every time for the same building", () => {
    const again = layoutDesign({ id: "way/1", ring, heightM: 18.6, floors: 6, floorHeightM: 3.1, mainFacade: 0, plan });
    expect(again).toEqual(layout);
  });

  it("grows stems up the walls but not over the roof", () => {
    expect(layout.vines.length).toBeGreaterThan(0);
    expect(layout.vines.length).toBeLessThanOrEqual(48);
    for (const v of layout.vines) for (const p of v.points) expect(p.z).toBeLessThan(18.6);
  });

  it("drops what does not fit on a tiny roof", () => {
    const tiny = rect(0, 0, 4, 3, 0);
    const small = layoutDesign({ id: "way/2", ring: tiny, heightM: 6, floors: 2, floorHeightM: 3, mainFacade: 0, plan });
    expect(small.pergola).toBeNull();
    expect(small.deck).toBeNull();
  });
});
