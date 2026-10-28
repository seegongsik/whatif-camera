/**
 * The shot list. The camera starts exactly where the photo was taken, so
 * the first frame is the photo. It then stays on the photo's side of the
 * building, where the picture covers the scene: it pushes in, swings toward
 * the main facade, rises to look onto the roof and returns to the same spot
 * for the before/after. Camera moves are smooth monotone splines through key
 * poses; everything else is a fade window in seconds.
 */
import { basisFromOrientation, verticalFovDeg, type Orientation } from "../camera/pose.js";
import { wrapDeg, type ENU } from "../geo/enu.js";
import { centroid, edges } from "../geo/polygon.js";
import type { BuildingSpec } from "../estimate/spec.js";
import type { DesignPlan } from "../design/plan.js";
import type { DecorChannel } from "./decor.js";

const DEG = Math.PI / 180;

export type ShotState = {
  /** shift: where the optical axis sits off the frame's centre, in frame heights (a cropped photo). */
  pose: { position: ENU; orientation: Orientation; vfovDeg: number; shift: { x: number; y: number } };
  envPhoto: number;
  targetPhoto: number;
  /** 1 while the photo's foreground is left out of the projection. */
  foregroundCut: number;
  fog: number;
  edges: number;
  floors: number;
  dims: number;
  dimsFade: number;
  decor: Record<DecorChannel, number>;
  evening: number;
  lightsOn: number;
  washOn: number;
  caption: { text: string; sub?: string; alpha: number } | null;
  title: { text: string; alpha: number } | null;
  wipe: number | null;
  endCard: number;
};

type Orbit = {
  tx: number;
  ty: number;
  tz: number;
  theta: number;
  phi: number;
  dist: number;
  roll: number;
  fov: number;
  /** Optical axis off the frame's centre, in frame heights. */
  sx: number;
  sy: number;
};

const CHANNELS: (keyof Orbit)[] = ["tx", "ty", "tz", "theta", "phi", "dist", "roll", "fov", "sx", "sy"];

/** Fritsch–Carlson monotone cubic through (t, y): smooth, and never overshoots a hold. */
export function monotoneSpline(ts: number[], ys: number[]): (t: number) => number {
  const n = ts.length;
  const d: number[] = [];
  for (let k = 0; k < n - 1; k += 1) d.push((ys[k + 1] - ys[k]) / (ts[k + 1] - ts[k]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k += 1) m[k] = d[k - 1] * d[k] > 0 ? (d[k - 1] + d[k]) / 2 : 0;
  for (let k = 0; k < n - 1; k += 1) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[k] = tau * a * d[k];
      m[k + 1] = tau * b * d[k];
    }
  }
  return (t: number) => {
    if (t <= ts[0]) return ys[0];
    if (t >= ts[n - 1]) return ys[n - 1];
    let k = 0;
    while (k < n - 2 && t > ts[k + 1]) k += 1;
    const h = ts[k + 1] - ts[k];
    const u = (t - ts[k]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * ys[k] +
      (u3 - 2 * u2 + u) * h * m[k] +
      (-2 * u3 + 3 * u2) * ys[k + 1] +
      (u3 - u2) * h * m[k + 1]
    );
  };
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** 0 before a, 1 after b, smooth between. */
export function ramp(t: number, a: number, b: number): number {
  return smooth((t - a) / (b - a));
}

/** Up over [a, b], held, down over [c, d]. */
function window(t: number, a: number, b: number, c: number, d: number): number {
  return Math.min(ramp(t, a, b), 1 - ramp(t, c, d));
}

export function photoOrbit(spec: BuildingSpec): Orbit {
  const pose = spec.pose;
  const f = basisFromOrientation(pose.orientation).forward;
  const c = centroid(spec.target.ring);
  const rel = { x: c.x - pose.position.x, y: c.y - pose.position.y, z: spec.height.heightM / 2 - pose.position.z };
  const df = Math.max(8, rel.x * f.x + rel.y * f.y + rel.z * f.z);
  return {
    tx: pose.position.x + f.x * df,
    ty: pose.position.y + f.y * df,
    tz: pose.position.z + f.z * df,
    theta: pose.orientation.headingDeg + 180,
    phi: -pose.orientation.pitchDeg,
    dist: df,
    roll: pose.orientation.rollDeg,
    fov: verticalFovDeg(pose.intrinsics),
    sx: (pose.intrinsics.cx - pose.intrinsics.width / 2) / pose.intrinsics.height,
    sy: (pose.intrinsics.cy - pose.intrinsics.height / 2) / pose.intrinsics.height,
  };
}

export function orbitPose(o: Orbit): ShotState["pose"] {
  const th = o.theta * DEG;
  const ph = o.phi * DEG;
  const position = {
    x: o.tx + o.dist * Math.sin(th) * Math.cos(ph),
    y: o.ty + o.dist * Math.cos(th) * Math.cos(ph),
    z: o.tz + o.dist * Math.sin(ph),
  };
  const fx = o.tx - position.x;
  const fy = o.ty - position.y;
  const fz = o.tz - position.z;
  const n = Math.hypot(fx, fy, fz) || 1;
  const heading = Math.atan2(fx, fy) / DEG;
  return {
    position,
    orientation: { headingDeg: heading < 0 ? heading + 360 : heading, pitchDeg: Math.asin(fz / n) / DEG, rollDeg: o.roll },
    vfovDeg: o.fov,
    shift: { x: o.sx, y: o.sy },
  };
}

export type Timeline = { duration: number; at(t: number): ShotState };

