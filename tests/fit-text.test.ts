import { describe, expect, it } from "vitest";
import { fitText, MIN_ONE_LINE_SCALE, type MeasureLabel } from "../src/scene/fit-text.js";

// Half an em per character plus the label's padding, like a pill on the canvas.
const measure: MeasureLabel = (line, size) => line.length * 0.5 * size + size * 1.1;
const SIZE = 58;
const WIDTH = 994;

describe("overlay text fitting", () => {
  it("keeps short text on one line at its size", () => {
    expect(fitText("One photo + the map → 3D", SIZE, WIDTH, measure)).toEqual({ lines: ["One photo + the map → 3D"], size: SIZE });
  });

  it("shrinks a slightly long line a little instead of breaking it", () => {
    const fit = fitText("Imagine coming home to leafy corners", SIZE, WIDTH, measure);
    expect(fit.lines).toHaveLength(1);
    expect(fit.size).toBeLessThan(SIZE);
    expect(fit.size).toBeGreaterThanOrEqual(SIZE * MIN_ONE_LINE_SCALE);
    expect(measure(fit.lines[0], fit.size)).toBeLessThanOrEqual(WIDTH + 1e-9);
  });

  it("breaks the longest caption into two balanced lines that fit", () => {
    const caption = "Climbing vines soften the plain side walls while planters line the roof";
    const fit = fitText(caption, SIZE, WIDTH, measure);
    expect(fit.lines).toHaveLength(2);
    expect(fit.lines.join(" ")).toBe(caption);
    for (const line of fit.lines) expect(measure(line, fit.size)).toBeLessThanOrEqual(WIDTH + 1e-9);
    expect(Math.abs(fit.lines[0].length - fit.lines[1].length)).toBeLessThan(10);
    expect(fit.size).toBeGreaterThan(fitText(caption.replaceAll(" ", "_"), SIZE, WIDTH, measure).size);
  });

  it("shrinks text without spaces to fit on one line", () => {
    const fit = fitText("x".repeat(80), SIZE, WIDTH, measure);
    expect(fit.lines).toHaveLength(1);
    expect(measure(fit.lines[0], fit.size)).toBeCloseTo(WIDTH, 6);
  });
});
