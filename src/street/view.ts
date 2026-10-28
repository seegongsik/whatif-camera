/**
 * The street view. At the top of the page: the photo, with the nearest shops
 * labelled where they stand in it. Scrolling down flies along the street:
 * every shop the map has stands at its real distance and side, as a stack of
 * signboards on a toy street; arches mark each kilometre and a small map
 * shows where you are. Tapping a sign opens its card.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { verticalFovDeg, type CameraPose } from "../camera/pose.js";
import { photoForModel } from "../capture/model-photo.js";
import type { CaptureMeta } from "../capture/types.js";
import type { EN } from "../geo/enu.js";
import { quaternionFor, toWorld, toWorldAt } from "../scene/coords.js";
import { h } from "../ui/dom.js";
import type { ShopAhead } from "./ahead.js";
import type { ShopCategory } from "./osm.js";
import { eyePose, localRoute, photoLabels, type PhotoLabel } from "./photo-labels.js";
import type { Quest } from "./quest.js";
import { QuestSheet } from "./quest-ui.js";
import { drawShareCard, shareCard } from "./share-card.js";
import { pointAt, type Route } from "./route.js";
import { badgeTexture, CATEGORY_ORDER, CATEGORY_STYLE, distanceText, signTexture, textTexture } from "./signs.js";
import { spotPlaces, type Spotted } from "./spotted.js";
import type { StreetAhead } from "./street.js";

/**
 * Carriageway widths of the toy street. Narrower than real roads on purpose:
 * on a tall phone screen both rows of signs must fit beside the road. Only
 * distances along the street and the side are to scale.
 */
const ROAD_WIDTH_M: Record<string, number> = {
  trunk: 14,
  primary: 13,
  secondary: 11,
  tertiary: 10,
  pedestrian: 7,
  living_street: 6,
  residential: 7,
  unclassified: 7,
  service: 5,
};
const SIDEWALK_M = 3;
const SIGN_W = 13;
const SIGN_H = (SIGN_W * 160) / 512;
/** Vertical spacing of stacked signs; the drone looks down about 20°, so a little more than a sign's height. */
const SIGN_STEP = SIGN_H / Math.cos((20 * Math.PI) / 180) + 0.7;
const FOV_DEG = 62;
/** Shops within this many metres of each other on one side share a building. */
const CLUSTER_M = 9;
const MAX_SIGNS = 6;
/** Signs are built only this far behind and ahead of the camera. */
const BUILD_BEHIND_M = 60;
const BUILD_AHEAD_M = 420;
/** Scrolled share of the page that turns the photo into the street. */
const INTRO_SHARE = 0.05;
/** Screens of scrolling for the whole street. */
const SCREENS = 28;

type Cluster = { key: string; side: "left" | "right"; s: number; shops: ShopAhead[]; extra: number };

type ActiveQuest = { quest: Quest; stops: ShopAhead[]; reached: Set<string>; group: Group; markers: Map<string, { beam: Mesh; badge: Mesh }> };

const QUEST_GOLD = "#ffb300";
const QUEST_DONE = "#2fb866";
/** A stop counts as reached when the view is this close to it. */
const REACH_M = 20;

export type StreetViewOptions = {
  street: StreetAhead;
  photo?: HTMLCanvasElement;
  capture?: CaptureMeta;
  onClose: () => void;
};

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Clusters of shops per side: neighbours within CLUSTER_M share a building. */
export function clusterShops(shops: ShopAhead[]): Cluster[] {
  const out: Cluster[] = [];
  for (const side of ["left", "right"] as const) {
    let current: Cluster | null = null;
    for (const shop of shops.filter((s) => s.side === side)) {
      if (current && shop.s - current.shops[0].s < CLUSTER_M) {
        if (current.shops.length < MAX_SIGNS) current.shops.push(shop);
        else current.extra += 1;
        continue;
      }
      current = { key: `${side}:${shop.id}`, side, s: shop.s, shops: [shop], extra: 0 };
      out.push(current);
    }
  }
  for (const c of out) c.s = c.shops.reduce((sum, s) => sum + s.s, 0) / c.shops.length;
  return out.sort((a, b) => a.s - b.s);
}

