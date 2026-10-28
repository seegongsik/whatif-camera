/**
 * Labels for the photo: the shops ahead projected into the picture with the
 * camera that took it. The phone's compass is often 10–20° off in a street,
 * so when it points within 25° of the street's direction the camera is taken
 * to look along the street.
 */
import { intrinsicsFromLongSideFov, projectPoint, type CameraPose } from "../camera/pose.js";
import type { CaptureMeta } from "../capture/types.js";
import { localFrame, toLocal, wrapDeg, type EN } from "../geo/enu.js";
import type { ShopAhead } from "./ahead.js";
import { pointAt, type Route } from "./route.js";
import type { StreetAhead } from "./street.js";

export const SNAP_DEG = 25;
/** Eye height of a phone held up to take a picture. Assumption. */
export const EYE_HEIGHT_M = 1.5;
/** Height of a shop sign above the pavement. Assumption. */
export const SIGN_HEIGHT_M = 4;
/** Shop points sit inside buildings; signs hang on the street-facing wall, at most this far from the street's line. */
export const SIGN_OFFSET_MAX_M = 22;

export function localRoute(street: StreetAhead): Route {
  const frame = localFrame(street.origin);
  return {
    name: street.name,
    points: street.route.points.map((p) => toLocal(frame, p)),
    along: street.route.along,
    length: street.route.length,
    wayIds: [],
  };
}

export function eyePose(street: StreetAhead, capture: CaptureMeta, photo: { width: number; height: number }): CameraPose & { snapped: boolean } {
  const off = wrapDeg(street.streetHeadingDeg - capture.headingDeg);
  const snapped = Math.abs(off) <= SNAP_DEG;
  const base = intrinsicsFromLongSideFov(photo.width, photo.height, capture.fovLongDeg);
  const pp = capture.principalPoint;
  return {
    position: { x: 0, y: 0, z: EYE_HEIGHT_M },
    orientation: { headingDeg: snapped ? street.streetHeadingDeg : capture.headingDeg, pitchDeg: capture.pitchDeg, rollDeg: capture.rollDeg },
    intrinsics: pp ? { ...base, cx: pp.u, cy: pp.v } : base,
    snapped,
  };
}

/** Where a shop's sign hangs: on its side of the street, at most SIGN_OFFSET_MAX_M from the line. */
export function signSpot(route: Route, shop: ShopAhead): EN {
  const { at, headingDeg } = pointAt(route, shop.s);
  const h = (headingDeg * Math.PI) / 180;
  const right = { x: Math.cos(h), y: -Math.sin(h) };
  const off = Math.sign(shop.offset) * Math.min(Math.abs(shop.offset), SIGN_OFFSET_MAX_M);
  return { x: at.x + right.x * off, y: at.y + right.y * off };
}

export type PhotoLabel = { shop: ShopAhead; anchor: { u: number; v: number }; u: number; v: number; width: number };

/**
 * The nearest shops that fall inside the picture, nearest first, each lifted
 * above its sign until it no longer covers a nearer label.
 */
export function photoLabels(street: StreetAhead, pose: CameraPose, maxAheadM = 250, max = 10, labelHeightPx = 0): PhotoLabel[] {
  const route = localRoute(street);
  const { width, height } = pose.intrinsics;
  const lh = labelHeightPx || Math.round(height * 0.035);
  const placed: PhotoLabel[] = [];
  for (const shop of street.shops) {
    if (placed.length >= max) break;
    if (shop.s < 4 || shop.s > maxAheadM) continue;
    const spot = signSpot(route, shop);
    const p = projectPoint(pose, { x: spot.x, y: spot.y, z: SIGN_HEIGHT_M });
    if (!p || p.u < 0 || p.u > width || p.v < 0 || p.v > height) continue;
    const w = Math.min(width * 0.6, lh * (1.4 + shop.name.length * 0.55));
    let v = p.v - lh * 1.2;
    const overlaps = (y: number) => placed.some((o) => Math.abs(o.v - y) < lh * 1.15 && Math.abs(o.u - p.u) < (o.width + w) / 2);
    while (overlaps(v) && v > lh) v -= lh * 1.2;
    placed.push({ shop, anchor: { u: p.u, v: p.v }, u: p.u, v, width: w });
  }
  return placed;
}
