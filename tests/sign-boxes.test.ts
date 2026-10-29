import { describe, expect, it } from "vitest";
import { badgeAt, badgeFont, bigEnough, numberSigns, readSamReply, signsForPlaces, type SamSignBox } from "../src/street/sign-boxes.js";
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
    const boxes = numberSigns([sign(300, 10, 340, 30, 0.6), sign(10, 50, 60, 70, 0.9), sign(150, 40, 200, 60, 0.7)], 1000);
    expect(boxes.map((b) => [b.n, b.x1])).toEqual([
      [1, 10],
      [2, 150],
      [3, 300],
    ]);
    const many = Array.from({ length: 20 }, (_, i) => sign(i * 50, 0, i * 50 + 40, 16, i / 20));
    const kept = numberSigns(many, 1000);
    expect(kept).toHaveLength(MAX_SIGN_BOXES);
    // The eight least certain (the leftmost here) are left out.
    expect(kept[0].x1).toBe(400);
    expect(kept.map((b) => b.n)).toEqual(Array.from({ length: MAX_SIGN_BOXES }, (_, i) => i + 1));
  });

  it("numbers only signs big enough to read a name on", () => {
    // On a 1024 px picture: at least 36 px wide and 14 px tall.
    expect(bigEnough(sign(0, 0, 41, 14), 1024)).toBe(true);
    expect(bigEnough(sign(0, 0, 29, 10), 1024)).toBe(false);
    expect(bigEnough(sign(0, 0, 60, 12), 1024)).toBe(false);
    // The two far signs that got each other's numbers on a test street: the smaller one is no longer numbered.
    const boxes = numberSigns([sign(188, 263, 229, 277, 0.75), sign(202, 236, 231, 246, 0.69), sign(0, 695, 191, 763, 0.75)], 1024);
    expect(boxes.map((b) => [b.n, b.x1])).toEqual([
      [1, 0],
      [2, 188],
    ]);
  });

  it("gives a place its sign only when no other place named the same box", () => {
    const boxes = numberSigns([sign(0, 0, 100, 40), sign(200, 0, 300, 40), sign(400, 0, 500, 40)], 1000);
    const signs = signsForPlaces(
      [
        { id: "a", box: 1 },
        { id: "b", box: 2 },
        { id: "c", box: 2 },
        { id: "d", box: 9 },
        { id: "e" },
      ],
      boxes,
    );
    expect([...signs.keys()]).toEqual(["a"]);
    expect(signs.get("a")?.x1).toBe(0);
  });

  it("puts a box's number just above it, or inside when the box touches the top", () => {
    expect(badgeFont(1024)).toBe(16);
    expect(badgeFont(300)).toBe(12);
    expect(badgeFont(4000)).toBe(22);
    expect(badgeAt({ x1: 40, y1: 100 }, { w: 16, h: 20 })).toEqual({ x: 38, y: 78 });
    expect(badgeAt({ x1: 0, y1: 10 }, { w: 16, h: 20 })).toEqual({ x: 0, y: 10 });
  });
});
