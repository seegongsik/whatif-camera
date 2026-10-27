/**
 * SYNTHETIC scene for the demo button and for checking the estimates:
 * invented buildings around a placeholder location, and a "photo" rendered
 * from a known camera. The app is given only what a phone would know (an
 * offset GPS fix, a compass with an error, footprints without the target's
 * height) and its answers are compared with the truth it never saw.
 */
import {
  ACESFilmicToneMapping,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShapeGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from "three";
import { bearingDeg, localFrame, toLatLon, type EN } from "../geo/enu.js";
import { centroid, edges, type Ring } from "../geo/polygon.js";
import { sunPosition, sunVector } from "../geo/sun.js";
import { intrinsicsFromLongSideFov, projectPoint, verticalFovDeg, type CameraPose } from "../camera/pose.js";
import { nearVertex, silhouette, type CornerMarks } from "../estimate/register.js";
import type { FootprintSet } from "../data/footprints.js";
import type { CaptureMeta } from "../capture/types.js";
import { quaternionFor, toWorld, toWorldAt } from "../scene/coords.js";
import type { SceneInput } from "../pipeline.js";
import { seededRandom } from "../design/rng.js";

/** Placeholder location for the invented buildings (only used for the sun and the frame). */
export const SYNTHETIC_ORIGIN = { lat: 37.5, lon: 127.0 };

type Block = { id: string; ring: Ring; height: number; floors: number; wall: string; target?: boolean };

function rect(cx: number, cy: number, w: number, d: number, rotDeg: number): Ring {
  const r = (rotDeg * Math.PI) / 180;
  const ux = { x: Math.cos(r), y: -Math.sin(r) };
  const uy = { x: Math.sin(r), y: Math.cos(r) };
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([a, b]) => ({ x: cx + a * ux.x + b * uy.x, y: cy + a * ux.y + b * uy.y }));
}

export const SYNTHETIC_BLOCKS: Block[] = [
  { id: "synthetic/target", ring: rect(4, 46, 18, 12, 32), height: 18.6, floors: 6, wall: "#d9cbb8", target: true },
  { id: "synthetic/b1", ring: rect(-24, 44, 14, 14, 32), height: 12.4, floors: 4, wall: "#c9c4bb" },
  { id: "synthetic/b2", ring: rect(32, 54, 12, 16, 32), height: 24.8, floors: 8, wall: "#b9c2c9" },
  { id: "synthetic/b3", ring: rect(6, 84, 30, 14, 32), height: 31, floors: 10, wall: "#cfd3d6" },
  { id: "synthetic/b4", ring: rect(-30, 82, 18, 16, 32), height: 21.7, floors: 7, wall: "#d6c2ae" },
  { id: "synthetic/b5", ring: rect(-42, 18, 16, 12, 32), height: 15.5, floors: 5, wall: "#c7b9a6" },
  { id: "synthetic/b6", ring: rect(46, 22, 14, 12, 32), height: 9.3, floors: 3, wall: "#d8d0c4" },
  { id: "synthetic/b7", ring: rect(0, -34, 22, 10, 0), height: 9.3, floors: 3, wall: "#cdbfae" },
];

const TRUE_CAMERA: EN = { x: 12, y: -2 };
const CAMERA_HEIGHT = 1.6;
const GPS_ERROR: EN = { x: 7, y: -6 };
const COMPASS_ERROR_DEG = 11;
const TAKEN_AT = "2026-10-20T05:00:00Z";
const PHOTO = { width: 1080, height: 1440, fovLongDeg: 67 };

function facadeTexture(wall: string, glass: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, 128, 128);
  const g = ctx.createLinearGradient(0, 30, 0, 100);
  g.addColorStop(0, glass);
  g.addColorStop(1, "#5c6e7e");
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(22, 30, 86, 70);
  ctx.fillStyle = g;
  ctx.fillRect(24, 32, 80, 64);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(24, 32, 80, 4);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(18, 98, 92, 5);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

/** Walls with UVs in metres (u along the wall, v up), so the window grid sits on the floors. */
function walls(ring: Ring, height: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const e of edges(ring)) {
    const a0 = toWorldAt(e.a, 0);
    const b0 = toWorldAt(e.b, 0);
    const a1 = toWorldAt(e.a, height);
    const b1 = toWorldAt(e.b, height);
    pos.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, a0.x, a0.y, a0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z);
    uv.push(0, 0, e.length, 0, e.length, height, 0, 0, e.length, height, 0, height);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function roof(ring: Ring, height: number): BufferGeometry {
  const g = new ShapeGeometry(new Shape(ring.map((p) => new Vector2(p.x, p.y))));
  g.rotateX(-Math.PI / 2);
  g.translate(0, height, 0);
  return g;
}

function truePose(): CameraPose {
  const target = SYNTHETIC_BLOCKS[0];
  return {
    position: { x: TRUE_CAMERA.x, y: TRUE_CAMERA.y, z: CAMERA_HEIGHT },
    orientation: { headingDeg: bearingDeg(TRUE_CAMERA, centroid(target.ring)) + 4, pitchDeg: 14, rollDeg: -2 },
    intrinsics: intrinsicsFromLongSideFov(PHOTO.width, PHOTO.height, PHOTO.fovLongDeg),
  };
}