/** Vertical field of view of the moving shots. */
const MOVE_FOV_DEG = 50;

export function makeTimeline(spec: BuildingSpec, plan: DesignPlan): Timeline {
  const start = photoOrbit(spec);
  const c = centroid(spec.target.ring);
  const h = spec.height.heightM;
  const reach = Math.hypot(c.x - spec.pose.position.x, c.y - spec.pose.position.y);
  // Swing toward the way the main facade faces, so it turns to the camera.
  const main = edges(spec.target.ring)[spec.mainFacade];
  const toward = Math.sign(wrapDeg(Math.atan2(main.normal.x, main.normal.y) / DEG - start.theta)) || 1;
  // Small moves: every metre the camera travels from the photo shows more of
  // what the picture could not see. eyeM is the camera height to reach.
  const near = (swingDeg: number, eyeM: number, share: number, tz: number): Orbit => {
    const dist = reach * share;
    return {
      tx: c.x,
      ty: c.y,
      tz,
      theta: start.theta + toward * swingDeg,
      phi: Math.asin(Math.max(-0.9, Math.min(0.9, (eyeM - tz) / dist))) / DEG,
      dist,
      roll: 0,
      fov: MOVE_FOV_DEG,
      // Keep the photo's framing: the building low in the frame, under its sky.
      sx: start.sx,
      sy: Math.max(start.sy, 0.1),
    };
  };
  const eye = spec.pose.position.z;
  const keys: [number, Orbit][] = [
    [0, start],
    [1.6, start],
    [6.0, near(5, eye + 2, 0.9, h * 0.85)],
    [10.5, near(8, (eye + h) / 2, 0.78, h * 0.9)],
    [16.5, near(4, h + 6, 0.58, h)],
    [19.6, near(-4, h + 3, 0.68, h * 0.9)],
    [22.6, start],
    [27.5, start],
  ];
  const times = keys.map((k) => k[0]);
  const splines = Object.fromEntries(
    CHANNELS.map((ch) => [ch, monotoneSpline(times, keys.map((k) => k[1][ch]))]),
  ) as Record<keyof Orbit, (t: number) => number>;

  const floorsText =
    spec.height.floorsSource === "OpenStreetMap building:levels"
      ? `${spec.height.floors} floors`
      : `about ${spec.height.floors} floors`;
  const numbers = `≈ ${h.toFixed(1)} m tall · ${floorsText}`;
  const numbersSub =
    spec.height.floorsSource === "OpenStreetMap building:levels"
      ? "height: AI estimate from photo + map · floors: OpenStreetMap"
      : "AI estimate from one photo + the map";
  const captions: [number, number, string, string?][] = [
    [1.9, 4.9, "One photo + the map → 3D"],
    [6.7, 10.1, numbers, numbersSub],
    [10.6, 13.4, plan.captions[0] ?? ""],
    [13.6, 16.4, plan.captions[1] ?? ""],
    [16.8, 19.8, plan.captions[2] ?? ""],
    [22.8, 26.0, "Before  ·  After"],
  ];

  return {
    duration: 27.5,
    at(t: number): ShotState {
      const orbit = Object.fromEntries(CHANNELS.map((ch) => [ch, splines[ch](t)])) as Orbit;
      let caption: ShotState["caption"] = null;
      for (const [a, b, text, sub] of captions) {
        if (!text) continue;
        const alpha = window(t, a, a + 0.45, b - 0.45, b);
        if (alpha > 0) caption = { text, sub, alpha };
      }
      const wipeT = ramp(t, 23.0, 24.4) - 0.5 * ramp(t, 24.6, 25.6);
      return {
        pose: orbitPose(orbit),
        // The photo stays on everything it saw; facades fill in the rest.
        envPhoto: 1,
        targetPhoto: 1,
        foregroundCut: ramp(t, 1.7, 3.2) - ramp(t, 20.8, 22.4),
        fog: 0.85 * (ramp(t, 2.6, 5.4) - ramp(t, 20.2, 22.0)),
        edges: ramp(t, 4.6, 6.6) - ramp(t, 20.0, 21.6),
        floors: ramp(t, 7.2, 9.6),
        dims: ramp(t, 6.4, 8.8),
        dimsFade: 1 - ramp(t, 12.2, 13.2),
        decor: {
          deck: ramp(t, 10.4, 11.6),
          planters: ramp(t, 10.8, 12.8),
          shrubs: ramp(t, 11.4, 13.8),
          trees: ramp(t, 12.2, 14.2),
          pergola: ramp(t, 12.6, 14.6),
          benches: ramp(t, 13.6, 14.6),
          poles: ramp(t, 14.0, 14.9),
          lights: ramp(t, 14.4, 16.2),
          vines: ramp(t, 11.0, 16.2),
          windowBoxes: ramp(t, 13.0, 15.0),
          awning: ramp(t, 13.8, 14.8),
        },
        evening: ramp(t, 15.8, 18.2) - ramp(t, 20.0, 21.8),
        lightsOn: ramp(t, 16.8, 17.9) - ramp(t, 20.2, 21.4),
        washOn: ramp(t, 17.0, 18.2) - ramp(t, 20.2, 21.4),
        caption,
        title: { text: plan.title, alpha: window(t, 10.6, 11.2, 19.4, 20.0) },
        // Share of the frame (from the left) showing the photo as it was.
        wipe: t >= 22.9 ? wipeT : null,
        endCard: ramp(t, 26.1, 27.0),
      };
    },
  };
}
