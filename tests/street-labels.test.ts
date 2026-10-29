import { describe, expect, it } from "vitest";
import { fitText, layoutLabels, ROAD_GAP, roadSpan, wrapText, type LabelInput, type Side } from "../src/street/street-labels.js";

// A fixed-width "font": every character is 0.6 em wide.
const measure = (text: string, font: number) => text.length * font * 0.6;
const area = { left: 8, top: 100, right: 344, bottom: 700 };
// A street running straight up the middle of the screen.
const straight = [
  [
    { x: 176, y: 900 },
    { x: 176, y: 0 },
  ],
];
const tag = (side: Side, x: number, y: number, priority = 0, name = `Place ${side} ${x} ${y}`): LabelInput<string> => ({
  key: name,
  x,
  y,
  side,
  priority,
  name,
  detail: "120 M · CAFE",
  item: name,
  font: 13,
});

describe("name tags beside the street", () => {
  it("cut long texts with an ellipsis", () => {
    const width = (t: string) => measure(t, 13);
    expect(fitText("Short", 190, width)).toBe("Short");
    const cut = fitText("A very long name for a shop on the avenue", 190, width);
    expect(cut.endsWith("…")).toBe(true);
    expect(width(cut)).toBeLessThanOrEqual(190);
  });

  it("wrap a long name onto two lines, carrying whole words, and cut only what is left over", () => {
    const width = (t: string) => measure(t, 13);
    expect(wrapText("Short", 120, width)).toEqual(["Short"]);
    expect(wrapText("Access at The Metropolitan Museum", 120, width)).toEqual(["Access at The", "Metropolitan M…"]);
    const lines = wrapText("그라운드시소한남점플래그십스토어", 80, width);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(width(line)).toBeLessThanOrEqual(80);
  });

  it("know where the street's line crosses a band of the screen", () => {
    expect(roadSpan(straight, 300, 340)).toEqual({ min: 176, max: 176 });
    const diagonal = [
      [
        { x: 100, y: 800 },
        { x: 300, y: 0 },
      ],
    ];
    const span = roadSpan(diagonal, 400, 500)!;
    expect(span.min).toBeCloseTo(175, 6);
    expect(span.max).toBeCloseTo(200, 6);
    expect(roadSpan(straight, 1000, 1100)).toBeNull();
  });

  it("go on the place's side of the street, clear of its line", () => {
    const placed = layoutLabels([tag("left", 170, 300), tag("right", 182, 300), tag("left", 168, 500)], measure, area, straight);
    expect(placed).toHaveLength(3);
    for (const p of placed) {
      if (p.side === "left") expect(p.box.x + p.box.w).toBeLessThanOrEqual(176 - ROAD_GAP + 1e-6);
      else expect(p.box.x).toBeGreaterThanOrEqual(176 + ROAD_GAP - 1e-6);
      expect(p.box.x).toBeGreaterThanOrEqual(area.left);
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(area.right);
    }
  });

  it("stack in order down each side, never on top of one another", () => {
    const crowd = [300, 305, 310, 315, 320].map((y, i) => tag("left", 170, y, i, `Crowd ${i}`));
    const placed = layoutLabels(crowd, measure, area, straight);
    expect(placed.map((p) => p.key)).toEqual(crowd.map((c) => c.key));
    for (let i = 1; i < placed.length; i += 1) expect(placed[i].box.y).toBeGreaterThanOrEqual(placed[i - 1].box.y + placed[i - 1].box.h);
  });

  it("stay between the top bar and the bottom (the caption), and skip places far outside", () => {
    const [low] = layoutLabels([tag("right", 182, 690)], measure, area, straight);
    expect(low.box.y + low.box.h).toBeLessThanOrEqual(area.bottom);
    const [high] = layoutLabels([tag("right", 182, 105)], measure, area, straight);
    expect(high.box.y).toBeGreaterThanOrEqual(area.top);
    expect(layoutLabels([tag("right", 182, 800)], measure, area, straight)).toHaveLength(0);
  });

  it("keep the most important tags when a side is full", () => {
    const many = Array.from({ length: 30 }, (_, i) => tag("left", 170, 400, i, `Many ${i}`));
    const keys = layoutLabels(many, measure, area, straight, 30).map((p) => p.key);
    expect(keys.length).toBeLessThan(30);
    expect(keys).toContain("Many 0");
    expect(keys).not.toContain("Many 29");
  });

  it("cut a name to the room on its side, and leave the tag out where there is none", () => {
    const nearEdge = [
      [
        { x: 40, y: 900 },
        { x: 40, y: 0 },
      ],
    ];
    expect(layoutLabels([tag("left", 34, 300)], measure, area, nearEdge)).toHaveLength(0);
    const [right] = layoutLabels([tag("right", 46, 300, 0, "A very long name for a place on the right side of a very long avenue")], measure, area, nearEdge);
    expect(right.lines).toHaveLength(2);
    expect(right.lines[1].endsWith("…")).toBe(true);
    expect(right.box.x + right.box.w).toBeLessThanOrEqual(area.right + 1e-6);
  });

  it("follow a bending street: each tag clears the line at its own height", () => {
    const bend = [
      [
        { x: 150, y: 700 },
        { x: 150, y: 400 },
        { x: 260, y: 150 },
      ],
    ];
    const placed = layoutLabels([tag("left", 140, 600), tag("left", 200, 250)], measure, area, bend);
    expect(placed).toHaveLength(2);
    for (const p of placed) {
      const span = roadSpan(bend, p.box.y - ROAD_GAP / 2, p.box.y + p.box.h + ROAD_GAP / 2)!;
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(span.min - ROAD_GAP + 1e-6);
    }
  });

  it("move just above or below something in the way instead of leaving it out", () => {
    const you = { x: 190, y: 290, w: 24, h: 33 };
    const [moved] = layoutLabels([tag("right", 182, 300)], measure, { ...area, blocked: [you] }, straight);
    expect(moved).toBeDefined();
    const b = moved.box;
    expect(b.y + b.h <= you.y || b.y >= you.y + you.h).toBe(true);
  });

  it("keep their padding in proportion to their font", () => {
    const wide = { ...area, right: 1000 };
    const [small] = layoutLabels([{ ...tag("right", 182, 400, 0, "Place"), font: 15 }], measure, wide, straight);
    const [large] = layoutLabels([{ ...tag("right", 182, 400, 0, "Place"), font: 30 }], measure, wide, straight);
    expect(large.box.h).toBeCloseTo(small.box.h * 2, 6);
    expect(large.box.w).toBeCloseTo(small.box.w * 2, 6);
  });
});
