/**
 * The "what if" made visible: procedural meshes for every item in the
 * layout, each with a growth animation driven by a 0..1 progress.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type ColorRepresentation,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { centroid, edges, type Edge, type Ring } from "../geo/polygon.js";
import type { DesignPlan } from "../design/plan.js";
import type { Layout } from "../design/layout.js";
import { hashString, seededRandom } from "../design/rng.js";
import { faceToward, toWorld, toWorldAt } from "./coords.js";
import { LAYER_ADDED, lineMaterial } from "./world.js";

export type DecorChannel =
  | "deck"
  | "planters"
  | "shrubs"
  | "trees"
  | "pergola"
  | "benches"
  | "poles"
  | "lights"
  | "vines"
  | "windowBoxes"
  | "awning";

const UP = new Vector3(0, 1, 0);

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function easeOutBack(x: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Progress of one item whose turn starts at `order` (0..1) and lasts `span` of the whole. */
function itemProgress(p: number, order: number, span: number): number {
  return clamp01((p - order * (1 - span)) / span);
}

type InstanceBase = { position: Vector3; quaternion: Quaternion; scale: Vector3; order: number };

/** Instances that grow in turn: "pop" scales the whole item, "rise" grows it up from its base. */
class Growing {
  readonly mesh: InstancedMesh;
  private readonly items: InstanceBase[];
  private last = -1;
  private readonly m = new Matrix4();
  private readonly s = new Vector3();

  constructor(
    geometry: BufferGeometry,
    material: Material,
    items: InstanceBase[],
    private readonly mode: "pop" | "rise",
    private readonly span = 0.35,
    colors?: Color[],
  ) {
    this.items = items;
    this.mesh = new InstancedMesh(geometry, material, Math.max(1, items.length));
    this.mesh.count = items.length;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    if (colors) colors.forEach((c, i) => this.mesh.setColorAt(i, c));
    this.set(0);
  }

