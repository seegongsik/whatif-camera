/**
 * The shot list. The camera starts exactly where the photo was taken, so
 * the first frame is the photo; it then orbits the building and returns to
 * the same spot for the before/after. Camera moves are smooth monotone
 * splines through key poses; everything else is a fade window in seconds.
 */
import { basisFromOrientation, verticalFovDeg, type Orientation } from "../camera/pose.js";
import type { ENU } from "../geo/enu.js";
import { centroid } from "../geo/polygon.js";
import type { BuildingSpec } from "../estimate/spec.js";
import type { DesignPlan } from "../design/plan.js";
import type { DecorChannel } from "./decor.js";

const DEG = Math.PI / 180;

export type ShotState = {
  pose: { position: ENU; orientation: Orientation; vfovDeg: number };
  envPhoto: number;
  targetPhoto: number;
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

type Orbit = { tx: number; ty: number; tz: number; theta: number; phi: number; dist: number; roll: number; fov: number };

const CHANNELS: (keyof Orbit)[] = ["tx", "ty", "tz", "theta", "phi", "dist", "roll", "fov"];

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
  };
}

export function orbitPose(o: Orbit): { position: ENU; orientation: Orientation; vfovDeg: number } {
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
  };
}

export type Timeline = { duration: number; at(t: number): ShotState };

/** Vertical field of view of the orbit shots. */
const ORBIT_FOV_DEG = 55;

/**
 * Distance at which a building of horizontal radius r and height h fills
 * `fill` of a frame with this vertical field of view and aspect (width/height).
 * A tall 9:16 frame is narrow, so the width usually decides.
 */
export function fitDistance(fovDeg: number, aspect: number, r: number, h: number, fill: number): number {
  const tv = Math.tan((fovDeg * DEG) / 2);
  const th = tv * aspect;
  return Math.max(r / (th * fill), (0.5 * h + 0.3 * r) / (tv * fill));
}

export function makeTimeline(spec: BuildingSpec, plan: DesignPlan, aspect = 9 / 16): Timeline {
  const start = photoOrbit(spec);
  const c = centroid(spec.target.ring);
  const h = spec.height.heightM;
  const r = Math.max(...spec.target.ring.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
  const fit = fitDistance(ORBIT_FOV_DEG, aspect, r, h, 0.82);
  const around = (theta: number, phi: number, dist: number, tz: number, fov: number): Orbit => ({
    tx: c.x,
    ty: c.y,
    tz,
    theta: start.theta + theta,
    phi,
    dist,
    roll: 0,
    fov,
  });
  const keys: [number, Orbit][] = [
    [0, start],
    [1.6, start],
    [6.0, around(40, 14, fit, h * 0.45, ORBIT_FOV_DEG)],
    [10.5, around(95, 22, fit, h * 0.5, ORBIT_FOV_DEG)],
    [16.5, around(170, 38, fit * 0.85, h * 0.75, ORBIT_FOV_DEG)],
    [19.6, around(255, 18, fit, h * 0.5, ORBIT_FOV_DEG)],
    [22.6, { ...start, theta: start.theta + 360 }],
    [27.5, { ...start, theta: start.theta + 360 }],
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
