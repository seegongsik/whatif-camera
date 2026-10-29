import { describe, expect, it } from "vitest";
import { badgeAt, badgeFont, numberSigns, readSamReply, type SamSignBox } from "../src/street/sign-boxes.js";
import { MAX_SIGN_BOXES } from "../src/street/spotted.js";

const sign = (x1: number, y1: number, x2: number, y2: number, confidence?: number): SamSignBox => ({ x1, y1, x2, y2, confidence, path: "M0 0L1 0L1 1Z", ox: x1, oy: y1 });

describe("SAM 3.1's signs on the photo the model reads", () => {
  it("takes SAM's reply only when its boxes lie inside the picture", () => {
    expect(readSamReply(null)).toBeNull();
    expect(readSamReply({ width: 0, height: 10, signs: [] })).toBeNull();
    expect(readSamReply({ width: 100, height: 200, signs: "none" })).toBeNull();
    const reply = readSamReply({
      width: 100,
      height: 200,
      signs: [
        { x1: 10, y1: 20, x2: 40, y2: 30, confidence: 0.8, path: "M0 0Z", ox: 10, oy: 20 },
        { x1: 90, y1: 20, x2: 120, y2: 30 },
        { x1: 5, y1: 5, x2: 6, y2: 50 },
        { x1: "a", y1: 0, x2: 10, y2: 10 },
        { x1: 50, y1: 60, x2: 80, y2: 90, path: 7 },
      ],
    });
    expect(reply).toEqual({
      width: 100,
      height: 200,
      signs: [
        { x1: 10, y1: 20, x2: 40, y2: 30, confidence: 0.8, path: "M0 0Z", ox: 10, oy: 20 },
        // No outline: the box alone, its corner as the outline's.
        { x1: 50, y1: 60, x2: 80, y2: 90, confidence: undefined, path: "", ox: 50, oy: 60 },
      ],
    });
  });

  it("numbers the most certain signs from left to right, at most twelve", () => {
    const boxes = numberSigns([sign(300, 10, 340, 30, 0.6), sign(10, 50, 60, 70, 0.9), sign(150, 40, 200, 60, 0.7)]);
    expect(boxes.map((b) => [b.n, b.x1])).toEqual([
      [1, 10],
      [2, 150],
      [3, 300],
    ]);
    const many = Array.from({ length: 20 }, (_, i) => sign(i * 10, 0, i * 10 + 8, 8, i / 20));
    const kept = numberSigns(many);
    expect(kept).toHaveLength(MAX_SIGN_BOXES);
    // The eight least certain (the leftmost here) are left out.
    expect(kept[0].x1).toBe(80);
    expect(kept.map((b) => b.n)).toEqual(Array.from({ length: MAX_SIGN_BOXES }, (_, i) => i + 1));
  });

  it("puts a box's number just above it, or inside when the box touches the top", () => {
    expect(badgeFont(1024)).toBe(16);
    expect(badgeFont(300)).toBe(12);
    expect(badgeFont(4000)).toBe(22);
    expect(badgeAt({ x1: 40, y1: 100 }, { w: 16, h: 20 })).toEqual({ x: 38, y: 78 });
    expect(badgeAt({ x1: 0, y1: 10 }, { w: 16, h: 20 })).toEqual({ x: 0, y: 10 });
  });
});