  set(p: number): void {
    if (Math.abs(p - this.last) < 1e-5) return;
    this.last = p;
    this.items.forEach((it, i) => {
      const local = itemProgress(p, it.order, this.span);
      if (this.mode === "pop") {
        const g = local <= 0 ? 0 : Math.max(0, easeOutBack(local));
        this.s.copy(it.scale).multiplyScalar(Math.max(1e-4, g));
      } else {
        const g = local <= 0 ? 0 : 1 - Math.pow(1 - local, 3);
        this.s.set(it.scale.x, it.scale.y * Math.max(1e-4, g), it.scale.z);
      }
      this.m.compose(it.position, it.quaternion, this.s);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = p > 0 && this.items.length > 0;
  }
}

function yawQuaternion(angleRad: number): Quaternion {
  return new Quaternion().setFromAxisAngle(UP, angleRad);
}

function facadePoint(e: Edge, s: number, z: number, out: number): Vector3 {
  return toWorldAt({ x: e.a.x + e.dir.x * s + e.normal.x * out, y: e.a.y + e.dir.y * s + e.normal.y * out }, z);
}

function leafGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const v = new Float32Array([0, -0.5, 0, 0.36, 0, 0.03, 0, 0.5, 0, -0.36, 0, 0.03]);
  g.setAttribute("position", new BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function gradientTexture(inner: string, outer: string, vertical: boolean): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = vertical
    ? ctx.createRadialGradient(64, 128, 4, 64, 128, 128)
    : ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function plankTexture(wood: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const base = new Color(wood);
  const rnd = seededRandom(7);
  for (let i = 0; i < 8; i += 1) {
    const c = base.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.fillRect(0, i * 32, 256, 30);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, i * 32 + 30, 256, 2);
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

function stripeTexture(accent: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? accent : "#f6f1e7";
    ctx.fillRect(i * 16, 0, 16, 16);
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  return t;
}

function varied(base: ColorRepresentation, rnd: () => number, amount: number): Color {
  return new Color(base).offsetHSL((rnd() - 0.5) * 0.04, (rnd() - 0.5) * amount, (rnd() - 0.5) * amount);
}

export class Decor {
  readonly group = new Group();
  readonly lineMaterials: LineMaterial[] = [];
  private readonly setters = new Map<DecorChannel, (p: number) => void>();
  private readonly bulbMaterial: MeshStandardMaterial;
  private readonly glowMaterial: PointsMaterial;
  private readonly washMaterial: MeshBasicMaterial;
  private readonly materials: Material[] = [];

  constructor(ring: Ring, layout: Layout, plan: DesignPlan, seedKey: string) {
    const rnd = seededRandom(hashString(seedKey) ^ 0x9e3779b9);
    const pal = plan.palette;
    const mat = <T extends Material>(m: T): T => {
      this.materials.push(m);
      return m;
    };
    const wood = mat(new MeshStandardMaterial({ color: pal.wood, roughness: 0.75 }));
    const planter = mat(new MeshStandardMaterial({ color: pal.planter, roughness: 0.7 }));
    const foliage = mat(new MeshStandardMaterial({ color: "#ffffff", roughness: 0.85, flatShading: true }));
    const leafMat = mat(new MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, side: DoubleSide }));
    const trunk = mat(new MeshStandardMaterial({ color: "#6b4a32", roughness: 0.9 }));
    const dark = mat(new MeshStandardMaterial({ color: "#2e2e2e", roughness: 0.6 }));
    const bloom = mat(new MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 }));
    this.bulbMaterial = mat(new MeshStandardMaterial({ color: "#fff6e0", emissive: new Color("#ffc46e"), emissiveIntensity: 0 }));
    const roofZ = layout.roofZ;
    const es = edges(ring);
    const c = centroid(ring);

    // Deck: grows out from the middle of the roof.
    if (layout.deck) {
      const shape = new Shape(layout.deck.map((p) => new Vector2(p.x - c.x, p.y - c.y)));
      const g = new ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      const tex = plankTexture(pal.wood);
      tex.repeat.set(1 / 1.6, 1 / 1.6);
      const longest = es.reduce((a, b) => (b.length > a.length ? b : a));
      tex.rotation = Math.atan2(longest.dir.y, longest.dir.x);
      const deckMat = mat(new MeshStandardMaterial({ map: tex, roughness: 0.8 }));
      const deck = new Mesh(g, deckMat);
      deck.position.copy(toWorldAt(c, roofZ + 0.01));
      deck.receiveShadow = true;
      this.group.add(deck);
      this.setters.set("deck", (p) => {
        const e = 1 - Math.pow(1 - clamp01(p), 3);
        deck.scale.set(Math.max(1e-3, e), 1, Math.max(1e-3, e));
        deck.visible = p > 0;
      });
    }

    // Planters and the shrubs in them.
    const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    if (layout.planters.length > 0) {
      const items = layout.planters.map((p) => {
        const mid = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 };
        const len = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
        return {
          position: toWorldAt(mid, roofZ),
          quaternion: yawQuaternion(Math.atan2(p.b.y - p.a.y, p.b.x - p.a.x)),
          scale: new Vector3(len, p.height, p.width),
          order: p.order,
        };
      });
      const grow = new Growing(box, planter, items, "rise", 0.25);
      this.group.add(grow.mesh);
      this.setters.set("planters", (p) => grow.set(p));
    }
    if (layout.shrubs.length > 0) {
      const ico = new IcosahedronGeometry(1, 1);
      const items = layout.shrubs.map((s) => ({
        position: toWorldAt(s.p, s.z + s.r * 0.55),
        quaternion: new Quaternion().setFromAxisAngle(UP, rnd() * Math.PI),
        scale: new Vector3(s.r, s.r * 0.85, s.r),
        order: s.order,
      }));
      const colors = layout.shrubs.map(() => varied(pal.foliage, rnd, 0.12));
      const grow = new Growing(ico, foliage, items, "pop", 0.2, colors);
      this.group.add(grow.mesh);
      this.setters.set("shrubs", (p) => grow.set(p));
    }

