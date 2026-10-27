import { describe, expect, it } from "vitest";
import { compassWord, localPlan, parsePlan, sanitizeText } from "../src/design/plan.js";

const facts = {
  heightM: 18.6,
  floors: 6,
  roofAreaM2: 216,
  widthM: 18,
  depthM: 12,
  mainFacadeFacing: "south",
  hemisphere: "north" as const,
};

describe("design plan", () => {
  it("plans a roof garden on a roomy roof and green corners on a tall building", () => {
    const plan = localPlan(facts);
    expect(plan.source).toBe("local");
    expect(plan.roof.deck).toBe(true);
    expect(plan.roof.pergola).toBe(true);
    expect(plan.roof.trees).toBe(3);
    expect(plan.facade.vines).toBe("corners");
    expect(plan.captions.join(" ")).not.toMatch(/\d/);
  });

  it("keeps a small roof simple", () => {
    const plan = localPlan({ ...facts, roofAreaM2: 15, floors: 3 });
    expect(plan.roof.planters).toBe("none");
    expect(plan.roof.trees).toBe(0);
    expect(plan.facade.vines).toBe("full");
  });

  it("refuses something that is not an object", () => {
    expect(() => parsePlan("roof garden", facts, "muse-spark-open")).toThrow();
    expect(() => parsePlan([1], facts, "muse-spark-open")).toThrow();
  });

  it("notes every fallback it makes", () => {
    const { plan, notes } = parsePlan({}, facts, "muse-spark-open");
    expect(plan.title).toBe(localPlan(facts).title);
    expect(notes.length).toBe(2);
  });

  it("strips digits and control characters and shortens long text", () => {
    expect(sanitizeText("Floor 3\u0007 of 12", 40)).toBe("Floor of");
    expect(sanitizeText("word ".repeat(30), 20).endsWith("…")).toBe(true);
  });

  it("names compass directions", () => {
    expect(compassWord(0)).toBe("north");
    expect(compassWord(134)).toBe("south-east");
    expect(compassWord(359)).toBe("north");
  });
});
