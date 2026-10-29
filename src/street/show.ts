/**
 * What's Ahead (Street Ahead in the code) as a moving infographic on black. While the street is looked
 * up, the photo folds into a dot on a radar and the readings come in line by
 * line. Then a light runs from where you stand down the street, dotting each
 * place at its distance and side and stopping to name the landmarks, and the
 * camera rises to show the whole street. Each chip sends the light down the
 * street again for one kind of place. Drawn on a 2D canvas through the
 * perspective camera in show-plan.ts; buttons, chips and cards are HTML.
 */
import { modelCanvas, modelJpeg } from "../capture/model-photo.js";
import type { CaptureMeta } from "../capture/types.js";
import { normDeg, type EN } from "../geo/enu.js";
import { h, svg } from "../ui/dom.js";
import type { ShopAhead } from "./ahead.js";
import type { Quest } from "./quest.js";
import { QuestSheet } from "./quest-ui.js";
import { pointAt, type Route } from "./route.js";
import { drawShareCard, shareCard } from "./share-card.js";
import {
  chaseTrack,
  dotSpot,
  easeInOut,
  easeOutBack,
  IMPACT_MS,
  impactPunch,
  FOLLOW,
  followPose,
  groupOf,
  GROUPS,
  histogram,
  kindWord,
  LIGHT,
  lightRun,
  lerpPose,
  overviewPose,
  pickGroup,
  pickLandmarks,
  projector,
  QUEST_GOLD,
  radarPose,
  REVEAL_PACE,
  sampleRoute,
  screenSide,
  TOUR_FOLLOW,
  TOUR_PACE,
  type Group,
  type LightRun,
  type Pose,
  type Projected,
  type View,
} from "./show-plan.js";
import { drawTag, glow, MONO, rgba, SANS, tagMeasure, type TagStyle } from "./show-draw.js";
import { distanceText } from "./signs.js";
import { cutSign, drawSignBoxes, numberSigns, readSamReply, signsForPlaces, type SignBox } from "./sign-boxes.js";
import { spotPlaces, type Spotted } from "./spotted.js";
import { layoutLabels, roadSpan, type Box, type LabelInput, type PlacedLabel, type ScreenPoint } from "./street-labels.js";
import { localRoute, type StreetAhead } from "./street.js";

/** Shortest time the radar shows, so it reads even when the street comes back at once. */
const MIN_COMPUTE_MS = 2400;
const PHOTO_SCAN_MS = 1000;
const PHOTO_FOLD_MS = 800;
/** The sign check waits this long at most for SAM 3.1's signs, then reads the plain photo as before. */
const SAM_WAIT_MS = 3000;
/** A sign's picture is cut from the full photo when it comes out at most this wide. */
const CUT_MAX_PX = 420;
/** The readings stay up this long once the street is in. */
const HOLD_MS = 1000;
/** The camera tilts from straight down to behind the light. */
const TILT_MS = 1600;
/** The light sets off this long after the tilt begins. */
const LIGHT_DELAY_MS = 500;
/** Before a tour the camera goes back to the start. */
const TOUR_LEAD_MS = 1000;
const SETTLE_MS = 1800;
/** A dot's ripple when the light reaches it. */
const BIRTH_MS = 700;
/** Pixels per metre at which lines and dots are drawn at their base size. */
const REF_PPM = 2;
const FOV_DEG = 50;
/** Room the ruler takes at the right edge. */
const RULER_PX = 34;
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export type StreetShowOptions = {
  origin: { lat: number; lon: number };
  headingDeg: number;
  photo?: HTMLCanvasElement;
  capture?: CaptureMeta;
  onClose: () => void;
  onRetry?: () => void;
  /** A busier street to fly down when none (or no place) is found here: the nearest famous one. */
  elsewhere?: { label: string; go: () => void };
  /** Ask SAM 3.1 for the signs in the photo (true unless the page says no, ?sam=0). */
  sam?: boolean;
};

/** What the light is showing: every place (null), one kind of place, or a quest's stops. */
type Focus = {
  key: string;
  noun: string;
  color: string;
  match: (shop: ShopAhead) => boolean;
  picks: ShopAhead[];
  quest?: { quest: Quest; stops: ShopAhead[] };
};

type Run = {
  focus: Focus | null;
  first: boolean;
  from: Pose;
  /** When the camera starts to move, show milliseconds. */
  beginAt: number;
  moveMs: number;
  /** When the light leaves. */
  start: number;
  light: LightRun;
  /** Where the camera is along the street, seconds after the light left. */
  chase: (t: number) => number;
  /** When the light reaches each place it shows. */
  born: Map<string, number>;
};

type LabelItem = TagStyle & { shop?: ShopAhead };

type ConsoleRow = { id: string; key: string; value: string; state: "wait" | "done" | "info" | "fail" };

/** A four-pointed spark, filled (24 × 24 view box). */
const SPARKLE_PATH = "M12 2.5c.5 4.6 2.9 7 9.5 9.5-6.6 2.5-9 4.9-9.5 9.5-.5-4.6-2.9-7-9.5-9.5 6.6-2.5 9-4.9 9.5-9.5z";
/** An arrow leaving to the upper right: the link opens elsewhere (24 × 24 view box). */
const OUT_PATH = "M8 16 16.5 7.5M9.5 7.5h7v7";
/** A box with an arrow leaving it upward, stroked (24 × 24 view box). */
const SHARE_PATH = "M12 15V3.5M7.5 8 12 3.5 16.5 8M6 11.5H5v9h14v-9h-1";

function buttonIcon(d: string, filled: boolean): SVGSVGElement {
  const icon = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  icon.append(
    svg("path", filled ? { d, fill: "currentColor" } : { d, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }),
  );
  return icon;
}

export function compassPoint(deg: number): string {
  return COMPASS[Math.round(normDeg(deg) / 22.5) % 16];
}

export class StreetShow {
  readonly element: HTMLElement;
  private readonly options: StreetShowOptions;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly nameEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly kickerEl: HTMLElement;
  private readonly consoleEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly skipEl: HTMLButtonElement;
  private readonly bottomEl: HTMLElement;
  private readonly barEl: HTMLElement;
  private readonly chipsEl: HTMLElement;
  private readonly creditEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly questBarEl: HTMLElement;
  private readonly captionEl: HTMLElement;
  private captionKey = "";
  private readonly questButton: HTMLButtonElement;
  private readonly shareButton: HTMLButtonElement;
  private questSheet: QuestSheet | null = null;

  private street: StreetAhead | null = null;
  private route: Route | null = null;
  private line: { points: EN[]; along: number[] } | null = null;
  private spots = new Map<string, EN>();
  private landmarks: ShopAhead[] = [];
  private failure: string | null = null;
  private failedAt = 0;
  private phase: "computing" | "failed" | "run" | "settle" | "overview" = "computing";
  private loadedAt = 0;
  private revealAt = Infinity;
  private run: Run | null = null;
  private revealed = false;
  private focus: Focus | null = null;
  private settleAt = 0;
  private settleFrom: Pose | null = null;
  private overview: Pose = radarPose(0);
  private lastPose: Pose;
  private view: View = { width: 1, height: 1, fovDeg: FOV_DEG };
  private insets = { top: 120, bottom: 170 };
  private labels: PlacedLabel<LabelItem>[] = [];
  private roadOnScreen: ScreenPoint[][] = [];
  /** Landmarks whose arrival has buzzed the phone in this run. */
  private felt = new Set<string>();
  private selected: ShopAhead | null = null;
  private spotted = new Set<string>();
  /** The photo at the size Meta's models get, made once, and its JPEG. */
  private model: { canvas: HTMLCanvasElement; jpeg: string } | null = null;
  /** SAM 3.1 on the photo: not asked (no photo, or switched off), asking, answered, or failed (the page goes on without it). */
  private samState: "off" | "asking" | "done" | "failed" = "off";
  private samFound = 0;
  private signBoxes: SignBox[] = [];
  private samDone: Promise<void> = Promise.resolve();
  /** Each place's sign cut out of the photo, for the places Muse Spark read in one of SAM's boxes. */
  private signCuts = new Map<string, string>();
  private vignette: HTMLCanvasElement | null = null;
  private t0 = performance.now();
  private frozen: number | null = null;
  private raf = 0;
  private disposed = false;
  private noteTimer = 0;
  private hudKey = "";
  private consoleHead: HTMLElement | null = null;
  private consoleRowsEl: HTMLElement | null = null;
  private readonly consoleRowEls = new Map<string, { el: HTMLElement; v: HTMLElement; mark: HTMLElement }>();
  private readonly abort = new AbortController();