    // Trees in pots.
    if (layout.trees.length > 0) {
      const pot = new CylinderGeometry(0.42, 0.34, 0.55, 18).translate(0, 0.275, 0);
      const stem = new CylinderGeometry(0.05, 0.07, 1.5, 8).translate(0, 0.75 + 0.5, 0);
      const crown = new IcosahedronGeometry(1, 1);
      const trees = layout.trees.map((t) => {
        const g = new Group();
        g.add(new Mesh(pot, planter), new Mesh(stem, trunk));
        const tone = varied(pal.foliage, rnd, 0.1);
        const crownMat = mat(new MeshStandardMaterial({ color: tone, roughness: 0.85, flatShading: true }));
        for (let k = 0; k < 3; k += 1) {
          const m = new Mesh(crown, crownMat);
          const r = 0.55 + rnd() * 0.25;
          m.scale.set(r, r * 0.9, r);
          m.position.set((rnd() - 0.5) * 0.5, 2.1 + rnd() * 0.5, (rnd() - 0.5) * 0.5);
          g.add(m);
        }
        g.traverse((o) => {
          o.castShadow = true;
          o.receiveShadow = true;
        });
        g.position.copy(toWorldAt(t.p, roofZ));
        this.group.add(g);
        return { g, t };
      });
      this.setters.set("trees", (p) => {
        for (const { g, t } of trees) {
          const local = itemProgress(p, t.order, 0.45);
          const s = local <= 0 ? 1e-4 : Math.max(1e-4, easeOutBack(local)) * t.scale;
          g.scale.setScalar(s);
          g.visible = local > 0;
        }
      });
    }

