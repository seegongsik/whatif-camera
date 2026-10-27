/**
 * Plays the timeline: renders the 3D scene, then draws captions, labels and
 * the before/after wipe on a 2D canvas, which is also what gets recorded.
 */
import {
  Color,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { BuildingSpec } from "../estimate/spec.js";
import type { DesignPlan } from "../design/plan.js";
import type { Layout } from "../design/layout.js";
import { Decor, type DecorChannel } from "./decor.js";
import { Dimensions, DIM_COLOR } from "./dims.js";
import { quaternionFor, toWorld } from "./coords.js";
import { makeTimeline, type ShotState, type Timeline } from "./timeline.js";
import { buildWorld, LAYER_ADDED, SKY_HORIZON, type World } from "./world.js";

const WHITE = new Color("#ffffff");
const EVENING_SUN = new Color("#ffad66");
const EVENING_SKY = new Color("#f2b88f");
const EVENING_HEMI_SKY = new Color("#b6a3c8");
const DAY_HEMI_GROUND = new Color("#cdc6b8");
const EVENING_HEMI_GROUND = new Color("#8f7a68");

export type PlayerLoad = {
  spec: BuildingSpec;
  plan: DesignPlan;
  layout: Layout;
  photo: HTMLCanvasElement;
};

export function pickRecordingType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export class Player {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  onTime: ((t: number, duration: number) => void) | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(40, 1, 0.3, 6000);
  private world: World | null = null;
  private dims: Dimensions | null = null;
  private decor: Decor | null = null;
  private timeline: Timeline | null = null;
  private spec: BuildingSpec | null = null;
  private before: HTMLCanvasElement | null = null;
  private raf = 0;
  private playing = false;
  private time = 0;

  constructor(width = 720, height = 1280) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.camera.aspect = width / height;
    this.camera.layers.enable(LAYER_ADDED);
  }

  get duration(): number {
    return this.timeline?.duration ?? 0;
  }

  get currentTime(): number {
    return this.time;
  }

  load(input: PlayerLoad): void {
    this.pause();
    this.disposeScene();
    const world = buildWorld(input.spec, input.photo);
    const dims = new Dimensions(input.spec);
    const decor = new Decor(input.spec.target.ring, input.layout, input.plan, input.spec.target.id);
    world.added.add(dims.group, decor.group);
    for (const m of [...world.lineMaterials, ...dims.lineMaterials, ...decor.lineMaterials]) {
      m.resolution.set(this.width, this.height);
    }
    this.world = world;
    this.dims = dims;
    this.decor = decor;
    this.spec = input.spec;
    this.timeline = makeTimeline(input.spec, input.plan, this.width / this.height);
    world.projector.renderDepth(this.renderer, world.scene);
    // The untouched photo, as framed by the video, for the before/after wipe.
    this.apply(this.timeline.at(0));
    this.renderer.render(world.scene, this.camera);
    const before = document.createElement("canvas");
    before.width = this.width;
    before.height = this.height;
    before.getContext("2d")!.drawImage(this.renderer.domElement, 0, 0);
    this.before = before;
    this.renderAt(0);
  }

  private apply(s: ShotState): void {
    const w = this.world!;
    this.camera.position.copy(toWorld(s.pose.position));
    this.camera.quaternion.copy(quaternionFor(s.pose.orientation));
    this.camera.fov = s.pose.vfovDeg;
    this.camera.updateProjectionMatrix();

    w.envMix.value = Math.min(1, Math.max(0, s.envPhoto));
    w.targetMix.value = Math.min(1, Math.max(0, s.targetPhoto));
    const fog = Math.min(1, Math.max(0, s.fog));
    w.fog.near = fog > 0.001 ? 140 + (1 - fog) * 3000 : 1e5;
    w.fog.far = fog > 0.001 ? 900 + (1 - fog) * 6000 : 2e5;

    const evening = Math.min(1, Math.max(0, s.evening));
    const dir = new Vector3().copy(w.daySun).lerp(w.eveningSun, evening).normalize();
    w.sun.position.copy(w.base).addScaledVector(dir, (w.radius * 3.2 + 10) * 2.5);
    w.sun.color.copy(WHITE).lerp(EVENING_SUN, evening);
    w.sun.intensity = 2.3 - 0.7 * evening;
    w.hemi.intensity = 1.15 - 0.3 * evening;
    w.hemi.color.set("#e3ebf3").lerp(EVENING_HEMI_SKY, evening);
    w.hemi.groundColor.copy(DAY_HEMI_GROUND).lerp(EVENING_HEMI_GROUND, evening);
    w.skyMaterial.color.copy(WHITE).lerp(EVENING_SKY, evening);
    w.fog.color.copy(SKY_HORIZON).lerp(EVENING_SKY, evening * 0.8);
    this.renderer.toneMappingExposure = 1 - 0.04 * evening;

    w.edgeMaterial.opacity = 0.75 * Math.min(1, Math.max(0, s.edges));
    const n = w.floorMaterials.length;
    w.floorMaterials.forEach((m, i) => {
      const local = Math.min(1, Math.max(0, s.floors * (n + 2) - i));
      m.opacity = 0.55 * local * Math.min(1, Math.max(0, s.edges));
    });
    this.dims!.setProgress(s.dims);
    this.dims!.setFade(s.dimsFade);
    for (const [channel, p] of Object.entries(s.decor)) this.decor!.setProgress(channel as DecorChannel, p);
    this.decor!.setEvening(Math.max(0, s.lightsOn), Math.max(0, s.washOn));
  }

  renderAt(t: number): void {
    if (!this.world || !this.timeline) return;
    this.time = Math.min(Math.max(0, t), this.timeline.duration);
    const state = this.timeline.at(this.time);
    this.apply(state);
    this.renderer.render(this.world.scene, this.camera);
    this.composite(state);
    this.onTime?.(this.time, this.timeline.duration);
  }

  private pill(text: string, x: number, y: number, size: number, bg: string, fg: string, align: "center" | "left" = "center") {
    const ctx = this.ctx;
    ctx.font = `600 ${size}px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w = ctx.measureText(text).width + size * 1.1;
    const h = size * 1.75;
    const left = align === "center" ? x - w / 2 : x;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(left, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, left + w / 2, y + size * 0.04);
  }

  private composite(s: ShotState): void {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.renderer.domElement, 0, 0, W, H);

    if (s.wipe !== null && this.before) {
      const x = Math.round(s.wipe * W);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, H);
      ctx.clip();
      ctx.drawImage(this.before, 0, 0);
      ctx.restore();
      if (x > 2 && x < W - 2) {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillRect(x - 2, 0, 4, H);
      }
      const size = Math.round(H * 0.018);
      if (x > W * 0.18) this.pill("BEFORE", x - size * 4.2, H * 0.08, size, "rgba(0,0,0,0.55)", "#fff");
      if (x < W * 0.82) this.pill("WHAT IF", x + size * 4.6, H * 0.08, size, DIM_COLOR, "#fff");
    }

    // Dimension labels at their projected anchors.
    if (this.dims) {
      for (const label of this.dims.labels(Math.max(0, s.dimsFade))) {
        if (label.alpha <= 0.01) continue;
        const p = label.anchor.clone().project(this.camera);
        if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) continue;
        ctx.globalAlpha = label.alpha;
        this.pill(label.text, (p.x * 0.5 + 0.5) * W, (1 - (p.y * 0.5 + 0.5)) * H, Math.round(H * 0.021), DIM_COLOR, "#fff");
      }
      ctx.globalAlpha = 1;
    }

    if (s.title && s.title.alpha > 0.01) {
      ctx.globalAlpha = s.title.alpha;
      this.pill("WHAT IF", W / 2, H * 0.085, Math.round(H * 0.014), DIM_COLOR, "#fff");
      this.pill(s.title.text, W / 2, H * 0.128, Math.round(H * 0.024), "rgba(255,255,255,0.88)", "#1a1a1a");
      ctx.globalAlpha = 1;
    }

    if (s.caption && s.caption.alpha > 0.01) {
      ctx.globalAlpha = s.caption.alpha;
      const size = Math.round(H * 0.03);
      this.pill(s.caption.text, W / 2, H * 0.86, size, "rgba(12,12,12,0.72)", "#fff");
      if (s.caption.sub) this.pill(s.caption.sub, W / 2, H * 0.86 + size * 2.1, Math.round(size * 0.55), "rgba(255,255,255,0.85)", "#222");
      ctx.globalAlpha = 1;
    }

    if (s.endCard > 0.01) {
      ctx.globalAlpha = s.endCard;
      ctx.fillStyle = "rgba(10,10,10,0.55)";
      ctx.fillRect(0, H * 0.38, W, H * 0.2);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 ${Math.round(H * 0.06)}px "Inter", system-ui, sans-serif`;
      ctx.fillText("What if?", W / 2, H * 0.455);
      ctx.font = `500 ${Math.round(H * 0.02)}px "Inter", system-ui, sans-serif`;
      ctx.fillText("Point your camera at any building", W / 2, H * 0.52);
      ctx.globalAlpha = 1;
    }

    // Always on: what is synthetic, and whose map this is.
    if (this.spec?.synthetic) this.pill("SYNTHETIC SCENE", W * 0.04, H * 0.035, Math.round(H * 0.014), "#c62828", "#fff", "left");
    ctx.font = `500 ${Math.round(H * 0.011)}px system-ui, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    const credit = this.spec?.synthetic ? "Synthetic footprints · AI estimates" : `Map data ${this.spec?.attribution ?? ""} · AI estimates`;
    ctx.strokeText(credit, W * 0.97, H * 0.985);
    ctx.fillText(credit, W * 0.97, H * 0.985);
  }

  play(from = 0): void {
    if (!this.timeline) return;
    this.pause();
    this.playing = true;
    const started = performance.now() - from * 1000;
    const tick = () => {
      if (!this.playing || !this.timeline) return;
      const t = (performance.now() - started) / 1000;
      this.renderAt(t);
      if (t >= this.timeline.duration) {
        this.playing = false;
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Plays once in real time while recording the composited canvas. */
  async record(onProgress?: (share: number) => void): Promise<{ blob: Blob; mimeType: string }> {
    const mimeType = pickRecordingType();
    if (!mimeType || !this.timeline) throw new Error("This browser cannot record a canvas.");
    this.pause();
    this.renderAt(0);
    const stream = this.canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start(250);
    const duration = this.timeline.duration;
    await new Promise<void>((resolve) => {
      const started = performance.now();
      const tick = () => {
        const t = (performance.now() - started) / 1000;
        this.renderAt(t);
        onProgress?.(Math.min(1, t / duration));
        if (t >= duration + 0.3) resolve();
        else this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    });
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return { blob: new Blob(chunks, { type: mimeType }), mimeType };
  }

  private disposeScene(): void {
    this.decor?.dispose();
    this.world?.dispose();
    this.world = null;
    this.dims = null;
    this.decor = null;
  }

  dispose(): void {
    this.pause();
    this.disposeScene();
    this.renderer.dispose();
  }
}
