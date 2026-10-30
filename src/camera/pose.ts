/**
 * Which way the phone's camera points, from the browser's device orientation,
 * in local east-north-up axes: heading (compass bearing of the optical axis,
 * clockwise from north), pitch (elevation of the optical axis, up positive)
 * and roll (rotation about the optical axis, positive when the right side of
 * the picture dips).
 */
import type { ENU } from "../geo/enu.js";

export type Orientation = { headingDeg: number; pitchDeg: number; rollDeg: number };

export type Basis = { right: ENU; up: ENU; forward: ENU };

const DEG = Math.PI / 180;

export function dot(a: ENU, b: ENU): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: ENU, b: ENU): ENU {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function normalize(a: ENU): ENU {
  const n = Math.hypot(a.x, a.y, a.z);
  return n > 0 ? { x: a.x / n, y: a.y / n, z: a.z / n } : { x: 0, y: 0, z: 0 };
}

export function basisFromOrientation(o: Orientation): Basis {
  const h = o.headingDeg * DEG;
  const p = o.pitchDeg * DEG;
  const r = o.rollDeg * DEG;
  const forward = { x: Math.sin(h) * Math.cos(p), y: Math.cos(h) * Math.cos(p), z: Math.sin(p) };
  const right0 = { x: Math.cos(h), y: -Math.sin(h), z: 0 };
  const up0 = { x: -Math.sin(h) * Math.sin(p), y: -Math.cos(h) * Math.sin(p), z: Math.cos(p) };
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  return {
    forward,
    right: {
      x: cr * right0.x - sr * up0.x,
      y: cr * right0.y - sr * up0.y,
      z: cr * right0.z - sr * up0.z,
    },
    up: {
      x: sr * right0.x + cr * up0.x,
      y: sr * right0.y + cr * up0.y,
      z: sr * right0.z + cr * up0.z,
    },
  };
}

export function orientationFromBasis(up: ENU, forward: ENU): Orientation {
  const f = normalize(forward);
  const headingRad = Math.atan2(f.x, f.y);
  const pitchRad = Math.asin(Math.max(-1, Math.min(1, f.z)));
  const right0 = { x: Math.cos(headingRad), y: -Math.sin(headingRad), z: 0 };
  const up0 = {
    x: -Math.sin(headingRad) * Math.sin(pitchRad),
    y: -Math.cos(headingRad) * Math.sin(pitchRad),
    z: Math.cos(pitchRad),
  };
  const rollRad = Math.atan2(dot(up, right0), dot(up, up0));
  const heading = headingRad / DEG;
  return { headingDeg: heading < 0 ? heading + 360 : heading, pitchDeg: pitchRad / DEG, rollDeg: rollRad / DEG };
}

/**
 * Device-to-earth rotation from DeviceOrientationEvent angles, as the W3C
 * spec defines them (intrinsic Z-X'-Y'' with alpha, beta, gamma in degrees).
 * Columns are the device x (screen right), y (screen top) and z (out of the
 * screen) axes in east-north-up.
 */
export function deviceAxesFromEuler(alphaDeg: number, betaDeg: number, gammaDeg: number): {
  x: ENU;
  y: ENU;
  z: ENU;
} {
  const ca = Math.cos(alphaDeg * DEG);
  const sa = Math.sin(alphaDeg * DEG);
  const cb = Math.cos(betaDeg * DEG);
  const sb = Math.sin(betaDeg * DEG);
  const cg = Math.cos(gammaDeg * DEG);
  const sg = Math.sin(gammaDeg * DEG);
  return {
    x: { x: ca * cg - sa * sb * sg, y: sa * cg + ca * sb * sg, z: -cb * sg },
    y: { x: -sa * cb, y: ca * cb, z: sb },
    z: { x: ca * sg + sa * sb * cg, y: sa * sg - ca * sb * cg, z: cb * cg },
  };
}

/**
 * Camera orientation for a phone held in portrait: the back camera looks
 * along the device's -z axis, the picture's up is the device's +y axis.
 */
export function orientationFromEuler(alphaDeg: number, betaDeg: number, gammaDeg: number): Orientation {
  const axes = deviceAxesFromEuler(alphaDeg, betaDeg, gammaDeg);
  return orientationFromBasis(axes.y, { x: -axes.z.x, y: -axes.z.y, z: -axes.z.z });
}

/**
 * iOS reports alpha against an arbitrary start, and the compass separately
 * (webkitCompassHeading). Returns the alpha that makes the camera heading
 * equal to that compass heading. Turning alpha up turns the heading down by
 * the same angle, so the offset is a plain difference.
 */
export function alphaForCompassHeading(betaDeg: number, gammaDeg: number, compassHeadingDeg: number): number {
  const atZero = orientationFromEuler(0, betaDeg, gammaDeg).headingDeg;
  const alpha = (atZero - compassHeadingDeg) % 360;
  return alpha < 0 ? alpha + 360 : alpha;
}

