import { describe, expect, it } from "vitest";
import { fitName, labelFont, layoutLabels, type LabelInput } from "../src/street/street-labels.js";

// A fixed-width "font": every character is 0.6 em wide.
const measure = (text: string, font: number) => text.length * font * 0.6;
const tag = (key: string, x: number, y: number, ahead: number, name = `Place ${key}`): LabelInput<string> => ({ key, x, y, ahead, name, detail: `${ahead} m`, item: key });
const area = { left: 6, top: 100, right: 384, bottom: 700 };

describe("name tags on the street", () => {
  it("are large when near, smaller further on, never tiny", () => {
    expect(labelFont(0)).toBe(16);
    expect(labelFont(90)).toBe(14);
    expect(labelFont(1000)).toBe(11);
  });

  it("cut long names with an ellipsis", () => {
    expect(fitName("Short", 16, measure)).toBe("Short");
    const cut = fitName("A very long name for a shop on the avenue", 16, measure);
    expect(cut.endsWith("…")).toBe(true);
    expect(measure(cut, 16)).toBeLessThanOrEqual(190);
  });

  it("put the nearest first and never on top of one another", () => {
    const placed = layoutLabels([tag("far", 200, 400, 120), tag("near", 200, 405, 20), tag("side", 330, 600, 40)], measure, area);
    expect(placed.map((p) => p.key)).toEqual(["near", "side", "far"]);
    // The far one would cover the near one: it is lifted on a leader line.
    const far = placed.find((p) => p.key === "far")!;
    const near = placed.find((p) => p.key === "near")!;
    expect(far.lifted).toBe(true);
    expect(far.box.y + far.box.h).toBeLessThanOrEqual(near.box.y);
    for (const a of placed) for (const b of placed) if (a !== b) expect(a.box.x + a.box.w <= b.box.x || b.box.x + b.box.w <= a.box.x || a.box.y + a.box.h <= b.box.y || b.box.y + b.box.h <= a.box.y).toBe(true);
  });

  it("leave a pin without a tag when there is no room, under the bars or the small map", () => {
    const crowd = Array.from({ length: 6 }, (_, i) => tag(String(i), 200, 400, 10 + i));
    expect(layoutLabels(crowd, measure, area).length).toBeLessThan(6);
    expect(layoutLabels([tag("top", 200, 90, 50)], measure, area)).toHaveLength(0);
    expect(layoutLabels([tag("low", 200, 760, 5)], measure, area)).toHaveLength(0);
    const blocked = [{ x: 250, y: 300, w: 130, h: 130 }];
    expect(layoutLabels([tag("map", 320, 420, 50)], measure, { ...area, blocked })).toHaveLength(0);
    expect(layoutLabels([tag("free", 100, 420, 50)], measure, { ...area, blocked })).toHaveLength(1);
  });

  it("stay on screen", () => {
    const [edge] = layoutLabels([tag("edge", 384, 400, 30, "A long name at the edge")], measure, area);
    expect(edge.box.x + edge.box.w).toBeLessThanOrEqual(384);
  });
});
