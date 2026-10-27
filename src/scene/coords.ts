/**
 * three.js works y-up; the estimates work east-north-up. World axes here:
 * x east, y up, z south. The mapping (e, n, u) → (e, u, -n) is a rotation,
 * so handedness and angles carry over.
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import type { EN, ENU } from "../geo/enu.js";
import { basisFromOrientation, type Orientation } from "../camera/pose.js";

export function toWorld(p: ENU): Vector3 {
  return new Vector3(p.x, p.z, -p.y);
}

export function toWorldAt(p: EN, z: number): Vector3 {
  return new Vector3(p.x, z, -p.y);
}

export function quaternionFor(o: Orientation): Quaternion {
  const b = basisFromOrientation(o);
  const back = { x: -b.forward.x, y: -b.forward.y, z: -b.forward.z };
  const m = new Matrix4().makeBasis(toWorld(b.right), toWorld(b.up), toWorld(back));
  return new Quaternion().setFromRotationMatrix(m);
}

/** Rotation about world y that turns local +x towards the east-north direction `angleRad` (from east, counter-clockwise). */
export function yawFor(angleRad: number): number {
  return angleRad;
}

/** Rotation about world y that turns a plane's +z normal to face the east-north direction `normal`. */
export function faceToward(normal: EN): number {
  return Math.atan2(normal.x, -normal.y);
}