/** A flat strip along the route between two signed offsets (metres to the right), u running along in metres / uScale. */
function ribbon(route: Route, from: number, to: number, y: number, uScale: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const n = route.points.length;
  for (let i = 0; i < n; i += 1) {
    const a = route.points[Math.max(0, i - 1)];
    const b = route.points[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const right = { x: (b.y - a.y) / l, y: -(b.x - a.x) / l };
    const p = route.points[i];
    for (const [k, off] of [from, to].entries()) {
      const w = toWorldAt({ x: p.x + right.x * off, y: p.y + right.y * off }, y);
      pos.push(w.x, w.y, w.z);
      uv.push(route.along[i] / uScale, k);
    }
    // Counter-clockwise seen from above, so the strip faces up.
    if (i + 1 < n) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A wall along the route at a signed offset (metres to the right), from the ground up to `height`, facing the street; u runs along in metres / uScale. */
function wall(route: Route, offset: number, height: number, uScale: number): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const n = route.points.length;
  for (let i = 0; i < n; i += 1) {
    const a = route.points[Math.max(0, i - 1)];
    const b = route.points[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const p = route.points[i];
    const q = { x: p.x + ((b.y - a.y) / l) * offset, y: p.y - ((b.x - a.x) / l) * offset };
    for (const y of [0, height]) {
      const w = toWorldAt(q, y);
      pos.push(w.x, w.y, w.z);
      uv.push(route.along[i] / uScale, y / height);
    }
    if (i + 1 < n) {
      // Faces the street: towards the left for the right-hand wall and the other way round.
      if (offset > 0) index.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
      else index.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A row of plain shopfronts: glazing at street level, windows above. One repeat is 14 m. */
function frontageTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#efe8dc";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#c9d3dc";
  for (const x of [10, 74, 138, 202]) ctx.fillRect(x, 84, 46, 40);
  ctx.fillStyle = "#d9dee2";
  for (const x of [14, 46, 78, 110, 142, 174, 206, 238]) ctx.fillRect(x, 22, 14, 26);
  ctx.fillStyle = "#e0d6c6";
  ctx.fillRect(0, 70, 256, 6);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.flipY = true;
  return t;
}

/** Sky from deep blue overhead to haze at the horizon. */
function skyTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#5aa7e8");
  g.addColorStop(0.55, "#a9d3f2");
  g.addColorStop(1, "#dcecf6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function laneTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#4a4d54";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#ece7db";
  ctx.fillRect(0, 6, 256, 3);
  ctx.fillRect(0, 119, 256, 3);
  ctx.fillStyle = "#f2c94c";
  ctx.fillRect(0, 62, 140, 4);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  return t;
}

export class StreetView {
  readonly element: HTMLElement;
  private readonly street: StreetAhead;
  private readonly route: Route;
  private readonly clusters: Cluster[];
  private readonly byKey: Map<string, Cluster>;
  private readonly scroller: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV_DEG, 9 / 16, 0.5, 2500);
  private readonly flightCam = new PerspectiveCamera(FOV_DEG, 9 / 16, 0.5, 2500);
  private readonly ground: Mesh;
  private readonly active = new Map<string, Group>();
  private readonly filter = new Set<ShopCategory>(CATEGORY_ORDER);
  private readonly photoLayer: HTMLElement | null = null;
  private readonly labels: PhotoLabel[] = [];
  /** Where each photo label was drawn, in screen pixels, for tapping. */
  private labelBoxes: { shop: ShopAhead; x: number; y: number; w: number; h: number }[] = [];
  private readonly labelCanvas: HTMLCanvasElement | null = null;
  private readonly eye: (CameraPose & { snapped: boolean }) | null = null;
  private readonly readout: HTMLElement;
  private readonly next: HTMLElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly card: HTMLElement;
  private readonly questSheet: QuestSheet;
  private readonly questBar: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly signNote: HTMLElement | null = null;
  private readonly photo: HTMLCanvasElement | null = null;
  private quest: ActiveQuest | null = null;
  /** Places Muse Spark read in the photo. */
  private spotted = new Set<string>();
  private toastTimer = 0;
  private disposed = false;
  private readonly disposables: { dispose(): void }[] = [];
  private s = 0;
  private sTarget = 0;
  private intro = 0;
  private raf = 0;
  private width = 1;
  private height = 1;

  constructor(options: StreetViewOptions) {
    this.street = options.street;
    this.route = localRoute(options.street);
    this.clusters = clusterShops(options.street.shops);
    this.byKey = new Map(this.clusters.map((c) => [c.key, c]));
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.domElement.classList.add("street-gl");

    if (options.photo && options.capture) {
      this.eye = eyePose(options.street, options.capture, options.photo);
      this.labels = photoLabels(options.street, this.eye);
      options.photo.classList.add("street-photo");
      this.photo = options.photo;
      this.labelCanvas = h("canvas", { class: "street-labels" });
      this.signNote = h("div", { class: "street-sign-note hidden" });
      this.photoLayer = h("div", { class: "street-photo-layer" }, options.photo, this.labelCanvas, this.signNote);
    }

    this.readout = h("div", { class: "street-readout" });
    this.next = h("div", { class: "street-next" });
    this.minimap = h("canvas", { class: "street-minimap", width: 300, height: 300 });
    this.card = h("div", { class: "street-card hidden" });
    this.questSheet = new QuestSheet(this.street.shops, (quest, stops) => this.startQuest(quest, stops));
    this.questBar = h("div", { class: "street-quest-bar hidden" });
    this.toast = h("div", { class: "street-toast hidden" });
    const questButton = h("button", { class: "street-quest-button", onclick: () => this.questSheet.open() }, "✦ Quest");
    const chips = h("div", { class: "street-chips" });
    for (const category of CATEGORY_ORDER) {
      const count = this.street.shops.filter((s) => s.category === category).length;
      if (count === 0) continue;
      const chip = h("button", { class: "chip on", style: `--chip:${CATEGORY_STYLE[category].color}` }, `${CATEGORY_STYLE[category].label} ${count}`);
      chip.addEventListener("click", () => {
        if (this.filter.has(category)) this.filter.delete(category);
        else this.filter.add(category);
        chip.classList.toggle("on", this.filter.has(category));
        this.rebuildAll();
        this.drawMinimap();
      });
      chips.append(chip);
    }
    const title = h(
      "div",
      { class: "street-title" },
      h("strong", { text: this.street.name ?? "Unnamed street" }),
      this.street.synthetic ? h("span", { class: "badge", text: "SYNTHETIC" }) : null,
    );
    const close = h("button", { class: "street-close", "aria-label": "Close", onclick: options.onClose }, "×");
    const share = h("button", { class: "street-share", onclick: () => void this.share() }, "Share");
    const credit = h("div", { class: "street-credit", text: `${this.street.attribution} · ${this.street.shops.length} places within ${distanceText(this.street.route.length)}` });

    this.stage = h(
      "div",
      { class: "street-stage" },
      this.renderer.domElement,
      this.photoLayer,
      h("div", { class: "street-top" }, title, h("div", { class: "street-top-buttons" }, share, close)),
      this.readout,
      this.questBar,
      this.minimap,
      this.toast,
      h("div", { class: "street-bottom" }, h("div", { class: "street-actions" }, questButton), this.next, chips),
      credit,
      this.card,
      this.questSheet.element,
    );
    this.scroller = h("main", { class: "street" }, this.stage, h("div", { class: "street-spacer", style: `height:${SCREENS * 100}dvh` }));
    this.element = this.scroller;

    const sky = skyTexture();
    this.disposables.push(sky);
    this.scene.background = sky;
    this.scene.fog = new Fog(new Color("#dcecf6"), 150, 520);
    this.scene.add(new HemisphereLight("#ffffff", "#b9c7a8", 1.6));
    const sun = new DirectionalLight("#fff4e0", 1.6);
    sun.position.set(-300, 500, 200);
    this.scene.add(sun);
    this.ground = new Mesh(new PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: "#d9dccf", roughness: 1 }));
    this.ground.position.y = -0.05;
    this.scene.add(this.ground);
    this.buildStreet();

    this.scroller.addEventListener("scroll", () => this.onScroll(), { passive: true });
    this.renderer.domElement.addEventListener("click", (e) => this.pick(e));
    this.labelCanvas?.addEventListener("click", (e) => this.pickLabel(e));
    this.minimap.addEventListener("click", (e) => this.jump(e));
    window.addEventListener("resize", this.onResize);
  }

  /** Starts drawing; call once the element is in the page. */
  start(): void {
    this.onResize();
    this.onScroll();
    if (this.photo) void this.checkSigns();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.s += (this.sTarget - this.s) * 0.18;
      this.render();
    };
    tick();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.toastTimer);
    this.endQuest();
    window.removeEventListener("resize", this.onResize);
    for (const key of [...this.active.keys()]) this.drop(key);
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material as Material | Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }

  /** For the browser tests: jump to a distance along the street and draw one frame. */
  renderAt(s: number, intro = 1): string {
    this.intro = intro;
    this.s = this.sTarget = s;
    this.render();
    return (this.renderer.domElement as HTMLCanvasElement).toDataURL("image/jpeg", 0.85);
  }

  private onResize = (): void => {
    const rect = this.stage.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.drawLabels();
    this.drawMinimap();
  };

  private onScroll(): void {
    const max = Math.max(1, this.scroller.scrollHeight - this.scroller.clientHeight);
    const p = this.scroller.scrollTop / max;
    this.intro = this.photoLayer ? smooth(p / INTRO_SHARE) : 1;
    const q = Math.max(0, (p - INTRO_SHARE) / (1 - INTRO_SHARE));
    this.sTarget = Math.pow(q, 1.35) * this.route.length;
    if (this.photoLayer) {
      const opacity = 1 - smooth((this.intro - 0.15) / 0.5);
      this.photoLayer.style.opacity = String(opacity);
      this.photoLayer.style.pointerEvents = opacity > 0.5 ? "auto" : "none";
    }
  }

  private roadHalf(): number {
    return (ROAD_WIDTH_M[this.street.highway] ?? 12) / 2;
  }

  private buildStreet(): void {
    const half = this.roadHalf();
    const lane = laneTexture();
    lane.repeat.set(1, 1);
    this.disposables.push(lane);
    const road = new Mesh(ribbon(this.route, -half, half, 0.02, 12), new MeshStandardMaterial({ map: lane, roughness: 0.95 }));
    const walkMaterial = new MeshStandardMaterial({ color: "#e4ded2", roughness: 1 });
    const left = new Mesh(ribbon(this.route, -half - SIDEWALK_M, -half, 0.18, 12), walkMaterial);
    const right = new Mesh(ribbon(this.route, half, half + SIDEWALK_M, 0.18, 12), walkMaterial);
    // A low row of plain shopfronts along both pavements, so the street reads as a street; mapped places stand out from it.
    const front = frontageTexture();
    this.disposables.push(front);
    const frontage = new MeshStandardMaterial({ map: front, roughness: 1 });
    const facade = half + SIDEWALK_M + 0.5;
    this.scene.add(road, left, right, new Mesh(wall(this.route, facade, 7, 14), frontage), new Mesh(wall(this.route, -facade, 7, 14), frontage));
    this.scene.add(this.backdrop(facade));
    // Kilometre arches and posts every 250 m.
    for (let m = 250; m < this.route.length; m += 250) {
      const { at, headingDeg } = pointAt(this.route, m);
      const yaw = (-headingDeg * Math.PI) / 180;
      const group = new Group();
      group.position.copy(toWorldAt(at, 0));
      group.rotation.y = yaw;
      if (m % 1000 === 0) {
        const postMaterial = new MeshStandardMaterial({ color: "#ff6a2b", roughness: 0.6 });
        for (const x of [-half - 1, half + 1]) {
          const post = new Mesh(new BoxGeometry(0.8, 10, 0.8), postMaterial);
          post.position.set(x, 5, 0);
          group.add(post);
        }
        const beam = new Mesh(new BoxGeometry(2 * half + 2.8, 1.4, 0.8), postMaterial);
        beam.position.set(0, 10, 0);
        const label = textTexture(`${m / 1000} KM`, "#ffffff", "#ff6a2b");
        this.disposables.push(label);
        const plate = new Mesh(new PlaneGeometry(9, 3.4), new MeshBasicMaterial({ map: label, transparent: true }));
        plate.position.set(0, 12.6, 0.45);
        group.add(beam, plate);
      } else {
        const label = textTexture(`${m} m`);
        this.disposables.push(label);
        const plate = new Mesh(new PlaneGeometry(3.2, 1.2), new MeshBasicMaterial({ map: label, transparent: true }));
        plate.position.set(half + 1.2, 3.2, 0);
        const post = new Mesh(new BoxGeometry(0.2, 3, 0.2), new MeshStandardMaterial({ color: "#9e9e9e" }));
        post.position.set(half + 1.2, 1.5, 0);
        group.add(plate, post);
      }
      this.scene.add(group);
    }
  }

  /** Plain blocks behind the frontage on both sides, so the street runs through a town rather than a field. Not mapped buildings. */
  private backdrop(facade: number): InstancedMesh {
    const step = 26;
    const count = 2 * Math.ceil((this.route.length + 60) / step);
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: "#ffffff", roughness: 1 }), count);
    const dummy = new Object3D();
    const color = new Color();
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let i = 0;
    for (let m = -40; m < this.route.length + 20 && i < count; m += step) {
      const { at, headingDeg } = pointAt(this.route, m);
      const hd = (headingDeg * Math.PI) / 180;
      const right = { x: Math.cos(hd), y: -Math.sin(hd) };
      for (const side of [1, -1]) {
        if (i >= count) break;
        const depth = 14 + rand() * 18;
        const height = 9 + rand() * 26;
        const off = side * (facade + 9 + depth / 2 + rand() * 4);
        dummy.position.copy(toWorldAt({ x: at.x + right.x * off, y: at.y + right.y * off }, height / 2));
        dummy.rotation.set(0, -hd, 0);
        dummy.scale.set(depth, height, step - 3 - rand() * 4);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.setHSL(0.08 + rand() * 0.5, 0.08, 0.8 + rand() * 0.1));
        i += 1;
      }
    }
    mesh.count = i;
    return mesh;
  }

  private visibleShops(c: Cluster): ShopAhead[] {
    return c.shops.filter((s) => this.filter.has(s.category));
  }

  /** Where a cluster's signs hang: over the pavement on its side, at its distance along the street. */
  private signSpot(s: number, side: "left" | "right"): EN {
    const { at, headingDeg } = pointAt(this.route, s);
    const h0 = (headingDeg * Math.PI) / 180;
    const off = (side === "right" ? 1 : -1) * (this.roadHalf() + SIDEWALK_M - 0.6);
    return { x: at.x + Math.cos(h0) * off, y: at.y - Math.sin(h0) * off };
  }

  /** Height of the top of a shop's sign in its stack. */
  private signTop(shop: ShopAhead): number {
    const c = this.clusters.find((x) => x.shops.some((y) => y.id === shop.id));
    const n = c ? c.shops.length : 1;
    const i = c ? c.shops.findIndex((y) => y.id === shop.id) : 0;
    return 6 + Math.min(6, n) * 1.2 + 1.5 + i * SIGN_STEP + SIGN_H;
  }

  private build(c: Cluster): Group {
    const shops = this.visibleShops(c);
    const group = new Group();
    const half = this.roadHalf();
    const { at, headingDeg } = pointAt(this.route, c.s);
    const h0 = (headingDeg * Math.PI) / 180;
    const right = { x: Math.cos(h0), y: -Math.sin(h0) };
    const sign = c.side === "right" ? 1 : -1;
    const facade = half + SIDEWALK_M + 0.4;
    const blockHeight = 6 + Math.min(6, shops.length) * 1.2;
    const tint = new Color(CATEGORY_STYLE[shops[0]?.category ?? "shop"].color).lerp(new Color("#ffffff"), 0.62);
    // Local x runs across the street and local z along it once turned by the street's heading.
    const block = new Mesh(new BoxGeometry(8, blockHeight, 9), new MeshStandardMaterial({ color: tint, roughness: 0.9 }));
    const centre: EN = { x: at.x + right.x * sign * (facade + 4), y: at.y + right.y * sign * (facade + 4) };
    block.position.copy(toWorldAt(centre, blockHeight / 2));
    block.rotation.y = (-headingDeg * Math.PI) / 180;
    group.add(block);
    // Signs hang over the pavement in front of the building, on a pole down to the shop's door.
    const spot = this.signSpot(c.s, c.side);
    const bottom = blockHeight + 1.5;
    const pole = new Mesh(new BoxGeometry(0.35, bottom, 0.35), new MeshStandardMaterial({ color: "#5f6670", roughness: 0.6 }));
    pole.position.copy(toWorldAt(spot, bottom / 2));
    group.add(pole);
    shops.forEach((shop, i) => {
      const texture = signTexture(shop.name, shop.category, distanceText(shop.s), this.quest?.stops.some((q) => q.id === shop.id) ? QUEST_GOLD : undefined);
      const plane = new Mesh(new PlaneGeometry(SIGN_W, SIGN_H), new MeshBasicMaterial({ map: texture, transparent: true }));
      plane.position.copy(toWorldAt(spot, bottom + SIGN_H / 2 + i * SIGN_STEP));
      plane.userData = { shop, billboard: true };
      group.add(plane);
    });
    if (c.extra > 0 && shops.length === c.shops.length) {
      const more = textTexture(`+${c.extra} more`, "#ffffff", "#1b1b1b");
      const plate = new Mesh(new PlaneGeometry(4.2, 1.6), new MeshBasicMaterial({ map: more, transparent: true }));
      plate.position.copy(toWorldAt(spot, bottom + SIGN_H + 1.1 + (shops.length - 1) * SIGN_STEP));
      plate.userData = { billboard: true };
      group.add(plate);
    }
    return group;
  }

  private drop(key: string): void {
    const group = this.active.get(key);
    if (!group) return;
    group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const m = mesh.material as MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    });
    this.scene.remove(group);
    this.active.delete(key);
  }

  private rebuildAll(): void {
    for (const key of [...this.active.keys()]) this.drop(key);
  }

  /** Keeps signs built only near the camera: a 5 km street can hold thousands. */
  private updateActive(): void {
    const lo = this.s - BUILD_BEHIND_M;
    const hi = this.s + BUILD_AHEAD_M;
    for (const key of [...this.active.keys()]) {
      const c = this.byKey.get(key);
      if (!c || c.s < lo || c.s > hi) this.drop(key);
    }
    for (const c of this.clusters) {
      if (c.s < lo) continue;
      if (c.s > hi) break;
      if (this.active.has(c.key) || this.visibleShops(c).length === 0) continue;
      const group = this.build(c);
      this.active.set(c.key, group);
      this.scene.add(group);
    }
  }

  private flightPose(s: number): { position: Vector3; target: Vector3 } {
    // A drone's view: high behind, looking down the street so it runs up the tall screen.
    const behind = pointAt(this.route, s - 20).at;
    const ahead = pointAt(this.route, s + 80).at;
    return { position: toWorldAt(behind, 40), target: toWorldAt(ahead, 0) };
  }

  private render(): void {
    this.updateActive();
    const flight = this.flightPose(this.s);
    const flightCam = this.flightCam;
    flightCam.position.copy(flight.position);
    flightCam.lookAt(flight.target);
    if (this.eye && this.intro < 1) {
      // From the photo's own viewpoint into the flight.
      const t = smooth(this.intro);
      const eyePos = toWorld(this.eye.position);
      const eyeQuat = quaternionFor(this.eye.orientation);
      const eyeFov = this.visiblePhotoFov();
      this.camera.position.copy(eyePos).lerp(flightCam.position, t);
      this.camera.quaternion.copy(new Quaternion().copy(eyeQuat).slerp(flightCam.quaternion, t));
      this.camera.fov = eyeFov + (FOV_DEG - eyeFov) * t;
    } else {
      this.camera.position.copy(flightCam.position);
      this.camera.quaternion.copy(flightCam.quaternion);
      this.camera.fov = FOV_DEG;
    }
    this.camera.updateProjectionMatrix();
    this.ground.position.x = this.camera.position.x;
    this.ground.position.z = this.camera.position.z;
    // Signs turn to face the screen, like sprites, so they stay readable as the street bends.
    for (const group of [...this.active.values(), ...(this.quest ? [this.quest.group] : [])]) {
      for (const child of group.children) if (child.userData.billboard) child.quaternion.copy(this.camera.quaternion);
    }
    this.renderer.render(this.scene, this.camera);
    this.updateHud();
  }

  /** Vertical field of view of the part of the photo the screen shows (it is cropped to fill). */
  private visiblePhotoFov(): number {
    const k = this.eye!.intrinsics;
    const scale = Math.max(this.width / k.width, this.height / k.height);
    const shownHeight = this.height / scale;
    return verticalFovDeg({ ...k, height: shownHeight });
  }

  private updateHud(): void {
    const s = Math.max(0, this.s);
    this.readout.textContent = `${s < 5 ? "Start" : `${distanceText(s)} along`} · ${distanceText(this.route.length)} of street`;
    const upcoming = this.street.shops.find((x) => x.s > s + 5 && this.filter.has(x.category));
    this.next.textContent = upcoming ? `Next: ${upcoming.name} · ${CATEGORY_STYLE[upcoming.category].label.toLowerCase()} · ${distanceText(upcoming.s - s)} on the ${upcoming.side}` : "No more places ahead on this street";
    this.updateQuest();
    this.drawMinimapMarker();
  }

  private drawLabels(): void {
    if (!this.labelCanvas || !this.eye) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.labelCanvas.width = this.width * dpr;
    this.labelCanvas.height = this.height * dpr;
    const ctx = this.labelCanvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const k = this.eye.intrinsics;
    const scale = Math.max(this.width / k.width, this.height / k.height);
    const ox = (this.width - k.width * scale) / 2;
    const oy = (this.height - k.height * scale) / 2;
    const fontPx = Math.max(13, Math.round(this.height * 0.022));
    this.labelBoxes = [];
    for (const label of this.labels) {
      const ax = ox + label.anchor.u * scale;
      const ay = oy + label.anchor.v * scale;
      const y = oy + label.v * scale;
      const style = CATEGORY_STYLE[label.shop.category];
      const text = `${this.spotted.has(label.shop.id) ? "✓ " : ""}${label.shop.name} · ${distanceText(label.shop.s)}`;
      ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
      const w = ctx.measureText(text).width + fontPx * 1.2;
      // Kept on screen; the pin still points at the shop.
      const x = Math.min(this.width - w / 2 - 8, Math.max(w / 2 + 8, ox + label.u * scale));
      const hgt = fontPx * 1.8;
      this.labelBoxes.push({ shop: label.shop, x, y, w, h: hgt });
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(x, y + hgt / 2);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ax, ay, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - hgt / 2, w, hgt, hgt / 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x, y + 1);
    }
  }

  private pickLabel(e: MouseEvent): void {
    const rect = this.labelCanvas!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Nearest shops are drawn first and sit lowest; the last box drawn is on top.
    const hit = [...this.labelBoxes].reverse().find((b) => Math.abs(b.x - x) < b.w / 2 && Math.abs(b.y - y) < b.h / 2);
    if (hit) this.showCard(hit.shop);
  }

  private pick(e: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets = [...this.active.values()].flatMap((g) => g.children.filter((c) => c.userData.shop));
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) this.showCard(hit.object.userData.shop as ShopAhead);
  }

  private showCard(shop: ShopAhead): void {
    const style = CATEGORY_STYLE[shop.category];
    const links = [
      shop.instagram ? h("a", { class: "button", href: shop.instagram, target: "_blank", rel: "noopener" }, "Instagram") : null,
      shop.facebook ? h("a", { class: "button", href: shop.facebook, target: "_blank", rel: "noopener" }, "Facebook") : null,
      shop.website ? h("a", { class: "button", href: shop.website, target: "_blank", rel: "noopener" }, "Website") : null,
    ];
    const parts: (Node | null)[] = [
      h("div", { class: "street-card-tab", style: `background:${style.color}`, text: style.word }),
      h("h3", { text: shop.name }),
      h("p", { text: `${distanceText(shop.s - Math.max(0, this.s))} ahead on the ${shop.side} · ${shop.kind.replace("=", ": ").replace(/_/g, " ")}` }),
      shop.cuisine ? h("p", { class: "muted", text: `Cuisine: ${shop.cuisine.replace(/;/g, ", ").replace(/_/g, " ")}` }) : null,
      shop.openingHours ? h("p", { class: "muted", text: `Hours (as mapped): ${shop.openingHours}` }) : null,
      h("div", { class: "row wrap" }, ...links),
      h("p", { class: "muted small", text: `From ${this.street.source}. Shops change; the map may be out of date.` }),
      h("button", { class: "ghost", onclick: () => this.card.classList.add("hidden") }, "Close"),
    ];
    this.card.replaceChildren(...parts.filter((x): x is Node => x !== null));
    this.card.classList.remove("hidden");
  }

  // ----- Minimap -----

  private mapTransform(): { x: (p: EN) => number; y: (p: EN) => number; size: number } {
    const size = this.minimap.width;
    const pts = this.route.points;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 50);
    const pad = size * 0.1;
    const k = (size - 2 * pad) / span;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return { x: (p) => size / 2 + (p.x - cx) * k, y: (p) => size / 2 - (p.y - cy) * k, size };
  }

  private mapBase: ImageData | null = null;

  private drawMinimap(): void {
    const ctx = this.minimap.getContext("2d")!;
    const t = this.mapTransform();
    ctx.clearRect(0, 0, t.size, t.size);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.beginPath();
    ctx.roundRect(0, 0, t.size, t.size, 28);
    ctx.fill();
    ctx.strokeStyle = "#43464c";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    this.route.points.forEach((p, i) => (i === 0 ? ctx.moveTo(t.x(p), t.y(p)) : ctx.lineTo(t.x(p), t.y(p))));
    ctx.stroke();
    for (const shop of this.street.shops) {
      if (!this.filter.has(shop.category)) continue;
      const { at, headingDeg } = pointAt(this.route, shop.s);
      const hd = (headingDeg * Math.PI) / 180;
      const off = shop.side === "right" ? 9 : -9;
      const p = { x: at.x + Math.cos(hd) * off * (t.size / 300) * 6, y: at.y - Math.sin(hd) * off * (t.size / 300) * 6 };
      ctx.fillStyle = CATEGORY_STYLE[shop.category].color;
      ctx.beginPath();
      ctx.arc(t.x(p), t.y(p), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    this.quest?.stops.forEach((shop, i) => {
      const { at } = pointAt(this.route, shop.s);
      ctx.fillStyle = this.quest!.reached.has(shop.id) ? QUEST_DONE : QUEST_GOLD;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(t.x(at), t.y(at), 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "800 18px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), t.x(at), t.y(at) + 1);
    });
    this.mapBase = ctx.getImageData(0, 0, t.size, t.size);
  }

  private drawMinimapMarker(): void {
    if (!this.mapBase) return;
    const ctx = this.minimap.getContext("2d")!;
    ctx.putImageData(this.mapBase, 0, 0);
    const t = this.mapTransform();
    const { at } = pointAt(this.route, this.s);
    ctx.fillStyle = "#ff6a2b";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(t.x(at), t.y(at), 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private jump(e: MouseEvent): void {
    const rect = this.minimap.getBoundingClientRect();
    const t = this.mapTransform();
    const px = ((e.clientX - rect.left) / rect.width) * t.size;
    const py = ((e.clientY - rect.top) / rect.height) * t.size;
    let best = 0;
    let bestD = Infinity;
    this.route.points.forEach((p, i) => {
      const d = Math.hypot(t.x(p) - px, t.y(p) - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    this.scrollToS(this.route.along[best]);
  }

  /** Scrolls so the view stands `s` metres along the street. */
  private scrollToS(s: number): void {
    const q = Math.pow(Math.min(1, Math.max(0, s) / this.route.length), 1 / 1.35);
    const p = INTRO_SHARE + q * (1 - INTRO_SHARE);
    const max = this.scroller.scrollHeight - this.scroller.clientHeight;
    this.scroller.scrollTo({ top: p * max, behavior: "smooth" });
  }

  // ----- Quest -----

  private startQuest(quest: Quest, stops: ShopAhead[]): void {
    this.endQuest();
    this.questSheet.close();
    const group = new Group();
    const markers = new Map<string, { beam: Mesh; badge: Mesh }>();
    stops.forEach((shop, i) => {
      const spot = this.signSpot(shop.s, shop.side);
      // A pillar of light seen from far down the street, and the stop's number above its sign.
      const beam = new Mesh(new CylinderGeometry(1.3, 1.3, 90, 20, 1, true), new MeshBasicMaterial({ color: QUEST_GOLD, transparent: true, opacity: 0.32, depthWrite: false, side: DoubleSide, fog: false }));
      beam.position.copy(toWorldAt(spot, 45));
      const badge = new Mesh(new PlaneGeometry(5.5, 5.5), new MeshBasicMaterial({ map: badgeTexture(String(i + 1), QUEST_GOLD), transparent: true, fog: false }));
      badge.position.copy(toWorldAt(spot, this.signTop(shop) + 4));
      badge.userData = { billboard: true };
      group.add(beam, badge);
      markers.set(shop.id, { beam, badge });
    });
    this.scene.add(group);
    this.quest = { quest, stops, reached: new Set(), group, markers };
    // Rebuild the signs so the stops' signs carry the quest's ring.
    this.rebuildAll();
    this.drawMinimap();
    this.questBar.classList.remove("hidden");
    this.updateQuest();
    this.showToast(`✦ ${quest.title}: ${stops.length} stops. Scroll to walk there.`);
  }

  private endQuest(): void {
    const active = this.quest;
    if (!active) return;
    this.quest = null;
    active.group.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const m = mesh.material as MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    });
    this.scene.remove(active.group);
    this.questBar.classList.add("hidden");
    if (!this.disposed) {
      this.rebuildAll();
      this.drawMinimap();
    }
  }

  private updateQuest(): void {
    const active = this.quest;
    if (!active) return;
    // Pillars fade as the view comes up to them, so a near one does not fill the screen.
    for (const shop of active.stops) {
      const beam = active.markers.get(shop.id)!.beam.material as MeshBasicMaterial;
      const near = Math.min(1, Math.max(0, (Math.abs(shop.s - this.s) - 10) / 70));
      beam.opacity = (active.reached.has(shop.id) ? 0.04 : 0.08) + 0.24 * near * near;
    }
    active.stops.forEach((shop, i) => {
      if (active.reached.has(shop.id) || this.s < shop.s - REACH_M) return;
      active.reached.add(shop.id);
      const marker = active.markers.get(shop.id)!;
      (marker.beam.material as MeshBasicMaterial).color.set(QUEST_DONE);
      const badge = marker.badge.material as MeshBasicMaterial;
      badge.map?.dispose();
      badge.map = badgeTexture("✓", QUEST_DONE);
      badge.needsUpdate = true;
      this.drawMinimap();
      const done = active.reached.size === active.stops.length;
      this.showToast(done ? `✦ Quest complete: ${active.quest.title}` : `★ Stop ${i + 1} of ${active.stops.length}: ${shop.name}`);
    });
    const next = active.stops.find((shop) => !active.reached.has(shop.id));
    const ahead = next ? distanceText(next.s - Math.max(0, this.s)) : "";
    const key = `${active.reached.size}|${next?.id}|${ahead}`;
    if (this.questBar.dataset.key === key) return;
    this.questBar.dataset.key = key;
    const parts: (Node | null)[] = [
      h(
        "div",
        { class: "quest-bar-text" },
        h("strong", { text: `✦ ${active.quest.title} · ${active.reached.size}/${active.stops.length}` }),
        h("div", { text: next ? `Next stop: ${next.name}, ${ahead}` : "Quest complete" }),
      ),
      // Arrive just inside the reach of the stop, so it counts.
      next ? h("button", { onclick: () => this.scrollToS(next.s - REACH_M + 5) }, "Go") : h("button", { onclick: () => void this.share() }, "Share"),
      h("button", { class: "ghost", "aria-label": "End the quest", onclick: () => this.endQuest() }, "×"),
    ];
    this.questBar.replaceChildren(...parts.filter((x): x is Node => x !== null));
  }

  /** The street (and the quest, when there is one) as a picture for stories and chats. */
  private async share(): Promise<void> {
    const canvas = drawShareCard({ street: this.street, photo: this.photo, quest: this.quest && { quest: this.quest.quest, stops: this.quest.stops } });
    try {
      if ((await shareCard(canvas, this.street.name ?? "Street Ahead")) === "saved") this.showToast("Saved the card as a picture");
    } catch (error) {
      this.showToast(`Could not share: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove("hidden");
    // Restart the pop animation.
    this.toast.classList.remove("pop");
    void this.toast.offsetWidth;
    this.toast.classList.add("pop");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.add("hidden"), 2600);
  }

  // ----- Signs in the photo -----

  /** Asks Muse Spark Open which of the nearest mapped places it can read in the photo. */
  private async checkSigns(): Promise<void> {
    const note = this.signNote!;
    const places = spotPlaces(this.street.shops);
    if (places.length === 0) return;
    note.textContent = "Muse Spark is reading the signs in your photo…";
    note.classList.remove("hidden");
    try {
      const res = await fetch("/api/signs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: photoForModel(this.photo!), places }),
      });
      const body = (await res.json().catch(() => ({}))) as { spotted?: Spotted; error?: string };
      if (this.disposed) return;
      if (!res.ok || !body.spotted) {
        if (res.status === 503) note.classList.add("hidden");
        else note.textContent = `Sign check unavailable: ${body.error ?? `the server answered ${res.status}`}`;
        return;
      }
      const byId = new Map(this.street.shops.map((x) => [x.id, x]));
      const names = body.spotted.seen.map((x) => byId.get(x.id)?.name).filter((x): x is string => x !== undefined);
      this.spotted = new Set(body.spotted.seen.map((x) => x.id));
      note.classList.toggle("good", names.length > 0);
      if (names.length > 0) {
        note.textContent = `✓ Muse Spark read ${names.length === 1 ? "one of these signs" : `${names.length} of these signs`} in your photo: ${names.join(", ")}. Right street, right way.`;
      } else if (body.spotted.view === "across") {
        note.textContent = "Muse Spark sees building fronts, not a street running away from you. Turn to look along the street and take the photo again.";
      } else {
        note.textContent = "Muse Spark could not read any of these signs in your photo. If the street name at the top is wrong, step a few metres and try again.";
      }
      this.drawLabels();
    } catch (error) {
      if (!this.disposed) note.textContent = `Sign check unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