    // Pergola: posts rise, beams and slats follow.
    if (layout.pergola) {
      const pg = layout.pergola;
      const g = new Group();
      g.position.copy(toWorldAt(pg.center, roofZ));
      g.quaternion.copy(yawQuaternion(pg.angleRad));
      const posts: Mesh[] = [];
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const post = new Mesh(box, wood);
          post.scale.set(0.12, pg.height, 0.12);
          post.position.set((sx * (pg.length - 0.2)) / 2, 0, (sz * (pg.depth - 0.2)) / 2);
          posts.push(post);
          g.add(post);
        }
      }
      const beams: Mesh[] = [];
      for (const sz of [-1, 1]) {
        const beam = new Mesh(box, wood);
        beam.scale.set(pg.length + 0.3, 0.18, 0.1);
        beam.position.set(0, pg.height - 0.18, (sz * (pg.depth - 0.2)) / 2);
        beams.push(beam);
        g.add(beam);
      }
      const slatCount = Math.max(4, Math.floor(pg.length / 0.35));
      const slatItems = Array.from({ length: slatCount }, (_, k) => ({
        position: new Vector3(-pg.length / 2 + ((k + 0.5) / slatCount) * pg.length, pg.height, 0),
        quaternion: new Quaternion(),
        scale: new Vector3(0.06, 0.1, pg.depth + 0.3),
        order: k / Math.max(1, slatCount - 1),
      }));
      const slats = new Growing(box, wood, slatItems, "pop", 0.25);
      g.add(slats.mesh);
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      this.group.add(g);
      this.setters.set("pergola", (p) => {
        const rise = clamp01(p / 0.4);
        posts.forEach((post) => {
          post.scale.y = Math.max(1e-3, pg.height * (1 - Math.pow(1 - rise, 3)));
          post.visible = p > 0;
        });
        const b = clamp01((p - 0.35) / 0.2);
        beams.forEach((beam) => {
          beam.scale.x = Math.max(1e-3, (pg.length + 0.3) * b);
          beam.visible = b > 0;
        });
        slats.set(clamp01((p - 0.5) / 0.5));
      });
    }

    if (layout.benches.length > 0) {
      const items = layout.benches.map((b, i) => ({
        position: toWorldAt(b.center, roofZ),
        quaternion: yawQuaternion(b.angleRad),
        scale: new Vector3(b.length, 0.45, 0.45),
        order: i / Math.max(1, layout.benches.length - 1),
      }));
      const grow = new Growing(box, wood, items, "rise", 0.5);
      this.group.add(grow.mesh);
      this.setters.set("benches", (p) => grow.set(p));
    }

    if (layout.poles.length > 0) {
      const cyl = new CylinderGeometry(0.03, 0.035, 1, 8).translate(0, 0.5, 0);
      const items = layout.poles.map((pole, i) => ({
        position: toWorldAt(pole.p, roofZ),
        quaternion: new Quaternion(),
        scale: new Vector3(1, pole.height, 1),
        order: i / Math.max(1, layout.poles.length - 1),
      }));
      const grow = new Growing(cyl, dark, items, "rise", 0.4);
      this.group.add(grow.mesh);
      this.setters.set("poles", (p) => grow.set(p));
    }

    // String lights: cables, bulbs and a soft glow for the evening.
    const glowPositions: number[] = [];
    if (layout.lights.length > 0) {
      const cables: { line: Line2; material: LineMaterial; order: number }[] = [];
      const bulbs: InstanceBase[] = [];
      layout.lights.forEach((strand, i) => {
        const pts = strand.points.map((p) => toWorld(p));
        const geometry = new LineGeometry();
        geometry.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
        const material = lineMaterial("#2a2a2a", 1.2);
        this.lineMaterials.push(material);
        const order = i / Math.max(1, layout.lights.length - 1);
        const line = new Line2(geometry, material);
        cables.push({ line, material, order });
        this.group.add(line);
        let carried = 0;
        for (let k = 1; k < pts.length; k += 1) {
          const seg = pts[k].distanceTo(pts[k - 1]);
          carried += seg;
          if (carried >= 0.5) {
            carried = 0;
            const pos = pts[k].clone().add(new Vector3(0, -0.07, 0));
            bulbs.push({ position: pos, quaternion: new Quaternion(), scale: new Vector3(1, 1, 1), order: Math.min(1, order + (k / pts.length) * 0.2) });
            glowPositions.push(pos.x, pos.y, pos.z);
          }
        }
      });
      const bulbGrow = new Growing(new SphereGeometry(0.05, 10, 8), this.bulbMaterial, bulbs, "pop", 0.3);
      bulbGrow.mesh.castShadow = false;
      this.group.add(bulbGrow.mesh);
      this.setters.set("lights", (p) => {
        for (const c of cables) {
          const local = itemProgress(p, c.order, 0.5);
          c.material.opacity = local;
          c.line.visible = local > 0;
        }
        bulbGrow.set(p);
      });
    }
    this.glowMaterial = mat(
      new PointsMaterial({
        size: 0.55,
        map: gradientTexture("rgba(255,214,150,1)", "rgba(255,214,150,0)", false),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0,
        color: "#ffd9a0",
      }),
    );
    if (glowPositions.length > 0) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(glowPositions), 3));
      const glow = new Points(g, this.glowMaterial);
      glow.frustumCulled = false;
      this.group.add(glow);
    }

    // Climbing stems: leaves appear from the ground up.
    if (layout.vines.length > 0) {
      const leaves: { base: InstanceBase; z: number }[] = [];
      let maxZ = 0.1;
      for (const strand of layout.vines) {
        const e = es[strand.facade];
        const normalYaw = faceToward(e.normal);
        for (const pt of strand.points) {
          for (let k = 0; k < 2; k += 1) {
            if (leaves.length >= 6000) break;
            const s = pt.s + (rnd() - 0.5) * 0.22;
            const z = Math.max(0.05, pt.z + (rnd() - 0.5) * 0.18);
            const q = new Quaternion()
              .setFromAxisAngle(UP, normalYaw + (rnd() - 0.5) * 0.7)
              .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rnd() * Math.PI * 2));
            const size = 0.13 + rnd() * 0.12;
            leaves.push({ base: { position: facadePoint(e, s, z, 0.05 + rnd() * 0.08), quaternion: q, scale: new Vector3(size, size, size), order: 0 }, z });
            maxZ = Math.max(maxZ, z);
          }
        }
      }
      for (const leaf of leaves) leaf.base.order = leaf.z / maxZ;
      const colors = leaves.map(() => varied(pal.foliage, rnd, 0.16));
      const grow = new Growing(leafGeometry(), leafMat, leaves.map((l) => l.base), "pop", 0.08, colors);
      grow.mesh.castShadow = false;
      this.group.add(grow.mesh);
      this.setters.set("vines", (p) => grow.set(p));
    }

    // Window boxes with flowers.
    if (layout.windowBoxes.length > 0) {
      const maxZ = Math.max(...layout.windowBoxes.map((w) => w.z));
      const boxes: InstanceBase[] = [];
      const flowers: InstanceBase[] = [];
      for (const w of layout.windowBoxes) {
        const e = es[w.facade];
        const yaw = yawQuaternion(Math.atan2(e.dir.y, e.dir.x));
        const order = w.z / maxZ;
        boxes.push({ position: facadePoint(e, w.s, w.z - 0.2, 0.16), quaternion: yaw, scale: new Vector3(w.length, 0.22, 0.26), order });
        for (let k = 0; k < 5; k += 1) {
          flowers.push({
            position: facadePoint(e, w.s + (k / 4 - 0.5) * (w.length - 0.2), w.z + 0.08, 0.16 + (rnd() - 0.5) * 0.08),
            quaternion: new Quaternion(),
            scale: new Vector3(0.09, 0.09, 0.09).multiplyScalar(0.8 + rnd() * 0.5),
            order: Math.min(1, order + 0.05),
          });
        }
      }
      const boxGrow = new Growing(box, planter, boxes, "pop", 0.3);
      const flowerGrow = new Growing(
        new IcosahedronGeometry(1, 0),
        bloom,
        flowers,
        "pop",
        0.3,
        flowers.map((_, i) => (i % 3 === 0 ? new Color(pal.accent) : varied(pal.bloom, rnd, 0.1))),
      );
      this.group.add(boxGrow.mesh, flowerGrow.mesh);
      this.setters.set("windowBoxes", (p) => {
        boxGrow.set(p);
        flowerGrow.set(p);
      });
    }

    // Awning over the ground floor of the main facade: it unrolls outward.
    if (layout.awning) {
      const a = layout.awning;
      const e = es[a.facade];
      const tex = stripeTexture(pal.accent);
      tex.repeat.set((a.s1 - a.s0) / 0.8, 1);
      const awningMat = mat(new MeshStandardMaterial({ map: tex, roughness: 0.8, side: DoubleSide }));
      const plane = new PlaneGeometry(1, 1).translate(0, -0.5, 0);
      const awning = new Mesh(plane, awningMat);
      const pivot = new Object3D();
      pivot.position.copy(facadePoint(e, (a.s0 + a.s1) / 2, a.z, 0.02));
      pivot.rotation.set(0, faceToward(e.normal), 0);
      awning.rotation.x = -Math.PI / 2 + 0.33;
      awning.scale.set(a.s1 - a.s0, a.depth, 1);
      awning.castShadow = true;
      pivot.add(awning);
      this.group.add(pivot);
      this.setters.set("awning", (p) => {
        awning.scale.y = Math.max(1e-3, a.depth * (1 - Math.pow(1 - clamp01(p), 3)));
        pivot.visible = p > 0;
      });
    }

    // Warm light washing up the walls in the evening.
    this.washMaterial = mat(
      new MeshBasicMaterial({
        map: gradientTexture("rgba(255,190,120,1)", "rgba(255,190,120,0)", true),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0,
        side: DoubleSide,
        toneMapped: false,
      }),
    );
    if (layout.washes.length > 0) {
      const plane = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
      const washes = new InstancedMesh(plane, this.washMaterial, layout.washes.length);
      const m = new Matrix4();
      layout.washes.forEach((w, i) => {
        const e = es[w.facade];
        m.compose(
          facadePoint(e, w.s, 0, 0.06),
          new Quaternion().setFromAxisAngle(UP, faceToward(e.normal)),
          new Vector3(w.width, w.height, 1),
        );
        washes.setMatrixAt(i, m);
      });
      washes.frustumCulled = false;
      this.group.add(washes);
    }

    this.group.traverse((o) => o.layers.set(LAYER_ADDED));
    for (const set of this.setters.values()) set(0);
  }

  setProgress(channel: DecorChannel, p: number): void {
    this.setters.get(channel)?.(clamp01(p));
  }

  /** 0 = off, 1 = full evening glow. */
  setEvening(lightsOn: number, washOn: number): void {
    this.bulbMaterial.emissiveIntensity = 3.2 * lightsOn;
    this.glowMaterial.opacity = 0.9 * lightsOn;
    this.washMaterial.opacity = 0.42 * washOn;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      mesh.geometry?.dispose();
    });
    this.materials.forEach((m) => m.dispose());
    this.lineMaterials.forEach((m) => m.dispose());
  }
}