  constructor(options: StreetShowOptions) {
    this.options = options;
    this.lastPose = radarPose(options.headingDeg);
    this.canvas = h("canvas", { class: "show-canvas", role: "img", "aria-label": "The street ahead, drawn as a line of light with its places as dots" });
    this.ctx = this.canvas.getContext("2d")!;
    this.kickerEl = h("div", { class: "show-kicker", text: "WHAT'S AHEAD" });
    this.nameEl = h("div", { class: "show-name", text: "Finding your street" });
    this.statsEl = h("div", { class: "show-stats" });
    // The quest is the main thing to do next, and names the model that plans it.
    this.questButton = h(
      "button",
      { class: "show-btn primary hidden", onclick: () => this.questSheet?.open() },
      buttonIcon(SPARKLE_PATH, true),
      h("span", { class: "show-btn-text" }, h("span", { class: "show-btn-label", text: "Make a quest" }), h("span", { class: "show-btn-tag", text: "Planned by Muse Spark" })),
    );
    this.shareButton = h("button", { class: "show-btn hidden", onclick: () => void this.share() }, buttonIcon(SHARE_PATH, false), h("span", { class: "show-btn-label", text: "Share" }));
    const close = h("button", { class: "show-icon", "aria-label": "Close", title: "Close", onclick: options.onClose }, "×");
    this.consoleEl = h("div", { class: "show-console" });
    this.noteEl = h("div", { class: "show-note hidden" });
    this.skipEl = h("button", { class: "show-skip hidden", onclick: () => this.skip() }, "Skip ›");
    this.barEl = h("div", { class: "show-bar" });
    this.chipsEl = h("div", { class: "show-chips" });
    this.questBarEl = h("div", { class: "show-quest hidden" });
    this.creditEl = h("div", { class: "show-credit", text: "Map © OpenStreetMap contributors" });
    this.captionEl = h("div", { class: "show-caption hidden" });
    this.bottomEl = h("div", { class: "show-bottom away" }, this.questBarEl, h("div", { class: "show-actions" }, this.questButton, this.shareButton), this.barEl, this.chipsEl);
    this.cardEl = h("div", { class: "show-card hidden" });
    this.element = h(
      "main",
      { class: "show" },
      this.canvas,
      h("div", { class: "show-top" }, h("div", { class: "show-heading" }, this.kickerEl, this.nameEl, this.statsEl), h("div", { class: "show-buttons" }, this.skipEl, close)),
      this.noteEl,
      this.consoleEl,
      this.captionEl,
      this.bottomEl,
      this.creditEl,
      this.cardEl,
    );
    this.canvas.addEventListener("click", (e) => this.tap(e));
    window.addEventListener("resize", this.onResize);
  }

