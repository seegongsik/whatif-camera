/**
 * Camera pitch and roll from the photo alone. A building's outer edges are
 * vertical, so in the picture they meet at the vertical vanishing point; its
 * position fixes how far the camera was tipped up and rolled. Used when the
 * photo comes without the phone's gravity reading (an upload), and as a
 * cross-check of the sensor when it does.
 */
import type { Intrinsics } from "../camera/pose.js";
import type { CornerMarks } from "./register.js";

export type Tilt = { pitchDeg: number; rollDeg: number };

const DEG = Math.PI / 180;

export function tiltFromVerticals(marks: CornerMarks, k: Intrinsics): Tilt | null {
  // Homogeneous lines through ground→roof on each side.
  const line = (a: { u: number; v: number }, b: { u: number; v: number }) => [a.v - b.v, b.u - a.u, a.u * b.v - b.u * a.v];
  const l1 = line(marks.groundLeft, marks.roofLeft);
  const l2 = line(marks.groundRight, marks.roofRight);
  const vp = [l1[1] * l2[2] - l1[2] * l2[1], l1[2] * l2[0] - l1[0] * l2[2], l1[0] * l2[1] - l1[1] * l2[0]];
  const lenL = Math.hypot(marks.roofLeft.u - marks.groundLeft.u, marks.roofLeft.v - marks.groundLeft.v);
  const lenR = Math.hypot(marks.roofRight.u - marks.groundRight.u, marks.roofRight.v - marks.groundRight.v);
  if (lenL < 10 || lenR < 10) return null;

  // Upward direction of the edges in the picture (v grows downward).
  const du = (marks.roofLeft.u - marks.groundLeft.u) / lenL + (marks.roofRight.u - marks.groundRight.u) / lenR;
  const dv = (marks.roofLeft.v - marks.groundLeft.v) / lenL + (marks.roofRight.v - marks.groundRight.v) / lenR;

  const scale = Math.max(Math.abs(vp[0]), Math.abs(vp[1]));
  if (Math.abs(vp[2]) * k.focalPx < 1e-4 * scale) {
    // Parallel edges: the camera was level; only roll remains.
    return { pitchDeg: 0, rollDeg: Math.atan2(-du, -dv) / DEG };
  }
  const a = (vp[0] / vp[2] - k.cx) / k.focalPx;
  const b = (vp[1] / vp[2] - k.cy) / k.focalPx;
  const cot = Math.hypot(a, b);
  // Which way the edges run decides whether the point is the top or the bottom one.
  const vpAbove = (vp[1] / vp[2] - marks.groundLeft.v) * dv > 0;
  const pitch = Math.atan(1 / cot) * (vpAbove ? 1 : -1);
  const roll = vpAbove ? Math.atan2(-a, -b) : Math.atan2(a, b);
  return { pitchDeg: pitch / DEG, rollDeg: roll / DEG };
}
