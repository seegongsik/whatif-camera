/**
 * Dimension lines in the style of an architect's drawing: width and depth
 * along the walls (from the map footprint) and height at a corner (the photo
 * estimate, marked ≈). Lines are 3D; their labels are drawn flat on top by
 * the player at the projected anchor points.
 */
import { Group, Vector3 } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { bearingDeg, wrapDeg } from "../geo/enu.js";
import { edges } from "../geo/polygon.js";
import type { BuildingSpec } from "../estimate/spec.js";
import { toWorldAt } from "./coords.js";
import { LAYER_ADDED, lineMaterial } from "./world.js";

export const DIM_COLOR = "#ff6a2b";

export type DimLabel = { anchor: Vector3; text: string; alpha: number };

type Dim = {
  line: LineSegments2;
  extras: LineSegments2;
  material: LineMaterial;
  extraMaterial: LineMaterial;
  window: [number, number];
  anchor: Vector3;
  text: string;
};

function segments(points: Vector3[]): LineSegmentsGeometry {
  const g = new LineSegmentsGeometry();
  g.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
  return g;
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class Dimensions {
  readonly group = new Group();
  readonly lineMaterials: LineMaterial[] = [];
  private readonly dims: Dim[] = [];
  private progress = 0;

  constructor(spec: BuildingSpec) {
    const ring = spec.target.ring;
    const es = edges(ring);
    const main = es[spec.mainFacade];
    const side = es[spec.sideFacade];
    const h = spec.height.heightM;
    const fmt = (m: number) => `${m.toFixed(1)} m`;

    const along = (e: (typeof es)[number], text: string, window: [number, number]) => {
      const off = 2.2;
      const from = toWorldAt({ x: e.a.x + e.normal.x * off, y: e.a.y + e.normal.y * off }, 0.06);
      const to = toWorldAt({ x: e.b.x + e.normal.x * off, y: e.b.y + e.normal.y * off }, 0.06);
      const footA = toWorldAt({ x: e.a.x + e.normal.x * 0.3, y: e.a.y + e.normal.y * 0.3 }, 0.06);
      const footB = toWorldAt({ x: e.b.x + e.normal.x * 0.3, y: e.b.y + e.normal.y * 0.3 }, 0.06);
      const tickA = from.clone().add(new Vector3(0, 0.9, 0));
      const tickB = to.clone().add(new Vector3(0, 0.9, 0));
      const beyondA = toWorldAt({ x: e.a.x + e.normal.x * (off + 0.4), y: e.a.y + e.normal.y * (off + 0.4) }, 0.06);
      const beyondB = toWorldAt({ x: e.b.x + e.normal.x * (off + 0.4), y: e.b.y + e.normal.y * (off + 0.4) }, 0.06);
      this.add(from, to, [footA, beyondA, footB, beyondB, from, tickA, to, tickB], from.clone().lerp(to, 0.5).add(new Vector3(0, 0.6, 0)), text, window);
    };
    along(main, fmt(main.length), [0, 0.5]);
    if (spec.sideFacade !== spec.mainFacade) along(side, fmt(side.length), [0.2, 0.7]);

    // Height at the main facade's corner that is not shared with the side
    // facade; without a side facade, at the end nearer the middle of the photo.
    const ends = [spec.mainFacade, (spec.mainFacade + 1) % ring.length];
    const offAxis = (i: number) => {
      const p = ring[i];
      const cam = spec.pose.position;
      return Math.abs(wrapDeg(bearingDeg(cam, p) - spec.pose.orientation.headingDeg));
    };
    const cornerIndex =
      spec.sideFacade === spec.mainFacade
        ? offAxis(ends[0]) <= offAxis(ends[1]) ? ends[0] : ends[1]
        : spec.sideFacade === ends[1] ? ends[0] : ends[1];
    const corner = ring[cornerIndex];
    const before = es[(cornerIndex + ring.length - 1) % ring.length];
    const after = es[cornerIndex];
    const nx = before.normal.x + after.normal.x;
    const ny = before.normal.y + after.normal.y;
    const n = Math.hypot(nx, ny) || 1;
    const off = 1.8;
    const at = { x: corner.x + (nx / n) * off, y: corner.y + (ny / n) * off };
    const from = toWorldAt(at, 0);
    const to = toWorldAt(at, h);
    const tick = (z: number) => {
      const a = toWorldAt({ x: corner.x + (nx / n) * (off - 0.5), y: corner.y + (ny / n) * (off - 0.5) }, z);
      const b = toWorldAt({ x: corner.x + (nx / n) * (off + 0.5), y: corner.y + (ny / n) * (off + 0.5) }, z);
      return [a, b];
    };
    this.add(from, to, [...tick(0), ...tick(h)], toWorldAt(at, h * 0.55), `≈ ${fmt(h)}`, [0.4, 1]);
    this.group.traverse((o) => o.layers.set(LAYER_ADDED));
  }

  private add(from: Vector3, to: Vector3, extras: Vector3[], anchor: Vector3, text: string, window: [number, number]) {
    const material = lineMaterial(DIM_COLOR, 2.6);
    const extraMaterial = lineMaterial(DIM_COLOR, 1.4);
    this.lineMaterials.push(material, extraMaterial);
    const d = to.clone().sub(from);
    const line = new LineSegments2(segments([new Vector3(0, 0, 0), d]), material);
    line.position.copy(from);
    const extrasLine = new LineSegments2(segments(extras), extraMaterial);
    this.group.add(line, extrasLine);
    this.dims.push({ line, extras: extrasLine, material, extraMaterial, window, anchor, text });
  }

  setProgress(p: number): void {
    this.progress = p;
    for (const d of this.dims) {
      const local = smooth((p - d.window[0]) / (d.window[1] - d.window[0]));
      d.line.scale.setScalar(Math.max(1e-4, local));
      d.material.opacity = local > 0 ? Math.min(1, p * 4) : 0;
      d.extraMaterial.opacity = smooth((local - 0.7) / 0.3) * Math.min(1, p * 4);
      d.line.visible = local > 0;
      d.extras.visible = d.extraMaterial.opacity > 0;
    }
  }

  /** Overall fade (dimension lines leave before the garden grows). */
  setFade(alpha: number): void {
    for (const d of this.dims) {
      if (!d.line.visible) continue;
      d.material.opacity *= alpha;
      d.extraMaterial.opacity *= alpha;
    }
  }

  labels(fade: number): DimLabel[] {
    return this.dims.map((d) => ({
      anchor: d.anchor,
      text: d.text,
      alpha: smooth(((this.progress - d.window[0]) / (d.window[1] - d.window[0]) - 0.6) / 0.4) * fade,
    }));
  }
}