  /** Starts drawing; call once the element is in the page. */
  start(): void {
    this.t0 = performance.now();
    this.onResize();
    // SAM 3.1 looks for the signs while the street is looked up; nothing waits for it.
    if (this.options.photo && this.options.sam !== false) this.samDone = this.findSigns();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.frame(this.clock());
    };
    tick();
  }

  /** The street is in: the show goes on once the radar has had its moment. */
  load(street: StreetAhead): void {
    if (this.disposed) return;
    const now = this.clock();
    this.street = street;
    this.route = localRoute(street);
    this.line = sampleRoute(this.route, 10);
    this.spots = new Map(street.shops.map((shop) => [shop.id, dotSpot(this.route!, shop)]));
    this.landmarks = pickLandmarks(street.shops, street.route.length, street.name);
    this.loadedAt = now;
    const minimum = this.options.photo ? PHOTO_SCAN_MS + PHOTO_FOLD_MS + 900 : MIN_COMPUTE_MS;
    this.revealAt = Math.max(now, minimum) + HOLD_MS;
    this.buildChips();
    this.measureInsets();
    const credits = street.attribution.replace(/ \((ODbL|CDLA-Permissive-2\.0)\)/g, "");
    this.creditEl.textContent = street.synthetic && !credits.includes("SYNTHETIC") ? `${credits} · SYNTHETIC` : credits;
    this.kickerEl.replaceChildren("WHAT'S AHEAD", street.synthetic ? h("span", { class: "badge", text: "SYNTHETIC" }) : "");
    this.questSheet = new QuestSheet(street.shops, (quest, stops) => this.startQuest(quest, stops));
    this.questSheet.element.classList.add("show-sheet");
    this.element.append(this.questSheet.element);
    this.skipEl.classList.remove("hidden");
    if (street.shops.length === 0) {
      this.note("The map has no places along this street yet.", 6000);
      this.offerElsewhere();
    }
    if (this.options.photo) void this.checkSigns();
  }

  /** The lookup failed: the radar stays, the reason shows, with a way to try again. */
  fail(message: string): void {
    if (this.disposed) return;
    this.failure = message;
    this.failedAt = this.clock();
    this.phase = "failed";
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.noteTimer);
    window.removeEventListener("resize", this.onResize);
  }

  /** For the browser tests and recordings: draw the show as it is `ms` after it started (null: back to the clock). */
  freeze(ms: number | null): void {
    this.frozen = ms;
    if (ms !== null) this.frame(ms);
  }

  /** For the browser tests: where the show is. */
  state(): { phase: string; loaded: boolean; focus: string | null; landmarks: string[]; labels: string[] } {
    return {
      phase: this.phase,
      loaded: this.street !== null,
      focus: this.focus?.key ?? null,
      landmarks: this.landmarks.map((s) => s.name),
      labels: this.labels.map((l) => l.lines.join(" ")),
    };
  }

  private clock(): number {
    return this.frozen ?? performance.now() - this.t0;
  }

  private onResize = (): void => {
    const rect = this.element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    // The street runs halfway between the left edge and the ruler, so both columns of tags get the same room.
    this.view = { width, height, fovDeg: FOV_DEG, centerX: (width - RULER_PX) / 2 };
    this.vignette = null;
    this.measureInsets();
  };

  /** Room the header and the bottom bar take, from the layout (not from where the bar is while it slides in). */
  private measureInsets(): void {
    const top = this.element.querySelector<HTMLElement>(".show-top");
    const height = this.element.clientHeight || this.view.height;
    this.insets = {
      top: top ? top.offsetTop + top.offsetHeight + 8 : 120,
      bottom: this.bottomEl.offsetHeight > 0 ? Math.max(90, height - this.bottomEl.offsetTop + 8) : 170,
    };
    this.updateOverview();
  }

  /** How far the light goes: the whole street, or for a quest a little past its last stop. */
  private reach(focus: Focus | null): number {
    const length = this.street?.route.length ?? 0;
    if (!focus?.quest) return length;
    return Math.min(length, Math.max(600, ...focus.quest.stops.map((s) => s.s + 300)));
  }

  private updateOverview(): void {
    if (!this.line) return;
    const reach = this.reach(this.focus);
    const line = this.line.points.filter((_, i) => this.line!.along[i] <= reach);
    const step = Math.max(1, Math.floor(line.length / 120));
    const pts = line.filter((_, i) => i % step === 0);
    pts.push(line[line.length - 1], { x: 0, y: 0 });
    // The street down the middle, with room for a column of tags on each side (and the rail on the right).
    const side = Math.max(60, Math.round((this.view.width - RULER_PX) * 0.27));
    this.overview = overviewPose(pts, this.view, { top: this.insets.top + 30, bottom: this.insets.bottom + 24, left: side, right: side + RULER_PX });
  }

  // ----- Time -----

  private update(now: number): void {
    if (this.phase === "computing" && this.street && now >= this.revealAt) {
      this.beginRun(null, this.revealAt, true);
      // With reduced motion the light's run is skipped: straight to the whole street.
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) this.skip();
    }
    const run = this.run;
    if (this.phase === "run" && run && now >= run.start + run.light.duration * 1000) {
      this.phase = "settle";
      this.settleAt = run.start + run.light.duration * 1000;
      this.settleFrom = followPose(this.route!, run.chase(run.light.duration), run.first ? FOLLOW : TOUR_FOLLOW);
      if (run.first) {
        this.revealed = true;
        this.questButton.classList.remove("hidden");
        this.shareButton.classList.remove("hidden");
      }
      this.bottomEl.classList.remove("away");
      this.skipEl.textContent = "↺";
      this.skipEl.setAttribute("aria-label", "Replay");
      this.skipEl.classList.add("icon");
      this.measureInsets();
    }
    if (this.phase === "settle" && now >= this.settleAt + SETTLE_MS) this.phase = "overview";
  }

  /** Sends the light down the street for one focus (null: every place), from where the camera is now. */
  private beginRun(focus: Focus | null, at: number, first = false): void {
    const street = this.street;
    if (!street || !this.route) return;
    this.focus = focus;
    this.selected = null;
    this.cardEl.classList.add("hidden");
    this.updateOverview();
    const picks = focus ? focus.picks : this.landmarks;
    const light = lightRun(this.route.along[0], this.reach(focus), picks.map((p) => p.s), first ? REVEAL_PACE : focus?.quest ? { ...TOUR_PACE, dwell: 0.9 } : TOUR_PACE);
    const moveMs = first ? TILT_MS : TOUR_LEAD_MS;
    const start = at + (first ? LIGHT_DELAY_MS : TOUR_LEAD_MS);
    const born = new Map<string, number>();
    for (const shop of street.shops) if (!focus || focus.match(shop)) born.set(shop.id, start + light.when(shop.s) * 1000);
    this.run = { focus, first, from: first ? radarPose(this.options.headingDeg) : this.lastPose, beginAt: at, moveMs, start, light, chase: chaseTrack(light), born };
    this.felt.clear();
    this.phase = "run";
    this.skipEl.textContent = "Skip ›";
    this.skipEl.removeAttribute("aria-label");
    this.skipEl.classList.remove("hidden", "icon");
    if (!first) this.bottomEl.classList.remove("away");
    this.renderChips();
  }

  private skip(): void {
    const now = this.clock();
    if (this.phase === "computing" && this.street) {
      this.revealAt = now;
      this.update(now);
    }
    const run = this.run;
    if (this.phase === "run" && run) {
      // Jump to the end of the run: everything it would have shown is shown.
      const shift = run.start + run.light.duration * 1000 - now;
      run.start -= shift;
      run.beginAt -= shift;
      for (const [id, t] of run.born) run.born.set(id, t - shift);
      this.update(now);
      return;
    }
    if (this.phase === "settle" || this.phase === "overview") this.beginRun(this.focus, now);
  }

  private headAt(now: number): number {
    const run = this.run;
    if (!run || !this.street) return 0;
    if (this.phase !== "run") return run.light.to;
    return run.light.at((now - run.start) / 1000);
  }

  private poseAt(now: number): Pose {
    switch (this.phase) {
      case "computing":
      case "failed":
        return radarPose(this.options.headingDeg);
      case "run": {
        const run = this.run!;
        const follow = followPose(this.route!, run.chase((now - run.start) / 1000), run.first ? FOLLOW : TOUR_FOLLOW);
        // A short punch in towards each landmark as the light reaches it.
        let punch = 0;
        for (const shop of this.focus ? this.focus.picks : this.landmarks) {
          const born = run.born.get(shop.id);
          if (born !== undefined) punch = Math.max(punch, impactPunch(now - born));
        }
        follow.distance *= 1 - (run.first ? 0.08 : 0.045) * punch;
        const k = easeInOut((now - run.beginAt) / run.moveMs);
        return k >= 1 ? follow : lerpPose(run.from, follow, k);
      }
      case "settle":
        return lerpPose(this.settleFrom!, this.overview, easeInOut((now - this.settleAt) / SETTLE_MS));
      default:
        return this.overview;
    }
  }

  // ----- Drawing -----

  private frame(now: number): void {
    if (this.disposed) return;
    this.update(now);
    const pose = this.poseAt(now);
    this.lastPose = pose;
    const project = projector(pose, this.view);
    const ctx = this.ctx;
    const dpr = this.canvas.width / this.view.width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.view.width, this.view.height);
    ctx.drawImage(this.vignetteCanvas(), 0, 0, this.view.width, this.view.height);
    const head = this.headAt(now);
    this.drawGrid(project, pose, now, head);
    this.drawRadar(project, now);
    if (this.street && this.route && this.line && this.phase !== "computing") {
      this.drawTicks(project, pose, head);
      this.drawRoute(project, pose, head);
      this.drawDots(project, pose, now);
      this.drawYou(project, 1 - this.radarAlpha(now));
      if (this.phase === "run") this.drawHead(project, head);
      else this.drawPulse(project, now);
      this.drawPicks(project, now, head);
      this.drawRail(now, head);
    }
    this.drawPhoto(now);
    this.updateHud(now, head);
    this.updateCaption(now);
  }

  private vignetteCanvas(): HTMLCanvasElement {
    if (this.vignette) return this.vignette;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = Math.max(64, Math.round((256 * this.view.height) / this.view.width));
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(c.width / 2, c.height * 0.42, 0, c.width / 2, c.height * 0.42, Math.hypot(c.width, c.height) * 0.62);
    grad.addColorStop(0, "#0b1522");
    grad.addColorStop(0.55, "#04080d");
    grad.addColorStop(1, "#000000");
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    this.vignette = c;
    return c;
  }

  /** Far things fade, as in haze; how far is far depends on how far out the camera is. */
  private fog(depth: number, pose: Pose): number {
    return Math.min(1, Math.max(0.2, 1.3 - depth / (4 * pose.distance)));
  }

  /**
   * The floor: grid lines every 100 m (every 250 m once the camera is far
   * out), lit around the light. While computing it is read out from where
   * you stand like a scan.
   */
  private drawGrid(project: (p: EN, z?: number) => Projected | null, pose: Pose, now: number, head: number): void {
    const near = Math.min(1, Math.max(0, (3200 - pose.distance) / 1200));
    if (near > 0.01) this.drawGridAt(project, pose, now, head, 100, 24, near);
    if (near < 0.99) this.drawGridAt(project, pose, now, head, 250, 22, 1 - near);
  }

  private drawGridAt(project: (p: EN, z?: number) => Projected | null, pose: Pose, now: number, head: number, step: number, half: number, weight: number): void {
    const ctx = this.ctx;
    const { width: w, height: hgt } = this.view;
    const n = 2 * half + 1;
    const x0 = (Math.round(pose.x / step) - half) * step;
    const y0 = (Math.round(pose.y / step) - half) * step;
    const nodes: (Projected | null)[] = [];
    for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) nodes.push(project({ x: x0 + i * step, y: y0 + j * step }));
    const headAt = this.route && this.phase === "run" ? pointAt(this.route, head).at : null;
    const computing = this.phase === "computing" || this.phase === "failed";
    const scan = computing ? 120 + 900 * easeInOut((now - (this.options.photo ? PHOTO_SCAN_MS : 0)) / 2400) : Infinity;
    // Segments sorted by brightness into a few paths.
    const levels = new Map<number, number[]>();
    const add = (a: number, b: number, mx: number, my: number) => {
      const p = nodes[a];
      const q = nodes[b];
      if (!p || !q) return;
      if ((p.x < 0 && q.x < 0) || (p.x > w && q.x > w) || (p.y < 0 && q.y < 0) || (p.y > hgt && q.y > hgt)) return;
      const r = Math.hypot(mx, my);
      if (r > scan) return;
      let alpha = 0.075 * this.fog((p.depth + q.depth) / 2, pose);
      if (scan !== Infinity) alpha *= 1 + 2 * Math.min(1, Math.max(0, (scan - r) / 160)) * Math.min(1, Math.max(0, 1 - (scan - r) / 600));
      if (headAt) alpha += 0.2 * Math.exp(-((mx - headAt.x) ** 2 + (my - headAt.y) ** 2) / (2 * 260 ** 2));
      const level = Math.round(alpha * weight * 40);
      if (level <= 0) return;
      let list = levels.get(level);
      if (!list) levels.set(level, (list = []));
      list.push(p.x, p.y, q.x, q.y);
    };
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = x0 + i * step;
        const y = y0 + j * step;
        if (i + 1 < n) add(j * n + i, j * n + i + 1, x + step / 2, y);
        if (j + 1 < n) add(j * n + i, (j + 1) * n + i, x, y + step / 2);
      }
    }
    ctx.lineWidth = 1;
    ctx.lineCap = "butt";
    for (const [level, list] of levels) {
      ctx.strokeStyle = rgba(LIGHT, Math.min(0.6, level / 40));
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 4) {
        ctx.moveTo(list[k], list[k + 1]);
        ctx.lineTo(list[k + 2], list[k + 3]);
      }
      ctx.stroke();
    }
  }

  /** The radar while the street is found: your dot, its pulses, the compass turned to your heading, the direction you face. */
  private radarAlpha(now: number): number {
    const enter = this.options.photo ? PHOTO_SCAN_MS + 300 : 0;
    const fadeIn = easeInOut((now - enter) / 700);
    const fadeOut = this.phase === "computing" || this.phase === "failed" ? 1 : 1 - easeInOut((now - this.revealAt) / 800);
    return fadeIn * fadeOut;
  }

  private drawRadar(project: (p: EN, z?: number) => Projected | null, now: number): void {
    const alpha = this.radarAlpha(now);
    if (alpha <= 0.01) return;
    const c = project({ x: 0, y: 0 });
    const n = project({ x: 0, y: 100 });
    if (!c || !n) return;
    const ctx = this.ctx;
    const north = Math.atan2(n.x - c.x, -(n.y - c.y));
    const failed = this.phase === "failed";
    const tint = failed ? "#ff6b6b" : LIGHT;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(c.x, c.y);
    ctx.globalCompositeOperation = "lighter";
    // The direction you face, up the screen.
    const breathe = 1 + 0.04 * Math.sin(now / 420);
    const cone = ctx.createLinearGradient(0, 0, 0, -240 * breathe);
    cone.addColorStop(0, rgba(tint, 0.32));
    cone.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 240 * breathe, -Math.PI / 2 - 0.36, -Math.PI / 2 + 0.36);
    ctx.closePath();
    ctx.fill();
    // Rings and pulses.
    ctx.lineWidth = 1;
    for (const r of [60, 120]) {
      ctx.strokeStyle = rgba(tint, 0.14);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let k = 0; k < 3; k += 1) {
      const t = ((now / 1800 + k / 3) % 1 + 1) % 1;
      ctx.strokeStyle = rgba(tint, 0.5 * (1 - t));
      ctx.beginPath();
      ctx.arc(0, 0, 8 + 200 * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    // A sweep, like a radar's.
    const sweep = (now / 2600) * Math.PI * 2;
    for (let k = 0; k < 14; k += 1) {
      ctx.strokeStyle = rgba(tint, 0.22 * (1 - k / 14));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const a = sweep - k * 0.035;
      ctx.lineTo(Math.sin(a) * 150, -Math.cos(a) * 150);
      ctx.stroke();
    }
    // The compass, north where the map's north is.
    ctx.globalCompositeOperation = "source-over";
    ctx.rotate(north);
    ctx.strokeStyle = rgba("#ffffff", 0.4);
    for (let d = 0; d < 360; d += 10) {
      const a = (d * Math.PI) / 180;
      const long = d % 90 === 0 ? 12 : d % 30 === 0 ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * 150, -Math.cos(a) * 150);
      ctx.lineTo(Math.sin(a) * (150 - long), -Math.cos(a) * (150 - long));
      ctx.stroke();
    }
    ctx.font = `600 11px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [i, word] of ["N", "E", "S", "W"].entries()) {
      const a = (i * Math.PI) / 2;
      ctx.save();
      ctx.translate(Math.sin(a) * 166, -Math.cos(a) * 166);
      ctx.rotate(-north);
      ctx.fillStyle = word === "N" ? tint : "rgba(255,255,255,0.55)";
      ctx.fillText(word, 0, 0);
      ctx.restore();
    }
    ctx.rotate(-north);
    // Your dot.
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(glow(tint, true), -34, -34, 68, 68);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = `600 10px ${MONO}`;
    ctx.fillText("YOU", 0, 22);
    ctx.fillStyle = tint;
    ctx.font = `600 12px ${MONO}`;
    ctx.fillText(`${Math.round(normDeg(this.options.headingDeg))}° ${compassPoint(this.options.headingDeg)}`, 0, -252);
    ctx.restore();
  }

  /** The photo while it is read: a scan line runs down it, then it folds into your dot. */
  private drawPhoto(now: number): void {
    const photo = this.options.photo;
    if (!photo || now > PHOTO_SCAN_MS + PHOTO_FOLD_MS) return;
    const { width: w, height: hgt } = this.view;
    const ctx = this.ctx;
    const fold = easeInOut((now - PHOTO_SCAN_MS) / PHOTO_FOLD_MS);
    const scale = Math.max(w / photo.width, hgt / photo.height) * (1 - 0.3 * fold);
    const cx = w / 2;
    const cy = hgt / 2;
    const r = Math.hypot(w, hgt) / 2 + (26 - Math.hypot(w, hgt) / 2) * fold;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1 - fold ** 3;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(photo, cx - (photo.width * scale) / 2, cy - (photo.height * scale) / 2, photo.width * scale, photo.height * scale);
    ctx.fillStyle = `rgba(0,6,12,${0.3 + 0.5 * fold})`;
    ctx.fillRect(0, 0, w, hgt);
    const scan = easeInOut(now / PHOTO_SCAN_MS);
    if (scan < 1) {
      const y = scan * hgt;
      ctx.fillStyle = rgba(LIGHT, 0.08);
      ctx.fillRect(0, 0, w, y);
      ctx.strokeStyle = rgba(LIGHT, 0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < w; x += 36) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, y);
      }
      for (let yy = 0; yy < y; yy += 36) {
        ctx.moveTo(0, yy + 0.5);
        ctx.lineTo(w, yy + 0.5);
      }
      ctx.stroke();
      const band = ctx.createLinearGradient(0, y - 80, 0, y);
      band.addColorStop(0, rgba(LIGHT, 0));
      band.addColorStop(1, rgba(LIGHT, 0.4));
      ctx.fillStyle = band;
      ctx.fillRect(0, y - 80, w, 80);
      ctx.fillStyle = "#e6fbff";
      ctx.fillRect(0, y - 1, w, 2);
    }
    ctx.restore();
    // Dark bands under the title and the readings, so both read over a bright photo.
    ctx.save();
    ctx.globalAlpha = 1 - fold;
    const top = ctx.createLinearGradient(0, 0, 0, 140);
    top.addColorStop(0, "rgba(0,0,0,0.7)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, 140);
    const bottom = ctx.createLinearGradient(0, hgt - 300, 0, hgt);
    bottom.addColorStop(0, "rgba(0,0,0,0)");
    bottom.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = bottom;
    ctx.fillRect(0, hgt - 300, w, 300);
    ctx.restore();
    if (fold > 0) {
      ctx.strokeStyle = rgba(LIGHT, 0.9 * (1 - fold * 0.5));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Every 250 m a tick across the street, every kilometre with its number; drawn once the light has passed. */
  private drawTicks(project: (p: EN, z?: number) => Projected | null, pose: Pose, head: number): void {
    const ctx = this.ctx;
    const route = this.route!;
    const upTo = this.revealed ? Infinity : head;
    ctx.lineWidth = 1;
    ctx.font = `600 10px ${MONO}`;
    ctx.textBaseline = "middle";
    for (let m = 250; m < route.length && m <= upTo; m += 250) {
      const { at, headingDeg } = pointAt(route, m);
      const hd = (headingDeg * Math.PI) / 180;
      const across = { x: Math.cos(hd), y: -Math.sin(hd) };
      const km = m % 1000 === 0;
      const reach = km ? 22 : 12;
      const a = project({ x: at.x - across.x * reach, y: at.y - across.y * reach });
      const b = project({ x: at.x + across.x * reach, y: at.y + across.y * reach });
      if (!a || !b) continue;
      const fog = this.fog(a.depth, pose);
      ctx.strokeStyle = `rgba(255,255,255,${(km ? 0.5 : 0.22) * fog})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (km) {
        const left = a.x <= b.x ? a : b;
        ctx.fillStyle = `rgba(255,255,255,${0.62 * fog})`;
        ctx.textAlign = "right";
        ctx.fillText(`${m / 1000} KM`, left.x - 6, left.y);
      }
    }
  }

  /** The street as light: dim where the light has been before, bright where it runs now. */
  private drawRoute(project: (p: EN, z?: number) => Projected | null, pose: Pose, head: number): void {
    const line = this.line!;
    const pts = line.points.map((p) => project(p));
    // The whole street on the screen, behind the light and ahead of it: tags keep clear of it.
    this.roadOnScreen = [];
    let run: ScreenPoint[] = [];
    for (const q of pts) {
      if (q) run.push({ x: q.x, y: q.y });
      else if (run.length > 0) {
        this.roadOnScreen.push(run);
        run = [];
      }
    }
    if (run.length > 0) this.roadOnScreen.push(run);
    const color = this.focus?.color ?? LIGHT;
    const running = this.phase === "run";
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    if (this.revealed) this.strokeLine(pts, line.along, -Infinity, Infinity, pose, [[LIGHT, 0.06, 4], [LIGHT, 0.26, 1]]);
    if (!this.revealed || this.focus || running) {
      this.strokeLine(pts, line.along, -Infinity, running ? head : (this.run?.light.to ?? Infinity), pose, [
        [color, 0.14, 10],
        [color, 0.42, 3.5],
        [running ? "#ffffff" : color, 1, 1.3],
      ]);
    }
    if (running) {
      // Light thrown ahead along the street, fading out.
      for (let k = 0; k < 12; k += 1) this.strokeLine(pts, line.along, head + k * 30, head + (k + 1) * 30, pose, [[color, 0.32 * (1 - k / 12) ** 2, 2]]);
      // A comet's tail behind the light.
      const from = project(pointAt(this.route!, head - 200).at);
      const to = project(pointAt(this.route!, head).at);
      if (from && to) {
        const tail = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
        tail.addColorStop(0, rgba(color, 0));
        tail.addColorStop(1, rgba(color, 1));
        this.strokeLine(pts, line.along, head - 200, head, pose, [[tail, 0.5, 6]]);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Strokes the sampled street between two distances along it, in passes of
   * [colour, alpha, width]; the width shrinks with distance from the camera,
   * so the street runs off into the dark.
   */
  private strokeLine(pts: (Projected | null)[], along: number[], from: number, to: number, pose: Pose, passes: [string | CanvasGradient, number, number][]): void {
    const ctx = this.ctx;
    for (const [color, alpha, base] of passes) {
      ctx.strokeStyle = color;
      let width = -1;
      let open = false;
      for (let i = 0; i + 1 < pts.length; i += 1) {
        const a0 = along[i];
        const a1 = along[i + 1];
        if (a1 <= from || a0 >= to) continue;
        let p = pts[i];
        let q = pts[i + 1];
        if (!p || !q) {
          if (open) ctx.stroke();
          open = false;
          continue;
        }
        // Cut the first and last pieces at the ends asked for.
        if (a1 > to) q = { ...q, x: p.x + ((q.x - p.x) * (to - a0)) / (a1 - a0), y: p.y + ((q.y - p.y) * (to - a0)) / (a1 - a0) };
        if (a0 < from) p = { ...p, x: p.x + ((q.x - p.x) * (from - a0)) / (a1 - a0), y: p.y + ((q.y - p.y) * (from - a0)) / (a1 - a0) };
        const scale = Math.min(1.6, Math.max(0.35, ((p.pxPerM + q.pxPerM) / 2 / REF_PPM) ** 0.7));
        const w = Math.round(base * 2.4 * scale * 2) / 2;
        if (w !== width || !open) {
          if (open) ctx.stroke();
          ctx.lineWidth = Math.max(0.8, w);
          ctx.globalAlpha = alpha * this.fog(p.depth, pose);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          width = w;
          open = true;
        }
        ctx.lineTo(q.x, q.y);
      }
      if (open) ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private shopColor(shop: ShopAhead): string {
    return this.focus?.color ?? groupOf(shop.category).color;
  }

  /** Is the place lit, and since when (show time)? Null: shown dim, or not yet. */
  private bornAt(shop: ShopAhead): number | null {
    const run = this.run;
    if (!run) return null;
    return run.born.get(shop.id) ?? null;
  }

  private drawDots(project: (p: EN, z?: number) => Projected | null, pose: Pose, now: number): void {
    const ctx = this.ctx;
    const shops = this.street!.shops;
    // Dim first: the places the light is not showing, once the street has been revealed.
    if (this.revealed) {
      ctx.fillStyle = "#6b7785";
      for (const shop of shops) {
        const born = this.bornAt(shop);
        if (born !== null && born <= now) continue;
        if (born !== null && !this.revealed) continue;
        const q = project(this.spots.get(shop.id)!);
        if (!q) continue;
        ctx.globalAlpha = 0.45 * this.fog(q.depth, pose);
        ctx.fillRect(q.x - 0.9, q.y - 0.9, 1.8, 1.8);
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "lighter";
    for (const shop of shops) {
      const born = this.bornAt(shop);
      if (born === null || born > now) continue;
      const q = project(this.spots.get(shop.id)!);
      if (!q || q.x < -20 || q.x > this.view.width + 20 || q.y < -20 || q.y > this.view.height + 20) continue;
      const color = this.shopColor(shop);
      const age = now - born;
      const r = Math.min(3.4, Math.max(1.5, 2.2 * Math.sqrt(q.pxPerM / REF_PPM)));
      const pop = age < BIRTH_MS ? 1 + (1 - age / BIRTH_MS) ** 2 : 1;
      const size = r * 5.5 * pop;
      ctx.globalAlpha = this.fog(q.depth, pose);
      ctx.drawImage(glow(color, true), q.x - size / 2, q.y - size / 2, size, size);
      if (age < BIRTH_MS) {
        const t = age / BIRTH_MS;
        ctx.globalAlpha = 0.7 * (1 - t);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r + 11 * (1 - (1 - t) ** 3), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // The place last tapped.
    if (this.selected) {
      const q = project(this.spots.get(this.selected.id) ?? { x: 0, y: 0 });
      if (q) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 9 + Math.sin(now / 200), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawYou(project: (p: EN, z?: number) => Projected | null, alpha: number): void {
    const q = project({ x: 0, y: 0 });
    if (!q || alpha <= 0.01) return;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(glow("#ffffff", false), q.x - 16, q.y - 16, 32, 32);
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 10px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("YOU", q.x, q.y + 10);
    ctx.globalAlpha = 1;
  }

  private drawHead(project: (p: EN, z?: number) => Projected | null, head: number): void {
    const q = project(pointAt(this.route!, head).at);
    if (!q) return;
    const ctx = this.ctx;
    const color = this.focus?.color ?? LIGHT;
    const k = Math.min(1.5, Math.max(0.6, q.pxPerM / REF_PPM));
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(glow(color, true), q.x - 46 * k, q.y - 46 * k, 92 * k, 92 * k);
    // A small flare across the light.
    const flare = ctx.createLinearGradient(q.x - 60 * k, 0, q.x + 60 * k, 0);
    flare.addColorStop(0, rgba(color, 0));
    flare.addColorStop(0.5, rgba("#ffffff", 0.8));
    flare.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = flare;
    ctx.fillRect(q.x - 60 * k, q.y - 0.75, 120 * k, 1.5);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(q.x, q.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Once the street is shown, a soft light keeps running along it. */
  private drawPulse(project: (p: EN, z?: number) => Projected | null, now: number): void {
    const route = this.route!;
    const line = this.line!;
    const s = route.along[0] + ((now / 5200) % 1) * (route.length - route.along[0]);
    const pts = line.points.map((p) => project(p));
    const color = this.focus?.color ?? LIGHT;
    this.ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 10; k += 1) this.strokeLine(pts, line.along, s - (k + 1) * 24, s - k * 24, this.lastPose, [[color, 0.3 * (1 - k / 10), 4]]);
    this.ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Landmarks (or the tour's picks), once the light has reached them: a
   * flash and a ring at the place, and its name in a tag beside the street
   * on the place's side, clear of the street's line and of the caption.
   */
  private drawPicks(project: (p: EN, z?: number) => Projected | null, now: number, head: number): void {
    const ctx = this.ctx;
    const route = this.route!;
    const picks = this.focus ? this.focus.picks : this.landmarks;
    const inputs: LabelInput<LabelItem>[] = [];
    const font = this.phase === "run" ? 13 : 12;
    const quest = this.focus?.quest;
    const tag = (shop: ShopAhead, q: Projected, priority: number, color: string, number?: number): LabelInput<LabelItem> => ({
      key: shop.id,
      x: q.x,
      y: q.y,
      side: screenSide(project, route, shop),
      priority,
      name: `${this.spotted.has(shop.id) ? "✓ " : ""}${shop.name}`,
      detail: `${distanceText(shop.s)} · ${kindWord(shop.kind)}`.toUpperCase(),
      item: { shop, color, number },
      font,
    });
    picks.forEach((shop, i) => {
      const born = this.bornAt(shop) ?? (this.phase === "run" ? null : -Infinity);
      if (born === null || born > now) return;
      const q = project(this.spots.get(shop.id)!);
      if (!q) return;
      const color = this.shopColor(shop);
      const age = now - born;
      if (age < IMPACT_MS) this.drawImpact(project, this.spots.get(shop.id)!, q, age, color, this.lastPose);
      if (age >= 0 && age < IMPACT_MS && this.run?.first && !this.felt.has(shop.id)) {
        this.felt.add(shop.id);
        navigator.vibrate?.(14);
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgba(color, 0.85);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 6 + 2 * Math.sin(now / 260 + i), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
      // While the light runs, the place it reached last comes first.
      inputs.push(tag(shop, q, this.phase === "run" ? -born : q.depth, color, quest ? quest.stops.indexOf(shop) + 1 : undefined));
    });
    if (this.selected && !picks.includes(this.selected)) {
      const q = project(this.spots.get(this.selected.id)!);
      if (q) inputs.push(tag(this.selected, q, -Infinity, this.shopColor(this.selected)));
    }
    const area = { left: 8, top: this.insets.top, right: this.view.width - RULER_PX, bottom: this.labelBottom() };
    const blocked: Box[] = [];
    const you = project({ x: 0, y: 0 });
    // The "you" marker: its ring and the word under it.
    if (you) blocked.push({ x: you.x - 12, y: you.y - 9, w: 24, h: 33 });
    if (this.phase !== "run" || head >= this.run!.light.to - 1) {
      const end = project(pointAt(route, route.length).at);
      if (end) {
        // The street's end: on whichever side has more room.
        const span = roadSpan(this.roadOnScreen, end.y - 20, end.y + 20);
        const side = area.right - (span?.max ?? end.x) >= (span?.min ?? end.x) - area.left ? "right" : "left";
        const ends = this.street!.route.length < 4990;
        inputs.push({ key: "end", x: end.x, y: end.y, side, priority: 1e9, name: distanceText(route.length), detail: ends ? "THE STREET ENDS" : "END OF ROUTE", item: { color: "#ffffff", end: true }, font: 11 });
      }
    }
    this.labels = layoutLabels(inputs, tagMeasure(ctx), { ...area, blocked }, this.roadOnScreen, 10);
    for (const label of this.labels) this.drawLabel(label, now);
  }

  /**
   * A landmark's arrival: two rings run out over the ground from it, a
   * flash at the place and a wash of its colour over the picture. Strongest
   * in the first run (the landmarks), lighter in tours.
   */
  private drawImpact(project: (p: EN, z?: number) => Projected | null, spot: EN, q: Projected, age: number, color: string, pose: Pose): void {
    const ctx = this.ctx;
    const strength = this.run?.first ? 1 : this.focus?.quest ? 0.8 : 0.6;
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 2; k += 1) {
      const t = (age - k * 140) / IMPACT_MS;
      if (t <= 0 || t >= 1) continue;
      const r = 4 + pose.distance * 0.16 * (1 - (1 - t) ** 3);
      ctx.strokeStyle = rgba(color, 0.9 * strength * (1 - t) ** 2);
      ctx.lineWidth = 2.6 * (1 - t) + 0.6;
      ctx.beginPath();
      let open = false;
      for (let i = 0; i <= 48; i += 1) {
        const a = (i / 48) * Math.PI * 2;
        const p = project({ x: spot.x + Math.cos(a) * r, y: spot.y + Math.sin(a) * r });
        if (!p) {
          open = false;
          continue;
        }
        if (open) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        open = true;
      }
      ctx.stroke();
    }
    if (age < 600) {
      const k = 1 - age / 600;
      const size = 16 + 150 * k * k;
      ctx.globalAlpha = k;
      ctx.drawImage(glow(color, true), q.x - size / 2, q.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
    if (age < 450) {
      const { width: w, height: hgt } = this.view;
      const wash = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, Math.max(w, hgt) * 0.8);
      wash.addColorStop(0, rgba(color, 0.22 * strength * (1 - age / 450) ** 2));
      wash.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, hgt);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /** The lowest a tag may reach: above the bottom bar, and above the caption while the light runs. */
  private labelBottom(): number {
    let bottom = this.view.height - this.insets.bottom;
    if (this.phase === "run") {
      const captionBottom = this.bottomEl.classList.contains("away") ? 64 : this.insets.bottom + 6;
      const captionHeight = Math.max(96, this.captionEl.classList.contains("hidden") ? 0 : this.captionEl.offsetHeight);
      bottom = Math.min(bottom, this.view.height - captionBottom - captionHeight - 8);
    }
    return bottom;
  }

  /** A tag pops in as the light reaches its place. */
  private drawLabel(label: PlacedLabel<LabelItem>, now: number): void {
    const ctx = this.ctx;
    const born = label.item.shop ? (this.bornAt(label.item.shop) ?? -Infinity) : -Infinity;
    const age = now - born;
    const fresh = Number.isFinite(born) && age < 420;
    const k = fresh ? 0.55 + 0.45 * easeOutBack(age / 360) : 1;
    ctx.save();
    ctx.globalAlpha = fresh ? Math.min(1, age / 160) : 1;
    ctx.translate(label.x, label.y);
    ctx.scale(k, k);
    ctx.translate(-label.x, -label.y);
    drawTag(ctx, label);
    if (fresh) {
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - age / 420)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(label.box.x, label.box.y, label.box.w, label.box.h, 6 * (label.font / 13));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The street as a ruler on the right: how far the light has gone, and how many places each stretch holds. */
  private drawRail(now: number, head: number): void {
    const ctx = this.ctx;
    const route = this.route!;
    const x = this.view.width - 16;
    const top = this.insets.top + 6;
    const bottom = this.view.height - this.insets.bottom - 6;
    if (bottom - top < 80) return;
    const yAt = (s: number) => bottom - (Math.max(0, Math.min(route.length, s)) / route.length) * (bottom - top);
    const shown = this.street!.shops.filter((shop) => {
      const born = this.bornAt(shop);
      return born !== null && born <= now;
    });
    const bins = 40;
    const counts = histogram(shown, route.length, bins);
    const most = Math.max(4, ...histogram(this.street!.shops.filter((s) => this.run?.born.has(s.id) ?? true), route.length, bins));
    const color = this.focus?.color ?? LIGHT;
    ctx.fillStyle = rgba(color, 0.45);
    const binH = (bottom - top) / bins;
    counts.forEach((n, i) => {
      if (n === 0) return;
      const len = 14 * (n / most);
      ctx.fillRect(x - 4 - len, bottom - (i + 1) * binH + 1, len, Math.max(1, binH - 2));
    });
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, top);
    ctx.lineTo(x + 0.5, bottom);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `600 9px ${MONO}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let km = 1; km * 1000 < route.length; km += 1) ctx.fillRect(x - 2, yAt(km * 1000), 5, 1);
    ctx.fillText("0", x + 4, bottom + 10);
    ctx.fillText(`${(route.length / 1000).toFixed(1)}`, x + 6, top - 10);
    const lit = this.phase === "run" ? head : (this.run?.light.to ?? route.length);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, bottom);
    ctx.lineTo(x + 0.5, yAt(lit));
    ctx.stroke();
    if (this.phase === "run") ctx.drawImage(glow(color, true), x - 12, yAt(head) - 12, 24, 24);
    ctx.globalCompositeOperation = "source-over";
  }

  // ----- The page around the picture -----

  private updateHud(now: number, head: number): void {
    const street = this.street;
    // The street's name types itself in once it is known.
    let name = "Finding your street";
    if (this.phase === "failed") name = "No street found";
    else if (street) name = (street.name ?? "Unnamed street").slice(0, Math.max(0, Math.floor((now - this.loadedAt) / 55)));
    let stats = "";
    if (street && this.run) {
      const run = this.run;
      const count = [...run.born.values()].filter((t) => t <= now).length;
      const noun = this.focus ? this.focus.noun : "places";
      const km = (Math.max(0, this.phase === "run" ? head : street.route.length) / 1000).toFixed(2);
      stats = !this.focus && this.phase !== "run" && street.placesFound ? `${km} km · ${count} of ${street.placesFound} places` : `${km} km · ${count} ${noun}`;
    }
    const key = `${name}|${stats}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.nameEl.textContent = name || "\u00a0";
      this.statsEl.textContent = stats;
      this.fitName(street?.name ?? name);
    }
    this.renderConsole(now);
  }

  /** While the light runs: the place it reached last, large at the bottom, as in a film's lower third. */
  private updateCaption(now: number): void {
    const run = this.run;
    const picks = this.focus ? this.focus.picks : this.landmarks;
    let index = -1;
    let since = 0;
    if (run && this.phase === "run") {
      picks.forEach((shop, i) => {
        const born = run.born.get(shop.id);
        if (born !== undefined && born <= now && now - born < 2000) {
          index = i;
          since = now - born;
        }
      });
    }
    const shop = index >= 0 ? picks[index] : null;
    // It slides in with a sweep of light across it, timed by the show's clock (so recordings have it too).
    if (shop) {
      this.captionEl.style.opacity = String(Math.min(1, since / 220));
      this.captionEl.style.transform = `translateX(${(-28 * (1 - easeOutBack(since / 420))).toFixed(1)}px)`;
      const glint = this.captionEl.querySelector<HTMLElement>(".show-caption-glint");
      if (glint) glint.style.transform = `translateX(${(-120 + 240 * easeInOut((since - 80) / 700)).toFixed(1)}%)`;
    }
    const key = shop ? `${this.focus?.key ?? "all"}:${shop.id}` : "";
    if (key === this.captionKey) return;
    this.captionKey = key;
    if (!shop) {
      this.captionEl.classList.add("hidden");
      return;
    }
    const quest = this.focus?.quest;
    const what = quest ? "STOP" : this.focus ? this.focus.noun.toUpperCase() : "LANDMARK";
    const line = quest?.quest.stops.find((stop) => stop.id === shop.id)?.line;
    this.captionEl.style.setProperty("--c", this.shopColor(shop));
    this.captionEl.style.bottom = `${this.bottomEl.classList.contains("away") ? 64 : this.insets.bottom + 6}px`;
    this.captionEl.replaceChildren(
      h("div", { class: "show-caption-k", text: `${what} ${index + 1} / ${picks.length} · ${distanceText(shop.s).toUpperCase()} · ${kindWord(shop.kind).toUpperCase()}` }),
      h("div", { class: "show-caption-name", text: shop.name }),
      line ? h("div", { class: "show-caption-line", text: line }) : "",
      h("div", { class: "show-caption-glint" }),
    );
    this.captionEl.classList.remove("hidden");
  }

  /** The street's name as large as fits beside the buttons: 26 px, down to 18 px, then cut with an ellipsis. */
  private fitName(full: string): void {
    const room = this.nameEl.clientWidth;
    if (room <= 0) return;
    const ctx = this.ctx;
    let size = 26;
    for (; size > 18; size -= 1) {
      ctx.font = `750 ${size}px ${SANS}`;
      if (ctx.measureText(full).width <= room) break;
    }
    this.nameEl.style.fontSize = `${size}px`;
  }

  private consoleRows(now: number): ConsoleRow[] {
    const o = this.options;
    const dots = ".".repeat(1 + (Math.floor(now / 300) % 3));
    const rows: ConsoleRow[] = [];
    if (o.photo) rows.push({ id: "photo", key: "PHOTO", value: `${o.photo.width}×${o.photo.height}`, state: "done" });
    if (this.samState === "asking") rows.push({ id: "signs", key: "SIGNS", value: `SAM 3.1 finding signs${dots}`, state: "wait" });
    else if (this.samState === "done") rows.push({ id: "signs", key: "SIGNS", value: this.samFound > 0 ? `SAM 3.1 · ${this.samFound} in your photo` : "SAM 3.1 · none in view", state: "done" });
    const acc = o.capture ? ` ±${Math.round(o.capture.accuracyM)} m` : " (map point)";
    rows.push({ id: "gps", key: "GPS", value: `${o.origin.lat.toFixed(5)}, ${o.origin.lon.toFixed(5)}${acc}`, state: "done" });
    rows.push({ id: "heading", key: "HEADING", value: `${Math.round(normDeg(o.headingDeg))}° ${compassPoint(o.headingDeg)}${o.capture ? ` (${o.capture.headingSource})` : ""}`, state: "done" });
    const street = this.street;
    if (this.failure) {
      rows.push({ id: "street", key: "STREET", value: this.failure, state: "fail" });
      return rows;
    }
    if (!street) {
      rows.push({ id: "street", key: "STREET", value: `matching your heading to the map${dots}`, state: "wait" });
      rows.push({ id: "places", key: "PLACES", value: `collecting places along it${dots}`, state: "wait" });
      return rows;
    }
    const since = now - this.loadedAt;
    const tick = (i: number) => (since >= 150 * i ? "done" : "wait");
    rows.push({ id: "street", key: "STREET", value: `${street.name ?? "unnamed"} · ${street.highway}`, state: tick(1) });
    if (street.streetDistanceM > 30) rows.push({ id: "matched", key: "MATCHED", value: `${distanceText(street.streetDistanceM)} from your position`, state: "info" });
    rows.push({ id: "route", key: "ROUTE", value: `${distanceText(street.route.length)} ahead${street.route.length < 4990 ? " (the street ends)" : ""}`, state: tick(2) });
    rows.push({ id: "places", key: "PLACES", value: `${street.shops.length}${street.placesFound ? ` of ${street.placesFound}` : ""}`, state: tick(3) });
    rows.push({ id: "landmarks", key: "LANDMARKS", value: `${this.landmarks.length}`, state: tick(4) });
    rows.push({ id: "source", key: "SOURCE", value: street.source, state: "info" });
    (street.notes ?? []).forEach((note, i) => rows.push({ id: `note${i}`, key: "NOTE", value: note, state: "info" }));
    return rows;
  }

  private renderConsole(now: number): void {
    const visible = this.phase === "computing" || this.phase === "failed" || (this.phase === "run" && this.run?.first === true && now < this.revealAt + 700);
    this.consoleEl.classList.toggle("fade", this.phase === "run");
    if (!visible) {
      if (this.consoleHead) {
        this.consoleRowEls.clear();
        this.consoleEl.replaceChildren();
        this.consoleHead = null;
        this.consoleRowsEl = null;
      }
      return;
    }
    // Rows come in one by one; each row is made once and then only its text changes.
    const rows = this.consoleRows(now).filter((_, i) => now >= (this.options.photo ? 500 : 0) + i * 260);
    const took = this.failure ? this.failedAt : this.street ? this.loadedAt : now;
    const head = `${this.failure ? "STOPPED" : this.street ? "READY" : "COMPUTING"} · ${(took / 1000).toFixed(1)} s`;
    if (!this.consoleHead) {
      this.consoleHead = h("div", { class: "show-console-head" });
      this.consoleRowsEl = h("div");
      this.consoleEl.append(this.consoleHead, this.consoleRowsEl);
    }
    if (this.consoleHead.textContent !== head) this.consoleHead.textContent = head;
    const keep = new Set(rows.map((r) => r.id));
    for (const [id, row] of this.consoleRowEls) {
      if (keep.has(id)) continue;
      row.el.remove();
      this.consoleRowEls.delete(id);
    }
    for (const row of rows) {
      let el = this.consoleRowEls.get(row.id);
      if (!el) {
        const v = h("span", { class: "v" });
        const mark = h("span", { class: "s" });
        el = { el: h("div", { class: "show-console-row" }, h("span", { class: "k", text: row.key }), v, mark), v, mark };
        this.consoleRowEls.set(row.id, el);
        this.consoleRowsEl!.append(el.el);
      }
      const mark = row.state === "done" ? "✓" : row.state === "fail" ? "✕" : row.state === "wait" ? "…" : "";
      if (el.v.textContent !== row.value) el.v.textContent = row.value;
      if (el.mark.textContent !== mark) el.mark.textContent = mark;
      const cls = `show-console-row ${row.state}`;
      if (el.el.className !== cls) el.el.className = cls;
    }
    if (this.failure && !this.consoleEl.querySelector(".show-console-actions")) {
      this.consoleEl.append(
        h(
          "div",
          { class: "show-console-actions" },
          this.options.onRetry ? h("button", { class: "show-pill", onclick: this.options.onRetry }, "Try again") : null,
          this.options.elsewhere ? h("button", { class: "show-pill", onclick: this.options.elsewhere.go }, `Fly down ${this.options.elsewhere.label}`) : null,
          h("button", { class: "show-pill ghost", onclick: this.options.onClose }, "Home"),
        ),
      );
    }
  }

  private buildChips(): void {
    const street = this.street!;
    const total = street.shops.length;
    const counts = new Map(GROUPS.map((g) => [g.key, street.shops.filter((s) => g.categories.includes(s.category)).length]));
    const groups = GROUPS.filter((g) => (counts.get(g.key) ?? 0) > 0);
    this.barEl.replaceChildren(
      ...groups.map((g) => h("span", { class: "show-bar-part", "data-key": g.key, style: `flex-grow:${counts.get(g.key)};background:${g.color}`, title: `${g.label}: ${counts.get(g.key)}` })),
    );
    const all = h("button", { class: "show-chip", "data-key": "all", style: `--c:${LIGHT}`, onclick: () => this.beginRun(null, this.clock()) }, h("i"), "All", h("b", { text: String(total) }));
    this.chipsEl.replaceChildren(
      all,
      ...groups.map((g) => h("button", { class: "show-chip", "data-key": g.key, style: `--c:${g.color}`, onclick: () => this.tour(g) }, h("i"), g.label, h("b", { text: String(counts.get(g.key)) }))),
    );
    this.renderChips();
  }

  private renderChips(): void {
    const key = this.focus ? this.focus.key : "all";
    for (const chip of this.chipsEl.querySelectorAll<HTMLElement>(".show-chip")) chip.classList.toggle("on", chip.dataset.key === key);
    for (const part of this.barEl.querySelectorAll<HTMLElement>(".show-bar-part")) part.classList.toggle("dim", key !== "all" && part.dataset.key !== key);
    const active = this.chipsEl.querySelector<HTMLElement>(".show-chip.on");
    active?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  /** One kind of place: the light runs the street again and lights only those. */
  private tour(group: Group): void {
    const street = this.street;
    if (!street) return;
    const focus: Focus = {
      key: group.key,
      noun: group.noun,
      color: group.color,
      match: (shop) => group.categories.includes(shop.category),
      picks: pickGroup(street.shops, group, street.route.length, street.name),
    };
    this.endQuest(false);
    this.beginRun(focus, this.clock());
  }

  private startQuest(quest: Quest, stops: ShopAhead[]): void {
    this.questSheet?.close();
    const ids = new Set(stops.map((s) => s.id));
    const focus: Focus = { key: "quest", noun: "stops", color: QUEST_GOLD, match: (shop) => ids.has(shop.id), picks: [...stops].sort((a, b) => a.s - b.s), quest: { quest, stops } };
    this.questBarEl.replaceChildren(
      h("div", { class: "show-quest-text" }, h("strong", { text: `✦ ${quest.title}` }), h("span", { text: `${stops.length} stops · ${quest.source === "muse-spark-open" ? "by Muse Spark" : "picked by the app"}` })),
      h("button", { class: "show-pill", onclick: () => this.beginRun(focus, this.clock()) }, "Replay"),
      h("button", { class: "show-pill ghost", "aria-label": "End the quest", onclick: () => this.endQuest(true) }, "×"),
    );
    this.questBarEl.classList.remove("hidden", "offer");
    this.beginRun(focus, this.clock());
    this.measureInsets();
  }

  private endQuest(back: boolean): void {
    if (this.questBarEl.classList.contains("hidden")) return;
    this.questBarEl.classList.add("hidden");
    this.measureInsets();
    if (back && this.focus?.quest) this.showAll();
  }

  /** Every place lit at once, without a run, and the camera back over the whole street. */
  private showAll(): void {
    const street = this.street;
    if (!street || !this.route) return;
    const now = this.clock();
    this.focus = null;
    this.updateOverview();
    const light = lightRun(this.route.along[0], street.route.length, [], TOUR_PACE);
    const past = now - light.duration * 1000 - 1;
    this.run = {
      focus: null,
      first: false,
      from: this.lastPose,
      beginAt: past,
      moveMs: 1,
      start: past,
      light,
      chase: chaseTrack(light),
      born: new Map(street.shops.map((shop) => [shop.id, -Infinity])),
    };
    this.phase = "settle";
    this.settleAt = now;
    this.settleFrom = this.lastPose;
    this.renderChips();
  }

  private tap(e: MouseEvent): void {
    if (!this.street || this.phase === "computing" || this.phase === "failed") return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = this.labels.find((l) => l.item.shop && x >= l.box.x && x <= l.box.x + l.box.w && y >= l.box.y && y <= l.box.y + l.box.h);
    if (hit?.item.shop) {
      this.showCard(hit.item.shop);
      return;
    }
    const now = this.clock();
    const project = projector(this.lastPose, this.view);
    let best: ShopAhead | null = null;
    let bestD = 24;
    for (const shop of this.street.shops) {
      const born = this.bornAt(shop);
      if (born === null || born > now) continue;
      const q = project(this.spots.get(shop.id)!);
      if (!q) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bestD) {
        bestD = d;
        best = shop;
      }
    }
    if (best) this.showCard(best);
    else {
      this.selected = null;
      this.cardEl.classList.add("hidden");
    }
  }

  private showCard(shop: ShopAhead): void {
    const street = this.street!;
    this.selected = shop;
    const group = groupOf(shop.category);
    const color = this.shopColor(shop);
    const near = street.shops.filter((o) => o !== shop && o.side === shop.side && Math.abs(o.s - shop.s) < 15).slice(0, 6);
    const stop = this.focus?.quest?.quest.stops.find((s) => s.id === shop.id);
    const link = (href: string | undefined, label: string) =>
      href ? h("a", { class: "show-card-link", href, target: "_blank", rel: "noopener" }, h("span", { text: label }), buttonIcon(OUT_PATH, false)) : null;
    const links = [link(shop.instagram, "Instagram"), link(shop.facebook, "Facebook"), link(shop.website, "Website")];
    this.cardEl.style.setProperty("--c", color);
    const parts: (Node | null)[] = [
      h("div", { class: "show-card-kicker" }, h("i"), `${group.label.toUpperCase()} · ${kindWord(shop.kind).toUpperCase()}`),
      h("h3", { text: shop.name }),
      h("p", { class: "show-card-where", text: `${distanceText(shop.s)} ahead on the ${shop.side}` }),
      stop ? h("p", { class: "show-card-quest", text: `✦ ${stop.line}` }) : null,
      this.spotted.has(shop.id) ? h("p", { class: "show-card-quest", text: "✓ Muse Spark read this sign in your photo" }) : null,
      this.signCuts.has(shop.id)
        ? h("figure", { class: "show-card-sign" }, h("img", { src: this.signCuts.get(shop.id)!, alt: `The sign of ${shop.name} in your photo` }), h("figcaption", { text: "In your photo · outlined by SAM 3.1" }))
        : null,
      shop.cuisine ? h("p", { class: "muted", text: `Cuisine: ${shop.cuisine.replace(/;/g, ", ").replace(/_/g, " ")}` }) : null,
      shop.openingHours ? h("p", { class: "muted", text: `Hours (as mapped): ${shop.openingHours}` }) : null,
      links.some(Boolean) ? h("div", { class: "show-card-links" }, ...links) : null,
      near.length > 0
        ? h("div", { class: "show-card-also" }, h("span", { text: "Also here" }), ...near.map((o) => h("button", { class: "show-pill ghost", onclick: () => this.showCard(o) }, o.name)))
        : null,
      shop.id.startsWith("ovt/") ? h("p", { class: "show-card-source", text: "Place from Overture Maps, whose places come largely from Meta's place data (Facebook pages)." }) : null,
      h("p", { class: "show-card-source", text: `From ${street.source}. ${street.attribution}. Places change; the map may be out of date.` }),
      h("button", { class: "show-card-close", "aria-label": "Close", onclick: () => this.closeCard() }, "×"),
    ];
    this.cardEl.replaceChildren(...parts.filter((x): x is Node => x !== null));
    this.cardEl.classList.remove("hidden");
  }

  /** An empty street: the nearest famous street, in the bar above the buttons. */
  private offerElsewhere(): void {
    const elsewhere = this.options.elsewhere;
    if (!elsewhere) return;
    this.questBarEl.replaceChildren(
      h("div", { class: "show-quest-text" }, h("strong", { text: "Nothing mapped along this street yet" }), h("span", { text: "See the show on a busy street instead" })),
      h("button", { class: "show-pill", onclick: elsewhere.go }, `Fly down ${elsewhere.label}`),
    );
    this.questBarEl.classList.add("offer");
    this.questBarEl.classList.remove("hidden");
    this.measureInsets();
  }

  private closeCard(): void {
    this.selected = null;
    this.cardEl.classList.add("hidden");
  }

  /** A line over the street for a while; `pictures`, small images under it (the signs from the photo). */
  private note(text: string, ms: number, good = false, pictures: { src: string; alt: string }[] = [], caption = ""): void {
    this.noteEl.replaceChildren(text);
    if (pictures.length > 0) {
      this.noteEl.append(
        h("span", { class: "show-note-signs" }, ...pictures.map((p) => h("img", { src: p.src, alt: p.alt })), caption ? h("span", { text: caption }) : null),
      );
    }
    this.noteEl.classList.toggle("good", good);
    this.noteEl.classList.remove("hidden");
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => this.noteEl.classList.add("hidden"), ms);
  }

  /** The street (and the quest, when there is one) as a picture for stories and chats. */
  private async share(): Promise<void> {
    if (!this.street) return;
    const quest = this.focus?.quest ?? null;
    const canvas = drawShareCard({ street: this.street, photo: this.options.photo, quest });
    try {
      if ((await shareCard(canvas, this.street.name ?? "What's Ahead")) === "saved") this.note("Saved the card as a picture", 3000);
    } catch (error) {
      this.note(`Could not share: ${error instanceof Error ? error.message : String(error)}`, 4000);
    }
  }

  /** The photo at the size Meta's models get, made on first use and kept. */
  private modelPhoto(): { canvas: HTMLCanvasElement; jpeg: string } {
    if (!this.model) {
      const canvas = modelCanvas(this.options.photo!);
      this.model = { canvas, jpeg: modelJpeg(canvas) };
    }
    return this.model;
  }

  /**
   * Asks SAM 3.1 for every sign in the photo, alongside the street lookup.
   * Whatever happens here, the show goes on: a refusal, an error or a slow
   * answer only means the sign check reads the plain photo, as before.
   */
  private async findSigns(): Promise<void> {
    this.samState = "asking";
    // Let the photo's first frames draw before it is made small.
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    try {
      if (this.disposed) return;
      const model = this.modelPhoto();
      const res = await fetch("/api/sam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: model.jpeg, prompt: "sign" }),
        signal: this.abort.signal,
      });
      const reply = readSamReply(await res.json().catch(() => null));
      if (this.disposed) return;
      if (!res.ok || !reply || reply.width !== model.canvas.width || reply.height !== model.canvas.height) {
        this.samState = "failed";
        return;
      }
      this.samFound = reply.signs.length;
      this.signBoxes = numberSigns(reply.signs, Math.max(reply.width, reply.height));
      this.samState = "done";
    } catch {
      if (!this.disposed) this.samState = "failed";
    }
  }

  /**
   * Asks Muse Spark Open which of the nearest mapped places it can read in
   * the photo. When SAM 3.1 found signs, the photo goes with them boxed and
   * numbered, and a place read in a box gets that sign, cut out along SAM's
   * outline, on its card.
   */
  private async checkSigns(): Promise<void> {
    const street = this.street!;
    const places = spotPlaces(street.shops);
    if (places.length === 0 || !this.options.photo) return;
    await Promise.race([this.samDone, new Promise((resolve) => window.setTimeout(resolve, SAM_WAIT_MS))]);
    if (this.disposed) return;
    try {
      const model = this.modelPhoto();
      const boxes = this.samState === "done" ? this.signBoxes : [];
      const image = boxes.length > 0 ? modelJpeg(drawSignBoxes(model.canvas, boxes)) : model.jpeg;
      const res = await fetch("/api/signs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, places, boxes: boxes.length }),
        signal: this.abort.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { spotted?: Spotted; error?: string };
      if (this.disposed || !res.ok || !body.spotted) return;
      const byId = new Map(street.shops.map((x) => [x.id, x]));
      const read = body.spotted.seen.filter((x) => byId.has(x.id));
      const names = read.map((x) => byId.get(x.id)!.name);
      this.spotted = new Set(read.map((x) => x.id));
      const photo = this.options.photo;
      const full = photo.width / model.canvas.width;
      const pictures: { src: string; alt: string }[] = [];
      const signs = signsForPlaces(read, boxes);
      for (const x of read) {
        const box = signs.get(x.id);
        if (!box) continue;
        // From the full photo for a sharp picture, unless that would be a large one to make while the light runs.
        const sharp = (box.x2 - box.x1) * full <= CUT_MAX_PX;
        const src = (sharp ? cutSign(photo, box, full) : cutSign(model.canvas, box)).toDataURL("image/png");
        this.signCuts.set(x.id, src);
        if (pictures.length < 4) pictures.push({ src, alt: `The sign of ${byId.get(x.id)!.name}` });
      }
      if (names.length > 0) {
        this.note(
          `✓ Muse Spark read ${names.length === 1 ? "a sign" : `${names.length} signs`} in your photo: ${names.join(", ")}. Right street, right way.`,
          9000,
          true,
          pictures,
          pictures.length > 0 ? "outlined by SAM 3.1" : "",
        );
      } else if (body.spotted.view === "across") this.note("Muse Spark sees building fronts, not a street running away from you. Turn to look along the street and try again.", 9000);
    } catch {
      // The sign check is a bonus: without it the street still shows.
    }
  }
}