function renderPhoto(pose: CameraPose): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO.width;
  canvas.height = PHOTO.height;
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(PHOTO.width, PHOTO.height, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();

  // Sky: a blue gradient dome.
  const sky = new SphereGeometry(1500, 32, 16);
  const colors: number[] = [];
  const p = sky.getAttribute("position");
  const top = new Color("#4f86c6");
  const horizon = new Color("#cfe0ee");
  for (let i = 0; i < p.count; i += 1) {
    const c = horizon.clone().lerp(top, Math.pow(Math.max(0, p.getY(i) / 1500), 0.5));
    colors.push(c.r, c.g, c.b);
  }
  sky.setAttribute("color", new Float32BufferAttribute(colors, 3));
  scene.add(new Mesh(sky, new MeshBasicMaterial({ vertexColors: true, side: BackSide })));

  // Ground with a road across the view.
  const ground = new Mesh(new PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: "#a9a49b", roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
  const road = new Mesh(new PlaneGeometry(400, 11).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: "#55575a", roughness: 0.95 }));
  road.position.copy(toWorldAt({ x: 0, y: 14 }, 0.02));
  road.receiveShadow = true;
  scene.add(road);
  const lineMat = new MeshStandardMaterial({ color: "#e8e3d4", roughness: 0.9 });
  for (let x = -200; x < 200; x += 6) {
    const dash = new Mesh(new PlaneGeometry(3, 0.15).rotateX(-Math.PI / 2), lineMat);
    dash.position.copy(toWorldAt({ x, y: 14 }, 0.03));
    scene.add(dash);
  }

  const rnd = seededRandom(20261027);
  for (const block of SYNTHETIC_BLOCKS) {
    const map = facadeTexture(block.wall, rnd() > 0.5 ? "#7f97ad" : "#8aa0b2");
    map.repeat.set(1 / 3, 1 / (block.height / block.floors));
    const wall = new Mesh(walls(block.ring, block.height), new MeshStandardMaterial({ map, roughness: 0.85 }));
    wall.castShadow = true;
    wall.receiveShadow = true;
    const top = new Mesh(roof(block.ring, block.height), new MeshStandardMaterial({ color: "#8f8b85", roughness: 0.9 }));
    top.castShadow = true;
    scene.add(wall, top);
  }

  const sunDir = toWorld(sunVector(sunPosition(new Date(TAKEN_AT), SYNTHETIC_ORIGIN.lat, SYNTHETIC_ORIGIN.lon))).normalize();
  const sun = new DirectionalLight("#fff4e5", 3.0);
  sun.position.copy(sunDir.multiplyScalar(300));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 800 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, new HemisphereLight("#cfe1f5", "#9a9184", 1.1));

  const camera = new PerspectiveCamera(verticalFovDeg(pose.intrinsics), PHOTO.width / PHOTO.height, 0.3, 4000);
  camera.position.copy(toWorld(pose.position));
  camera.quaternion.copy(quaternionFor(pose.orientation));
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  // Copy into a plain 2D canvas and let the GL context go.
  const out = document.createElement("canvas");
  out.width = PHOTO.width;
  out.height = PHOTO.height;
  out.getContext("2d")!.drawImage(canvas, 0, 0);
  scene.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
  });
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}

/** Marks a careful person would place on the synthetic photo (within 1.5 px). */
function marksFor(pose: CameraPose): CornerMarks {
  const target = SYNTHETIC_BLOCKS[0];
  const rnd = seededRandom(7);
  const jitter = () => (rnd() * 2 - 1) * 1.5;
  const cam = { x: pose.position.x, y: pose.position.y };
  const { left, right } = silhouette(target.ring, cam);
  const at = (v: EN, z: number) => {
    const q = projectPoint(pose, { x: v.x, y: v.y, z });
    if (!q) throw new Error("synthetic corner behind the camera");
    return { u: q.u + jitter(), v: q.v + jitter() };
  };
  return {
    roofLeft: at(target.ring[left], target.height),
    roofRight: at(target.ring[right], target.height),
    groundLeft: at(target.ring[left], 0),
    groundRight: at(target.ring[right], 0),
    groundHidden: false,
    nearCorner: at(target.ring[nearVertex(target.ring, cam, left, right)], target.height),
  };
}

export function syntheticScene(): SceneInput {
  const pose = truePose();
  const photo = renderPhoto(pose);
  const frame = localFrame(SYNTHETIC_ORIGIN);
  const fix = toLatLon(frame, { x: TRUE_CAMERA.x + GPS_ERROR.x, y: TRUE_CAMERA.y + GPS_ERROR.y });
  const footprints: FootprintSet = {
    source: "SYNTHETIC (invented buildings)",
    attribution: "synthetic data",
    fetchedAt: TAKEN_AT,
    center: fix,
    radiusM: 150,
    buildings: SYNTHETIC_BLOCKS.map((b) => ({
      id: b.id,
      ring: b.ring.map((p) => toLatLon(frame, p)),
      // The target's height is withheld: the app has to estimate it.
      tags: b.target ? { kind: "apartments" } : { kind: "yes", heightM: b.height, levels: b.floors },
    })),
  };
  const capture: CaptureMeta = {
    lat: fix.lat,
    lon: fix.lon,
    accuracyM: 20,
    headingDeg: (pose.orientation.headingDeg + COMPASS_ERROR_DEG + 360) % 360,
    headingSource: "synthetic",
    pitchDeg: pose.orientation.pitchDeg,
    rollDeg: pose.orientation.rollDeg,
    tiltSource: "synthetic",
    fovLongDeg: PHOTO.fovLongDeg,
    fovSource: "synthetic",
    takenAt: TAKEN_AT,
  };
  return {
    synthetic: true,
    label: "SYNTHETIC scene: invented buildings, rendered photo",
    photo,
    capture,
    footprints,
    selectionId: SYNTHETIC_BLOCKS[0].id,
    marks: marksFor(pose),
    truth: {
      heightM: SYNTHETIC_BLOCKS[0].height,
      floors: SYNTHETIC_BLOCKS[0].floors,
      cameraEN: { x: -GPS_ERROR.x, y: -GPS_ERROR.y },
      headingDeg: pose.orientation.headingDeg,
    },
  };
}
