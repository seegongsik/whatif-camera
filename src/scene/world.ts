/**
 * The scene the photo is projected into: the selected building extruded from
 * its footprint to the estimated height, the neighbours, the ground and the
 * sky. Layer 0 holds what the photo could have seen; layer 1 holds what we add
 * (lines, decorations), which the projector's depth pass leaves out.
 */
import {
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { verticalFovDeg } from "../camera/pose.js";
import { centroid, edges, type Ring } from "../geo/polygon.js";
import { sunVector } from "../geo/sun.js";
import type { BuildingSpec } from "../estimate/spec.js";
import { quaternionFor, toWorld, toWorldAt } from "./coords.js";
import { PhotoProjector } from "./projection.js";

export const LAYER_ADDED = 1;

type Uniform<T> = { value: T };

export type World = {
  scene: Scene;
  projector: PhotoProjector;
  envMix: Uniform<number>;
  targetMix: Uniform<number>;
  targetMaterial: MeshStandardMaterial;
  skyMaterial: MeshBasicMaterial;
  sun: DirectionalLight;
  hemi: HemisphereLight;
  fog: Fog;
  edgeMaterial: LineMaterial;
  floorMaterials: LineMaterial[];
  lineMaterials: LineMaterial[];
  added: Group;
  /** Centre of the footprint at ground level, world coordinates. */
  base: Vector3;
  radius: number;
  height: number;
  daySun: Vector3;
  eveningSun: Vector3;
  dispose(): void;
};

export const MODEL_WHITE = new Color("#f3f0ea");
const NEIGHBOUR_GREY = new Color("#e2dfd8");
const GROUND = new Color("#e9e6df");
export const SKY_TOP = new Color("#c9d6e3");
export const SKY_HORIZON = new Color("#f1efea");

function prism(ring: Ring, height: number, base = 0): ExtrudeGeometry {
  const shape = new Shape(ring.map((p) => new Vector2(p.x, p.y)));
  const g = new ExtrudeGeometry(shape, { depth: Math.max(0.5, height - base), bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, base, 0);
  return g;
}

function skyGeometry(): BufferGeometry {
  const g = new SphereGeometry(1800, 48, 24);
  const colors: number[] = [];
  const pos = g.getAttribute("position");
  const c = new Color();
  for (let i = 0; i < pos.count; i += 1) {
    const t = Math.max(0, pos.getY(i) / 1800);
    c.copy(SKY_HORIZON).lerp(SKY_TOP, Math.pow(t, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

function outlineAt(ring: Ring, z: number, out: number): number[] {
  const pts: number[] = [];
  const es = edges(ring);
  for (let i = 0; i <= ring.length; i += 1) {
    const k = i % ring.length;
    const prev = es[(k + ring.length - 1) % ring.length];
    const next = es[k];
    const nx = prev.normal.x + next.normal.x;
    const ny = prev.normal.y + next.normal.y;
    const n = Math.hypot(nx, ny) || 1;
    const v = toWorldAt({ x: ring[k].x + (nx / n) * out, y: ring[k].y + (ny / n) * out }, z);
    pts.push(v.x, v.y, v.z);
  }
  return pts;
}

export function lineMaterial(color: string, width: number, opacity = 0): LineMaterial {
  return new LineMaterial({ color: new Color(color).getHex(), linewidth: width, transparent: true, opacity, depthWrite: false });
}

export function buildWorld(spec: BuildingSpec, photo: HTMLCanvasElement): World {
  const scene = new Scene();
  scene.background = SKY_HORIZON.clone();
  const fog = new Fog(SKY_HORIZON.clone(), 1e5, 2e5);
  scene.fog = fog;

  const photoCamera = new PerspectiveCamera(
    verticalFovDeg(spec.pose.intrinsics),
    spec.pose.intrinsics.width / spec.pose.intrinsics.height,
    0.5,
    4000,
  );
  photoCamera.position.copy(toWorld(spec.pose.position));
  photoCamera.quaternion.copy(quaternionFor(spec.pose.orientation));
  const projector = new PhotoProjector(new CanvasTexture(photo), photoCamera);

  const envMix = { value: 1 };
  const targetMix = { value: 1 };
  const height = spec.height.heightM;

  // Selected building.
  const targetGeometry = prism(spec.target.ring, height);
  const targetMaterial = new MeshStandardMaterial({ color: MODEL_WHITE.clone(), roughness: 0.92, metalness: 0 });
  projector.patch(targetMaterial, targetMix, true);
  const target = new Mesh(targetGeometry, targetMaterial);
  target.castShadow = true;
  target.receiveShadow = true;
  scene.add(target);

  // Neighbours in one mesh.
  const neighbourGeometries = spec.neighbours.map((n) => prism(n.ring, n.heightM));
  const neighbourMaterial = new MeshStandardMaterial({ color: NEIGHBOUR_GREY, roughness: 0.95, metalness: 0 });
  projector.patch(neighbourMaterial, envMix, true);
  if (neighbourGeometries.length > 0) {
    const merged = mergeGeometries(neighbourGeometries, false);
    neighbourGeometries.forEach((g) => g.dispose());
    if (merged) {
      const neighbours = new Mesh(merged, neighbourMaterial);
      neighbours.castShadow = true;
      neighbours.receiveShadow = true;
      scene.add(neighbours);
    }
  }

  const groundMaterial = new MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0 });
  projector.patch(groundMaterial, envMix, true);
  const ground = new Mesh(new CircleGeometry(1500, 72).rotateX(-Math.PI / 2), groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);

  const skyMaterial = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false });
  projector.patch(skyMaterial, envMix, false);
  const sky = new Mesh(skyGeometry(), skyMaterial);
  sky.renderOrder = -1;
  scene.add(sky);

  // Light: the sun where it stood at capture, and an evening sun for the "what if".
  const c = centroid(spec.target.ring);
  const base = toWorldAt(c, 0);
  const radius = Math.max(
    ...spec.target.ring.map((p) => Math.hypot(p.x - c.x, p.y - c.y)),
    height * 0.6,
  );
  const hemi = new HemisphereLight("#e3ebf3", "#cdc6b8", 1.15);
  scene.add(hemi);
  const sun = new DirectionalLight("#ffffff", 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const span = radius * 3.2 + 10;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = span * 6;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.target.position.copy(base);
  scene.add(sun, sun.target);
  const day = sunVector(spec.sun.day);
  const evening = spec.sun.evening
    ? sunVector(spec.sun.evening)
    : sunVector({ azimuthDeg: spec.frame.origin.lat >= 0 ? 285 : 255, elevationDeg: 7 });
  const daySun = toWorld(day).normalize();
  const eveningSun = toWorld(evening).normalize();
  sun.position.copy(base).addScaledVector(daySun, span * 2.5);

  // Added on layer 1: edges and floor lines of the model.
  const added = new Group();
  scene.add(added);
  const lineMaterials: LineMaterial[] = [];
  const edgeMaterial = lineMaterial("#2f2f2f", 1.6);
  lineMaterials.push(edgeMaterial);
  const edgeLines = new LineSegments2(
    new LineSegmentsGeometry().fromEdgesGeometry(new EdgesGeometry(targetGeometry, 25)),
    edgeMaterial,
  );
  added.add(edgeLines);
  const floorMaterials: LineMaterial[] = [];
  for (let floor = 1; floor < spec.height.floors; floor += 1) {
    const geometry = new LineGeometry();
    geometry.setPositions(outlineAt(spec.target.ring, floor * spec.height.floorHeightM, 0.04));
    const material = lineMaterial("#555555", 1.2);
    floorMaterials.push(material);
    lineMaterials.push(material);
    added.add(new Line2(geometry, material));
  }
  added.traverse((o) => o.layers.set(LAYER_ADDED));

  return {
    scene,
    projector,
    envMix,
    targetMix,
    targetMaterial,
    skyMaterial,
    sun,
    hemi,
    fog,
    edgeMaterial,
    floorMaterials,
    lineMaterials,
    added,
    base,
    radius,
    height,
    daySun,
    eveningSun,
    dispose() {
      scene.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const m = mesh.material as { dispose?: () => void } | { dispose?: () => void }[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else m?.dispose?.();
      });
      projector.dispose();
    },
  };
}
