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
import { localFrame, normDeg, type EN, type LocalFrame } from "../geo/enu.js";
import { h, svg } from "../ui/dom.js";
import type { ShopAhead } from "./ahead.js";
import { knownIds, landmarksFrom, mergePicks, pickCandidates, PICK_MIN_PLACES, PICK_REASONS, roughPosition, type PickPlace, type PickReason, type Picks } from "./picks.js";
import type { Quest } from "./quest.js";
import { QuestSheet } from "./quest-ui.js";
import { pointAt, type Route } from "./route.js";
import { drawShareCard, shareCard } from "./share-card.js";
import {
  chaseTrack,
  clampPose,
  dotSpot,
  arcPoint,
  easeInOut,
  easeOutBack,
  FLIGHT,
  flightLength,
  flightProgress,
  focalPx,
  IMPACT_MS,
  impactPunch,
  FOLLOW,
  followPose,
  groundAt,
  groundScale,
  groupOf,
  GROUPS,
  histogram,
  kindWord,
  LIGHT,
  lightRun,
  lerpPose,
  overviewPose,
  pickGroup,
  emptyStretches,
  pickLandmarks,
  poseKeeping,
  projector,
  QUEST_GOLD,
  radarPose,
  REVEAL_PACE,
  sampleRoute,
  screenSide,
  showReach,
  stallHold,
  TOUR_FOLLOW,
  TOUR_PACE,
  WALK_FOLLOW,
  zoomAbout,
  type ExploreLimits,
  type Group,
  type GroupKey,
  type LightRun,
  type Pose,
  type Projected,
  type View,
} from "./show-plan.js";
import { drawTagStamped, glow, MONO, rgba, SANS, tagMeasure, type TagStyle } from "./show-draw.js";
import { distanceText, walkMinutes, walkText, WALK_MINUTES_UP_TO_M } from "./signs.js";
import { cutSign, drawSignBoxes, numberSigns, readSamReply, signsForPlaces, type SignBox } from "./sign-boxes.js";
import { spotPlaces, type Spotted } from "./spotted.js";
import { layoutLabels, roadSpan, type Box, type LabelInput, type PlacedLabel, type ScreenPoint } from "./street-labels.js";
import { localRoute, type StreetAhead } from "./street.js";
import { nextPlace, passed, SIMULATED_SPEEDUP, simulatedFix, walkStep, type WalkFix, type WalkSpot } from "./walk.js";

/** Shortest time the radar shows, so it reads even when the street comes back at once. */
const MIN_COMPUTE_MS = 2400;
const PHOTO_SCAN_MS = 1000;
const PHOTO_FOLD_MS = 800;
/** The first run waits this long at most, after the street is in, for Muse Spark's picks; then the map's ranking names the places. */
const PICK_WAIT_MS = 6000;
/** Muse Spark's line stays in the readings this long before the light sets off. */
const PICK_HOLD_MS = 600;
/** Picks that come in after the first run pop up over the whole street one after another, this far apart. */
const POP_STEP_MS = 380;
/** The sign check waits this long at most for SAM 3.1's signs, then reads the plain photo as before. */
const SAM_WAIT_MS = 3000;
/** A sign's picture is cut from the full photo when it comes out at most this wide. */
const CUT_MAX_PX = 420;
/** Exploring closer than this many pixels per metre, every place in view gets its name (as room allows). */
const NAMES_PPM = 0.3;
/** How close a tap on a place brings the camera when it is farther out. */
const TAP_PPM = 0.9;
/** At most this many tags while exploring. */
const EXPLORE_TAGS = 18;
/** A finger has to move this far before a touch becomes a drag. */
const DRAG_SLOP_PX = 6;
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
  /** A small meter of frames per second over the show (?fps=1), to see how smoothly a phone draws it. */
  fpsMeter?: boolean;
  /** Muse Spark's picks once they are in, to keep with the street (a street opened again uses them without asking). */
  onPicks?: (picks: Picks) => void;
  /** The street came from the live camera: once the light has run, the dot follows the phone along it. */
  live?: boolean;
  /** No phone on this street (a demo street, the map alone): a SIMULATED walk down it is offered instead. */
  simulate?: boolean;
  /** A street seen before, opened again: straight to the whole street, without the run. */
  resume?: boolean;
  /** Off the street for a while: a new photo where you stand. */
  onNewStreet?: () => void;
  /** The heading for a demo street: its name as the world knows it ("Chuo-dori · Ginza" for the map's 第一京浜). */
  title?: string;
  /** A demo street's id: Muse Spark's picks along it come from the CDN, asked for as the show opens rather than once the street is in. */
  demo?: string;
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

/** A sign Muse Spark read in one of SAM's boxes: its picture, cut from the photo, flies from that box to its place. */
type FlightSign = { shop: ShopAhead; picture: HTMLCanvasElement; box: SignBox; landedAt: number | null };

/** What the sign check found: the line saying so, the pictures for that line, and the signs to fly to the street. */
type SignNews = { text: string; pictures: { src: string; alt: string }[]; caption: string; signs: FlightSign[] };

/** The green of a sign read in the photo. */
const READ_GREEN = "#4dff9a";

/** Off the street this long, and a new photo is offered. */
const OFF_STREET_MS = 10_000;

/** Walking the street after the show: the phone's fixes (or a SIMULATED walk) moving a dot along it. */
type Walk = {
  mode: "live" | "simulated";
  spot: WalkSpot | null;
  /** Where the dot is drawn: it glides to each new fix. */
  shown: { s: number; offset: number } | null;
  lastFrame: number;
  /** The camera follows the dot until the visitor takes it. */
  follow: boolean;
  camFrom: Pose;
  camAt: number;
  offSince: number | null;
  watch: number | null;
  timer: number;
  started: number;
};

/** A four-pointed spark, filled (24 × 24 view box). */
const SPARKLE_PATH = "M12 2.5c.5 4.6 2.9 7 9.5 9.5-6.6 2.5-9 4.9-9.5 9.5-.5-4.6-2.9-7-9.5-9.5 6.6-2.5 9-4.9 9.5-9.5z";
/** An arrow leaving to the upper right: the link opens elsewhere (24 × 24 view box). */
const OUT_PATH = "M8 16 16.5 7.5M9.5 7.5h7v7";
/** A box with an arrow leaving it upward, stroked (24 × 24 view box). */
const SHARE_PATH = "M12 15V3.5M7.5 8 12 3.5 16.5 8M6 11.5H5v9h14v-9h-1";
/** Four corners: the whole street in the frame (24 × 24 view box). */
const FIT_PATH = "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5";
/** Someone walking, stroked (24 × 24 view box). */
const WALK_PATH = "M14 2.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4M13 8.5l-1.5 6M11.5 14.5 9 21M11.5 14.5l2.6 2.8.9 3.7M13 9l3.5 3M13 9l-3 2.4-1.5 2.6";
/** A turn back to the start: play it again, stroked (24 × 24 view box). */
const REPLAY_PATH = "M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.5H9";
/** A ring with ticks: back to where you are, stroked (24 × 24 view box). */
const LOCATE_PATH = "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9";

/** The ground the visitor's camera may look at: the points' box with a margin, metres. */
/** A short buzz on phones that can, once the page has been touched (before that the browser refuses it and says so in the console). */
function buzz(ms: number): void {
  if (navigator.userActivation?.hasBeenActive === false) return;
  navigator.vibrate?.(ms);
}

function boxAround(points: readonly EN[], margin: number): ExploreLimits["box"] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - margin, maxX: maxX + margin, minY: minY - margin, maxY: maxY + margin };
}

function buttonIcon(d: string, filled: boolean): SVGSVGElement {
  const icon = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  icon.append(
    svg("path", filled ? { d, fill: "currentColor" } : { d, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }),
  );
  return icon;
}

/** A round icon button for the bars' small actions. */
function roundButton(d: string, label: string, onclick: () => void): HTMLButtonElement {
  return h("button", { class: "show-round", "aria-label": label, title: label, onclick }, buttonIcon(d, false));
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
  private readonly walkBarEl: HTMLElement;
  private walkBarKey = "";
  private walk: Walk | null = null;
  /** The dot's spot in this frame, while walking. */
  private walkAt: { s: number; offset: number } | null = null;
  private local: LocalFrame | null = null;
  private wake: { release: () => Promise<void> } | null = null;
  private readonly captionEl: HTMLElement;
  private captionKey = "";
  private readonly questButton: HTMLButtonElement;
  private readonly walkButton: HTMLButtonElement;
  private readonly shareButton: HTMLButtonElement;
  /** The light is running: the bottom steps back so the street (and your dot) shows through it. */
  private dockPlaying = false;
  private questSheet: QuestSheet | null = null;

  private street: StreetAhead | null = null;
  private route: Route | null = null;
  private line: { points: EN[]; along: number[] } | null = null;
  private spots = new Map<string, EN>();
  private landmarks: ShopAhead[] = [];
  /** How far the show goes: the street, or a little past its last place when nothing is mapped along the rest. */
  private shown = 0;
  /** The landmarks by the map's own ranking: what the show names when Muse Spark does not answer. */
  private ruleLandmarks: ShopAhead[] = [];
  /** Muse Spark's picks: not asked (too few places, a SYNTHETIC street), asking, in, or failed (the map's ranking stands). */
  private picksState: "off" | "asking" | "done" | "failed" = "off";
  private picksAt = 0;
  private picksNote = "";
  private pickCount = 0;
  /** The skip button during the readings: no more waiting for the picks. */
  private pickWaitOver = false;
  /** Why Muse Spark picked each landmark it picked. */
  private pickWhy = new Map<string, PickReason>();
  /** Muse Spark's best-known places of each chip's kind. */
  private aiBest: Picks["best"] = {};
  /** Every place Muse Spark named a landmark, kept along the street or not: a quest asks it to prefer these. */
  private modelNamed = new Set<string>();
  /** A demo street's picks, asked for alongside the street (null: the page asks once the street is in). */
  private demoPicks: Promise<Response | null> | null = null;
  private demoAsked = 0;
  /** Picks that came in while the first run was naming the map's: they take over once it ends. */
  private pendingLandmarks: ShopAhead[] | null = null;
  /** When each of Muse Spark's late picks pops up over the whole street (show time). */
  private popAt = new Map<string, number>();
  /** Signs read during the first run: they fly to the street once it ends. */
  private flightPending: SignNews | null = null;
  /** The signs' flight from the photo to the street, while it plays. */
  private flight: { at: number; news: SignNews; from: Pose; pose: Pose } | null = null;
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
  /** The visitor's own camera once they pinch, drag or scroll after the run (null: the show's camera). */
  private userPose: Pose | null = null;
  /** A glide of the visitor's camera: to a tapped place, or back to the whole street. */
  private glide: { from: Pose; to: Pose; at: number; ms: number; done?: () => void } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: { pose: Pose; anchor: EN | null; startX: number; startY: number; spread: number; moved: boolean } | null = null;
  /** A drag or a pinch just ended: the click that follows is not a tap. */
  private suppressClick = false;
  private exploreBox: ExploreLimits["box"] | null = null;
  private zoomHinted = false;
  /** The how-to-zoom line is up: it goes as soon as the visitor zooms. */
  private hintUp = false;
  private readonly fitButton: HTMLButtonElement;
  private t0 = performance.now();
  private frozen: number | null = null;
  /** The show's time at the last frame drawn (null: none yet, or frozen). */
  private lastFrameAt: number | null = null;
  /** The name the title was last sized for. */
  private fittedName = "";
  /** ?fps=1: the meter, and the last frames' times. */
  private meterEl: HTMLElement | null = null;
  private readonly frameTimes: number[] = [];
  private meterAt = 0;
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
    // Beside it, two small tools: an icon over a word, as on a phone's tab bar.
    const live = options.live === true;
    this.walkButton = h(
      "button",
      { class: "show-tool hidden", "aria-label": live ? "Walk it: your dot follows your phone" : "Walk it, simulated", onclick: () => this.startWalk(live ? "live" : "simulated") },
      buttonIcon(WALK_PATH, false),
      h("span", { text: live ? "Walk" : "Simulate" }),
    );
    this.shareButton = h("button", { class: "show-tool hidden", "aria-label": "Share", onclick: () => void this.share() }, buttonIcon(SHARE_PATH, false), h("span", { text: "Share" }));
    const close = h("button", { class: "show-icon", "aria-label": "Close", title: "Close", onclick: options.onClose }, "×");
    this.consoleEl = h("div", { class: "show-console" });
    this.noteEl = h("div", { class: "show-note hidden" });
    this.skipEl = h("button", { class: "show-skip hidden", onclick: () => this.skip() }, "Skip ›");
    this.fitButton = h("button", { class: "show-icon show-fit hidden", "aria-label": "Whole street", title: "Whole street", onclick: () => this.fitWhole() }, buttonIcon(FIT_PATH, false));
    this.barEl = h("div", { class: "show-bar" });
    this.chipsEl = h("div", { class: "show-chips" });
    this.questBarEl = h("div", { class: "show-quest hidden" });
    this.walkBarEl = h("div", { class: "show-quest show-walk hidden" });
    this.creditEl = h("div", { class: "show-credit", text: "Map © OpenStreetMap contributors" });
    this.captionEl = h("div", { class: "show-caption hidden" });
    this.bottomEl = h("div", { class: "show-bottom away" }, this.questBarEl, this.walkBarEl, h("div", { class: "show-actions" }, this.questButton, this.walkButton, this.shareButton), this.barEl, this.chipsEl);
    this.cardEl = h("div", { class: "show-card hidden" });
    this.element = h(
      "main",
      { class: "show" },
      this.canvas,
      h("div", { class: "show-top" }, h("div", { class: "show-heading" }, this.kickerEl, this.nameEl, this.statsEl), h("div", { class: "show-buttons" }, this.fitButton, this.skipEl, close)),
      this.noteEl,
      this.consoleEl,
      this.captionEl,
      this.bottomEl,
      this.creditEl,
      this.cardEl,
    );
    this.canvas.addEventListener("click", (e) => {
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      this.tap(e);
    });
    // Two fingers or the wheel zoom about where they are; one finger drags the ground.
    this.canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
    for (const type of ["pointerup", "pointercancel"] as const) this.canvas.addEventListener(type, (e) => this.pointerUp(e));
    this.canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    // Safari's own page pinch, over the street.
    this.canvas.addEventListener("gesturestart", (e) => e.preventDefault());
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisible);
    if (options.fpsMeter) {
      this.meterEl = h("div", { class: "show-meter", text: "… fps" });
      this.element.append(this.meterEl);
    }
  }

  /** Starts drawing; call once the element is in the page. */
  start(): void {
    this.t0 = performance.now();
    this.onResize();
    // SAM 3.1 looks for the signs while the street is looked up; nothing waits for it.
    if (this.options.photo && this.options.sam !== false) this.samDone = this.findSigns();
    // A demo street's picks stand in the CDN like the street: both are asked for at once.
    if (this.options.demo) {
      this.demoAsked = performance.now();
      this.demoPicks = fetch(`/api/landmarks?demo=${encodeURIComponent(this.options.demo)}`, { signal: this.abort.signal }).catch(() => null);
    }
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.frame(this.clock());
    };
    tick();
  }

  /** The street is in: the show goes on once the radar has had its moment. `picks`: Muse Spark's, kept from an earlier look at this street. */
  load(street: StreetAhead, picks?: Picks): void {
    if (this.disposed) return;
    const now = this.clock();
    this.street = street;
    this.route = localRoute(street);
    this.local = localFrame(street.origin);
    this.line = sampleRoute(this.route, 10);
    this.spots = new Map(street.shops.map((shop) => [shop.id, dotSpot(this.route!, shop)]));
    this.exploreBox = boxAround([...this.line.points, { x: 0, y: 0 }], 300);
    this.shown = showReach(street.shops, street.route.length);
    this.landmarks = pickLandmarks(street.shops, this.shown, street.name);
    this.ruleLandmarks = this.landmarks;
    this.loadedAt = now;
    const minimum = this.options.photo ? PHOTO_SCAN_MS + PHOTO_FOLD_MS + 900 : MIN_COMPUTE_MS;
    this.revealAt = this.options.resume ? now : Math.max(now, minimum) + HOLD_MS;
    if (this.options.resume) this.pickWaitOver = true;
    this.buildChips();
    this.measureInsets();
    const credits = street.attribution.replace(/ \((ODbL|CDLA-Permissive-2\.0)\)/g, "");
    this.creditEl.textContent = street.synthetic && !credits.includes("SYNTHETIC") ? `${credits} · SYNTHETIC` : credits;
    this.kickerEl.replaceChildren("WHAT'S AHEAD", street.synthetic ? h("span", { class: "badge", text: "SYNTHETIC" }) : "");
    this.questSheet = new QuestSheet(
      street.shops,
      (quest, stops) => this.startQuest(quest, stops),
      () => ({ street: street.name?.slice(0, 80), near: roughPosition(this.options.origin), known: this.modelNamed }),
    );
    this.questSheet.element.classList.add("show-sheet");
    this.element.append(this.questSheet.element);
    this.skipEl.classList.remove("hidden");
    if (street.shops.length === 0) {
      this.note("The map has no places along this street yet.", 6000);
      this.offerElsewhere();
    }
    if (this.options.photo) void this.checkSigns();
    // Muse Spark picks the places to name, unless the street is too quiet to pick from (or invented).
    const candidates = pickCandidates(street.shops, this.shown, street.name);
    this.pickCount = candidates.length;
    if (picks) {
      this.applyPicks(picks, "kept from your last look");
      this.picksAt = -Infinity;
    } else if (!street.synthetic && candidates.length >= PICK_MIN_PLACES) void this.askPicks(candidates);
  }

  /** The lookup failed: the radar stays, the reason shows, with a way to try again. */
  fail(message: string): void {
    if (this.disposed) return;
    this.failure = message;
    this.failedAt = this.clock();
    this.phase = "failed";
  }

  dispose(): void {
    this.stopWalk();
    this.disposed = true;
    this.abort.abort();
    document.removeEventListener("visibilitychange", this.onVisible);
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.noteTimer);
    window.removeEventListener("resize", this.onResize);
  }

  /** For the browser tests and recordings: draw the show as it is `ms` after it started (null: back to the clock). */
  freeze(ms: number | null): void {
    this.frozen = ms;
    this.lastFrameAt = null;
    if (ms !== null) this.frame(ms);
  }

  /** For the browser tests: where the show is. */
  state(): { phase: string; loaded: boolean; focus: string | null; landmarks: string[]; labels: string[]; picks: string; flight: boolean; walk: string | null } {
    return {
      phase: this.phase,
      loaded: this.street !== null,
      focus: this.focus?.key ?? null,
      landmarks: this.landmarks.map((s) => s.name),
      labels: this.labels.map((l) => l.lines.join(" ")),
      picks: this.picksState,
      flight: this.flight !== null,
      walk: this.walk ? `${this.walk.mode} ${Math.round(this.walk.spot?.s ?? 0)} m` : null,
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
    this.paintGround();
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

  /** How far the light goes: the street as far as it has places, or for a quest a little past its last stop. */
  private reach(focus: Focus | null): number {
    const length = this.street?.route.length ?? 0;
    if (!focus?.quest) return this.shown || length;
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

  /** The light sets off once the radar has had its moment and Muse Spark has answered (or had its time). */
  private readyToReveal(now: number): boolean {
    if (now < this.revealAt) return false;
    if (this.picksState === "asking") return this.pickWaitOver || now >= this.loadedAt + PICK_WAIT_MS;
    return this.pickWaitOver || now >= this.picksAt + PICK_HOLD_MS;
  }

  private update(now: number): void {
    if (this.phase === "computing" && this.street && this.readyToReveal(now)) {
      // From now, not from when the reveal was due: waiting for Muse Spark's picks must not start the light halfway down the street.
      this.beginRun(null, now, true);
      // With reduced motion the light's run is skipped, and a street opened again goes straight to the whole of it.
      if (this.options.resume || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) this.skip();
    }
    const run = this.run;
    if (this.phase === "run" && run && now >= run.start + run.light.duration * 1000) {
      this.phase = "settle";
      this.settleAt = run.start + run.light.duration * 1000;
      this.settleFrom = followPose(this.route!, run.chase(run.light.duration), run.first ? FOLLOW : TOUR_FOLLOW);
      if (this.walk) {
        this.walk.camFrom = this.settleFrom;
        this.walk.camAt = this.settleAt;
      }
      if (run.first) {
        this.revealed = true;
        if (this.flightPending) {
          this.startFlight(this.flightPending, now + 500);
          this.flightPending = null;
        }
        this.offerWalk();
        if (this.pendingLandmarks) {
          this.landmarks = this.pendingLandmarks;
          this.pendingLandmarks = null;
          this.popPicks(now + 600);
        }
        this.questButton.classList.remove("hidden");
        this.shareButton.classList.remove("hidden");
        this.hintZoom(6);
      }
      this.bottomEl.classList.remove("away");
      this.skipEl.textContent = "↺";
      this.skipEl.setAttribute("aria-label", "Replay");
      this.skipEl.classList.add("icon");
      this.measureInsets();
    }
    if (this.phase === "settle" && now >= this.settleAt + SETTLE_MS) this.phase = "overview";
    const flight = this.flight;
    if (flight && now >= flight.at + flightLength(flight.news.signs.length)) {
      this.flight = null;
      if (this.walk) {
        this.walk.camFrom = this.lastPose;
        this.walk.camAt = now;
      }
      this.note(flight.news.text, 7000, true);
    }
  }

  /** Sends the light down the street for one focus (null: every place), from where the camera is now. */
  private beginRun(focus: Focus | null, at: number, first = false): void {
    const street = this.street;
    if (!street || !this.route) return;
    this.focus = focus;
    this.selected = null;
    this.cardEl.classList.add("hidden");
    this.releaseCamera();
    this.updateOverview();
    const picks = focus ? focus.picks : this.landmarks;
    const from = this.route.along[0];
    const to = this.reach(focus);
    // The light races across stretches with none of the places it is showing.
    const empty = emptyStretches(focus ? street.shops.filter(focus.match) : street.shops, from, to);
    const light = lightRun(from, to, picks.map((p) => p.s), first ? REVEAL_PACE : focus?.quest ? { ...TOUR_PACE, dwell: 0.9 } : TOUR_PACE, empty);
    const moveMs = first ? TILT_MS : TOUR_LEAD_MS;
    const start = at + (first ? LIGHT_DELAY_MS : TOUR_LEAD_MS);
    const born = new Map<string, number>();
    for (const shop of street.shops) if (!focus || focus.match(shop)) born.set(shop.id, start + light.when(shop.s) * 1000);
    this.run = { focus, first, from: first ? radarPose(this.options.headingDeg) : this.lastPose, beginAt: at, moveMs, start, light, chase: chaseTrack(light), born };
    this.felt.clear();
    this.popAt.clear();
    // A run cuts the signs' flight short; the line about them still shows.
    if (this.flight) {
      this.note(this.flight.news.text, 7000, true);
      this.flight = null;
    }
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
      this.pickWaitOver = true;
      this.update(now);
    }
    const run = this.run;
    if (this.phase === "run" && run) {
      // Jump to the end of the run: everything it would have shown is shown.
      this.shiftRun(now - (run.start + run.light.duration * 1000));
      this.update(now);
      return;
    }
    if (this.phase === "settle" || this.phase === "overview") this.beginRun(this.focus, now);
  }

  /** Moves the running light's timeline later by `ms` (earlier when negative): the camera, the light and each place it reaches. */
  private shiftRun(ms: number): void {
    const run = this.run;
    if (!run) return;
    run.start += ms;
    run.beginAt += ms;
    for (const [id, t] of run.born) run.born.set(id, t + ms);
  }

  private headAt(now: number): number {
    const run = this.run;
    if (!run || !this.street) return 0;
    if (this.phase !== "run") return run.light.to;
    return run.light.at((now - run.start) / 1000);
  }

  private poseAt(now: number): Pose {
    if (this.userPose && (this.phase === "settle" || this.phase === "overview")) {
      const glide = this.glide;
      if (glide) {
        const k = easeInOut((now - glide.at) / glide.ms);
        if (k < 1) return lerpPose(glide.from, glide.to, k);
        this.glide = null;
        this.userPose = glide.to;
        glide.done?.();
      }
      return this.userPose ?? this.overview;
    }
    // The signs' flight: the camera glides in over where you stood, then back.
    const flight = this.flight;
    if (flight && (this.phase === "settle" || this.phase === "overview")) {
      const t = now - flight.at;
      const out = flightLength(flight.news.signs.length) - FLIGHT.outMs;
      if (t < out) return lerpPose(flight.from, flight.pose, easeInOut(t / FLIGHT.glideMs));
      const back = this.walk?.follow && this.walkAt ? this.walkPose(this.walkAt) : this.overview;
      return lerpPose(flight.pose, back, easeInOut((t - out) / FLIGHT.outMs));
    }
    // Walking: the camera keeps the dot low on the screen, above the buttons, the street ahead above it.
    if (this.walk?.follow && this.walkAt && (this.phase === "settle" || this.phase === "overview")) {
      const target = this.walkPose(this.walkAt);
      const k = easeInOut((now - this.walk.camAt) / 1200);
      return k >= 1 ? target : lerpPose(this.walk.camFrom, target, k);
    }
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
    if (this.frozen === null) {
      // A stall pauses a running light: it does not jump ahead to where the clock says.
      const hold = this.lastFrameAt === null ? 0 : stallHold(now - this.lastFrameAt);
      if (this.phase === "run" && hold > 0) this.shiftRun(hold);
      this.lastFrameAt = now;
    }
    this.update(now);
    const playing = this.phase === "run";
    if (playing !== this.dockPlaying) {
      this.dockPlaying = playing;
      this.bottomEl.classList.toggle("playing", playing);
    }
    this.walkAt = this.walkShown(now);
    const pose = this.poseAt(now);
    this.lastPose = pose;
    const project = projector(pose, this.view);
    const ctx = this.ctx;
    const dpr = this.canvas.width / this.view.width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // The dark ground with its vignette is the canvas's own CSS background (set on resize): painting it here, every frame, cost more than anything drawn on it.
    ctx.clearRect(0, 0, this.view.width, this.view.height);
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
      this.drawFlight(project, now);
      this.drawRail(now, head);
    }
    this.drawPhoto(now);
    this.updateHud(now, head);
    this.updateCaption(now);
    if (this.meterEl) this.updateMeter();
  }

  /** ?fps=1: frames per second over the last two seconds, the slowest frame among them and the 95th percentile, twice a second. */
  private updateMeter(): void {
    const t = performance.now();
    const times = this.frameTimes;
    times.push(t);
    while (times.length > 2 && t - times[0] > 2000) times.shift();
    if (t - this.meterAt < 500 || times.length < 3) return;
    this.meterAt = t;
    const gaps = times.slice(1).map((x, i) => x - times[i]).sort((a, b) => a - b);
    const fps = (gaps.length * 1000) / (times[times.length - 1] - times[0]);
    const p95 = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))];
    this.meterEl!.textContent = `${fps.toFixed(0)} fps · p95 ${p95.toFixed(0)} ms · worst ${gaps[gaps.length - 1].toFixed(0)} ms · ${this.canvas.width / this.view.width}x`;
  }

  /** The ground: dark blue under the middle fading to black at the edges, behind the canvas. */
  private paintGround(): void {
    const { width: w, height: hgt } = this.view;
    const r = Math.round(Math.hypot(w, hgt) * 0.62);
    this.canvas.style.background = `radial-gradient(circle ${r}px at 50% 42%, #0b1522 0, #04080d ${Math.round(r * 0.55)}px, #000 ${r}px)`;
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
      if (level <= 1) return;
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
    // Walking: the next stretch of the street lit up ahead of you.
    if (this.walkAt && !running) this.strokeLine(pts, line.along, this.walkAt.s, this.walkAt.s + 400, pose, [[LIGHT, 0.14, 9], [LIGHT, 0.6, 2.4]]);
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
      // Walking: the places behind you dim.
      ctx.globalAlpha = this.fog(q.depth, pose) * (this.walkAt && shop.s < this.walkAt.s - 8 ? 0.35 : 1);
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
    const walkAt = this.walkAt;
    if (walkAt && alpha > 0.01) {
      // Walking: where the photo was taken stays marked, and the dot is where you are now.
      this.drawMarker(project({ x: 0, y: 0 }), alpha * 0.5, this.options.photo ? "PHOTO" : "START");
      const at = this.walkPoint(walkAt);
      this.drawAccuracy(project, at, this.walk?.spot?.accuracyM ?? 0);
      this.drawMarker(project(at), alpha, this.walk?.mode === "simulated" ? "YOU · SIMULATED" : "YOU");
      return;
    }
    this.drawMarker(project({ x: 0, y: 0 }), alpha, "YOU");
  }

  /** The fix's uncertainty as a faint disc on the ground around the dot. */
  private drawAccuracy(project: (p: EN, z?: number) => Projected | null, at: EN, radius: number): void {
    if (radius < 4) return;
    const ctx = this.ctx;
    ctx.beginPath();
    let open = false;
    for (let i = 0; i <= 32; i += 1) {
      const a = (i / 32) * Math.PI * 2;
      const p = project({ x: at.x + Math.cos(a) * radius, y: at.y + Math.sin(a) * radius });
      if (!p) continue;
      if (open) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      open = true;
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }

  private drawMarker(q: Projected | null, alpha: number, word: string): void {
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
    ctx.fillText(word, q.x, q.y + 10);
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
      detail: this.tagDetail(shop),
      short: this.tagShort(shop),
      item: { shop, color, number },
      font,
    });
    picks.forEach((shop, i) => {
      const born = this.labelBorn(shop) ?? (this.phase === "run" ? null : -Infinity);
      if (born === null || born > now) return;
      const q = project(this.spots.get(shop.id)!);
      if (!q) return;
      const color = this.shopColor(shop);
      const age = now - born;
      if (age < IMPACT_MS) this.drawImpact(project, this.spots.get(shop.id)!, q, age, color, this.lastPose);
      if (age >= 0 && age < IMPACT_MS && this.run?.first && !this.felt.has(shop.id) && !this.popAt.has(shop.id)) {
        this.felt.add(shop.id);
        buzz(14);
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
    // The signs flown in from the photo get their names as they land.
    this.flight?.news.signs.forEach((sign, i) => {
      if (sign.landedAt === null || picks.includes(sign.shop) || sign.shop === this.selected) return;
      const q = project(this.spots.get(sign.shop.id)!);
      if (q) inputs.push(tag(sign.shop, q, -1e8 + i, READ_GREEN));
    });
    const area = { left: 8, top: this.insets.top, right: this.view.width - RULER_PX, bottom: this.labelBottom() };
    const blocked: Box[] = [];
    const you = project({ x: 0, y: 0 });
    // The "you" marker: its ring and the word under it (and, walking, the dot where you are now).
    if (you) blocked.push({ x: you.x - 12, y: you.y - 9, w: 24, h: 33 });
    const walker = this.walkAt ? project(this.walkPoint(this.walkAt)) : null;
    if (walker) blocked.push({ x: walker.x - 44, y: walker.y - 9, w: 88, h: 33 });
    if (this.flight && this.options.photo) {
      const thumb = this.flightThumb();
      blocked.push({ x: thumb.x - 8, y: thumb.y - 8, w: thumb.w + 16, h: thumb.h + 34 });
    }
    if (this.phase !== "run" || head >= this.run!.light.to - 1) {
      const reach = this.reach(this.focus);
      const end = project(pointAt(route, reach).at);
      if (end) {
        // The street's end (or where its places end): on whichever side has more room.
        const span = roadSpan(this.roadOnScreen, end.y - 20, end.y + 20);
        const side = area.right - (span?.max ?? end.x) >= (span?.min ?? end.x) - area.left ? "right" : "left";
        const rest = route.length - reach;
        const detail = this.focus?.quest ? "QUEST'S END" : rest > 1 ? `THEN ${distanceText(rest).toUpperCase()} WITH NO PLACES` : route.length < 4990 ? "THE STREET ENDS" : "END OF ROUTE";
        inputs.push({ key: "end", x: end.x, y: end.y, side, priority: 1e9, name: distanceText(reach), detail, item: { color: "#ffffff", end: true }, font: 11 });
      }
    }
    // Exploring close in: every place in view gets its name, those nearest the middle first, as room allows.
    const exploring = (this.userPose !== null || Boolean(this.walk?.follow && this.walkAt)) && this.phase !== "run";
    if (exploring && groundScale(this.lastPose, this.view) >= NAMES_PPM) {
      const cx = this.view.centerX ?? this.view.width / 2;
      const cy = (area.top + area.bottom) / 2;
      const near: { shop: ShopAhead; q: Projected; d: number }[] = [];
      for (const shop of this.street!.shops) {
        if (picks.includes(shop) || shop === this.selected || (this.focus && !this.focus.match(shop))) continue;
        const born = this.bornAt(shop);
        if (born === null || born > now) continue;
        const q = project(this.spots.get(shop.id)!);
        if (!q || q.x < area.left || q.x > area.right || q.y < area.top || q.y > area.bottom) continue;
        near.push({ shop, q, d: Math.hypot(q.x - cx, q.y - cy) });
      }
      near.sort((a, b) => a.d - b.d);
      near.slice(0, 48).forEach(({ shop, q }, i) => inputs.push(tag(shop, q, 1e6 + i, this.shopColor(shop))));
    }
    this.labels = layoutLabels(inputs, tagMeasure(ctx), { ...area, blocked }, this.roadOnScreen, exploring ? EXPLORE_TAGS : 10);
    for (const label of this.labels) this.drawLabel(label, now);
  }

  /** When a tag's place lit up: its late pop over the whole street, or when the light reached it. */
  private labelBorn(shop: ShopAhead): number | null {
    return (!this.focus ? this.popAt.get(shop.id) : undefined) ?? this.bornAt(shop);
  }

  /** Muse Spark's landmarks pop up over the whole street one after another, from the nearest. */
  private popPicks(from: number): void {
    const picked = this.landmarks.filter((s) => this.pickWhy.has(s.id));
    this.popAt = new Map(picked.map((s, i) => [s.id, from + i * POP_STEP_MS] as const));
    if (picked.length > 0) this.note(`✦ Muse Spark picked ${picked.length === 1 ? "a landmark" : `${picked.length} landmarks`} it knows by name.`, 4500, true);
  }

  /** Muse Spark's reason for naming a place on the street now shown (a landmark), if it picked it. */
  private whyPicked(shop: ShopAhead): PickReason | undefined {
    return !this.focus && this.landmarks.includes(shop) ? this.pickWhy.get(shop.id) : undefined;
  }

  /** Whether Muse Spark named this place among the best known of the chip now shown. */
  private bestPicked(shop: ShopAhead): boolean {
    return Boolean(this.focus && !this.focus.quest && this.aiBest[this.focus.key as GroupKey]?.includes(shop.id));
  }

  /** Metres ahead to a place: from you while walking the street, else from where the photo was taken. */
  private aheadM(shop: ShopAhead): number {
    return this.walkAt ? shop.s - this.walkAt.s : shop.s;
  }

  /** How far ahead a place is, for a tag: minutes on foot up to 2 km (≈, an estimate), then the distance; "behind" once walked past. */
  private aheadText(shop: ShopAhead): string {
    const d = this.aheadM(shop);
    if (this.walkAt && d < -5) return "behind";
    return walkText(this.walkAt ? Math.max(0, d) : d);
  }

  /** A tag's second line: distance and kind; a place Muse Spark picked carries its spark, and a landmark its reason. */
  private tagDetail(shop: ShopAhead): string {
    const why = this.whyPicked(shop);
    if (why) return `✦ ${PICK_REASONS[why]} · ${this.aheadText(shop)}`.toUpperCase();
    return `${this.bestPicked(shop) ? "✦ " : ""}${this.aheadText(shop)} · ${kindWord(shop.kind)}`.toUpperCase();
  }

  /** What a narrow tag keeps: how far, and the mark of Muse Spark's pick. */
  private tagShort(shop: ShopAhead): string {
    return `${this.whyPicked(shop) || this.bestPicked(shop) ? "✦ " : ""}${this.aheadText(shop)}`.toUpperCase();
  }

  /**
   * A landmark's arrival: two rings run out over the ground from it, a
   * flash at the place and a wash of its colour over the picture. Strongest
   * in the first run (the landmarks), lighter in tours.
   */
  private drawImpact(project: (p: EN, z?: number) => Projected | null, spot: EN, q: Projected, age: number, color: string, pose: Pose): void {
    const ctx = this.ctx;
    const strength = this.popAt.size > 0 && !this.focus ? 0.6 : this.run?.first ? 1 : this.focus?.quest ? 0.8 : 0.6;
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

  /** Where the photo shows during the signs' flight: small, at the top, its own proportions. */
  private flightThumb(): { x: number; y: number; w: number; h: number } {
    const photo = this.options.photo!;
    let w = Math.min(176, Math.round(this.view.width * 0.4));
    let hgt = Math.round((w * photo.height) / photo.width);
    const most = Math.round(this.view.height * 0.28);
    if (hgt > most) {
      hgt = most;
      w = Math.round((hgt * photo.width) / photo.height);
    }
    const cx = this.view.centerX ?? this.view.width / 2;
    return { x: Math.round(cx - w / 2), y: this.insets.top + 4, w, h: hgt };
  }

  /**
   * The signs Muse Spark read, flying from the photo to the street: the
   * photo shows small at the top with SAM 3.1's boxes on it, then each read
   * sign, cut out along SAM's outline, lifts out of its box and lands on its
   * place's dot with a tick, and the place gets its name.
   */
  private drawFlight(project: (p: EN, z?: number) => Projected | null, now: number): void {
    const flight = this.flight;
    const photo = this.options.photo;
    const model = this.model;
    if (!flight || !photo || !model) return;
    const t = now - flight.at;
    if (t < 0) return;
    const ctx = this.ctx;
    const signs = flight.news.signs;
    const total = flightLength(signs.length);
    const rect = this.flightThumb();
    const sx = rect.w / model.canvas.width;
    const sy = rect.h / model.canvas.height;
    const alpha = Math.min(easeInOut((t - 250) / 450), 1 - easeInOut((t - (total - FLIGHT.outMs - 300)) / 500));
    if (alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 10);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.clip();
      ctx.drawImage(photo, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      ctx.strokeStyle = rgba(LIGHT, 0.85);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // SAM's boxes in yellow; a read sign's box glows green just before it flies.
      for (const box of this.signBoxes) {
        const i = signs.findIndex((sign) => sign.box === box);
        const lift = i >= 0 ? (t - FLIGHT.firstMs - i * FLIGHT.stepMs) / 300 : -1;
        ctx.strokeStyle = lift > -1 && lift < 1 ? READ_GREEN : "rgba(255,230,0,0.85)";
        ctx.lineWidth = lift > -1 && lift < 1 ? 2 : 1;
        ctx.strokeRect(rect.x + box.x1 * sx, rect.y + box.y1 * sy, (box.x2 - box.x1) * sx, (box.y2 - box.y1) * sy);
      }
      ctx.font = `600 10px ${MONO}`;
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`SAM 3.1 · ${this.samFound} SIGNS · MUSE SPARK READ ${signs.length}`, rect.x + rect.w / 2, rect.y + rect.h + 7);
      ctx.restore();
    }
    const fade = 1 - easeInOut((t - (total - FLIGHT.outMs)) / FLIGHT.outMs);
    signs.forEach((sign, i) => {
      const k = flightProgress(i, t);
      if (k <= 0) return;
      const spot = this.spots.get(sign.shop.id);
      const q = spot ? project(spot) : null;
      if (!spot || !q) return;
      const b = sign.box;
      const aspect = sign.picture.width / Math.max(1, sign.picture.height);
      const endH = 30;
      const to = { x: q.x, y: q.y - endH / 2 - 10 };
      let at = to;
      let hgt = endH;
      if (k < 1) {
        const from = { x: rect.x + ((b.x1 + b.x2) / 2) * sx, y: rect.y + ((b.y1 + b.y2) / 2) * sy };
        at = arcPoint(from, to, k, 70);
        hgt = Math.max(8, (b.y2 - b.y1) * sy) + (endH - Math.max(8, (b.y2 - b.y1) * sy)) * k;
      } else if (sign.landedAt === null) {
        sign.landedAt = now;
        buzz(10);
      }
      if (sign.landedAt !== null && now - sign.landedAt < IMPACT_MS) this.drawImpact(project, spot, q, now - sign.landedAt, READ_GREEN, this.lastPose);
      const w = hgt * aspect;
      ctx.save();
      ctx.globalAlpha = k < 1 ? 1 : fade;
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 10;
      ctx.drawImage(sign.picture, at.x - w / 2, at.y - hgt / 2, w, hgt);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = k < 1 ? "#ffffff" : READ_GREEN;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(at.x - w / 2, at.y - hgt / 2, w, hgt);
      if (k >= 1) {
        // The tick: Muse Spark read this name, SAM drew its outline.
        ctx.fillStyle = READ_GREEN;
        ctx.beginPath();
        ctx.arc(at.x + w / 2, at.y - hgt / 2, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#00220f";
        ctx.font = `800 10px ${SANS}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("✓", at.x + w / 2, at.y - hgt / 2 + 0.5);
      }
      ctx.restore();
    });
  }

  /** What the sign check found comes on screen: as a flight to the street once the first run is over, else as the line with the pictures. */
  private signNews(news: SignNews): void {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (news.signs.length > 0 && !still && this.route) {
      if (this.phase === "computing" || (this.phase === "run" && this.run?.first)) {
        this.flightPending = news;
        return;
      }
      if ((this.phase === "settle" || this.phase === "overview") && !this.userPose && !this.focus && this.cardEl.classList.contains("hidden")) {
        this.startFlight(news, this.clock() + 200);
        return;
      }
    }
    this.note(news.text, 9000, true, news.pictures, news.caption);
  }

  /** The camera for the flight frames where you stood and the places whose signs fly, below the photo. */
  private startFlight(news: SignNews, at: number): void {
    const route = this.route;
    if (!route || !this.options.photo) return;
    const spots = news.signs.map((sign) => this.spots.get(sign.shop.id)).filter((p): p is EN => p !== undefined);
    const far = Math.max(150, ...news.signs.map((sign) => sign.shop.s + 60));
    // From behind you to past the farthest sign, so the street runs up the screen as in the run.
    const pts = [pointAt(route, Math.max(route.along[0], -20)).at, { x: 0, y: 0 }, ...spots, pointAt(route, far).at];
    const thumb = this.flightThumb();
    const side = Math.max(60, Math.round((this.view.width - RULER_PX) * 0.27));
    const pose = overviewPose(pts, this.view, { top: thumb.y + thumb.h + 30, bottom: this.insets.bottom + 20, left: side, right: side + RULER_PX });
    this.flight = { at, news, from: this.lastPose, pose };
  }

  /** The lowest a tag may reach: above the bottom bar, and above the caption while the light runs. */
  private labelBottom(): number {
    let bottom = this.view.height - this.insets.bottom;
    // Tags stay clear of an open card: the place it is about sits above it.
    if (!this.cardEl.classList.contains("hidden")) bottom = Math.min(bottom, this.cardEl.offsetTop - 8);
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
    const born = label.item.shop ? (this.labelBorn(label.item.shop) ?? -Infinity) : -Infinity;
    const age = now - born;
    const fresh = Number.isFinite(born) && age < 420;
    const k = fresh ? 0.55 + 0.45 * easeOutBack(age / 360) : 1;
    ctx.save();
    ctx.globalAlpha = fresh ? Math.min(1, age / 160) : 1;
    ctx.translate(label.x, label.y);
    ctx.scale(k, k);
    ctx.translate(-label.x, -label.y);
    drawTagStamped(ctx, label, this.canvas.width / this.view.width);
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
    const length = Math.max(1, this.shown || this.route!.length);
    const x = this.view.width - 16;
    const top = this.insets.top + 6;
    const bottom = this.view.height - this.insets.bottom - 6;
    if (bottom - top < 80) return;
    const yAt = (s: number) => bottom - (Math.max(0, Math.min(length, s)) / length) * (bottom - top);
    const shown = this.street!.shops.filter((shop) => {
      const born = this.bornAt(shop);
      return born !== null && born <= now;
    });
    const bins = 40;
    const counts = histogram(shown, length, bins);
    const most = Math.max(4, ...histogram(this.street!.shops.filter((s) => this.run?.born.has(s.id) ?? true), length, bins));
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
    for (let km = 1; km * 1000 < length; km += 1) ctx.fillRect(x - 2, yAt(km * 1000), 5, 1);
    ctx.fillText("0", x + 4, bottom + 10);
    ctx.fillText(`${(length / 1000).toFixed(1)}`, x + 6, top - 10);
    const lit = this.phase === "run" ? head : (this.run?.light.to ?? length);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, bottom);
    ctx.lineTo(x + 0.5, yAt(lit));
    ctx.stroke();
    if (this.phase === "run") ctx.drawImage(glow(color, true), x - 12, yAt(head) - 12, 24, 24);
    ctx.globalCompositeOperation = "source-over";
    if (this.walkAt) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x + 0.5, yAt(this.walkAt.s), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ----- The page around the picture -----

  private updateHud(now: number, head: number): void {
    const street = this.street;
    // The street's name types itself in once it is known.
    let name = "Finding your street";
    if (this.phase === "failed") name = "No street found";
    else if (street) name = this.title().slice(0, Math.max(0, Math.floor((now - this.loadedAt) / 55)));
    let stats = "";
    if (street && this.run) {
      const run = this.run;
      let count = 0;
      for (const t of run.born.values()) if (t <= now) count += 1;
      const noun = this.focus ? this.focus.noun : "places";
      const km = (Math.max(0, this.phase === "run" ? head : this.reach(this.focus)) / 1000).toFixed(2);
      stats = !this.focus && this.phase !== "run" && street.placesFound ? `${km} km · ${count} of ${street.placesFound} places` : `${km} km · ${count} ${noun}`;
    }
    const key = `${name}|${stats}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.nameEl.textContent = name || "\u00a0";
      this.statsEl.textContent = stats;
      // Sized for the name alone: the numbers under it change every frame while the light runs, and measuring then forced a layout each time.
      const full = street ? this.title() : name;
      if (full !== this.fittedName) {
        this.fittedName = full;
        this.fitName(full);
      }
    }
    this.renderConsole(now);
    if (this.walk) this.renderWalkBar(now);
  }

  /** The street's name at the top: a demo street's own title, else the map's name. */
  private title(): string {
    return this.options.title ?? this.street?.name ?? "Unnamed street";
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
      h("div", {
        class: "show-caption-k",
        // Muse Spark's mark before the kind: a narrow screen cuts the end of the line.
        text: `${what} ${index + 1} / ${picks.length}${this.captionMark(shop)} · ${walkText(shop.s).toUpperCase()} · ${kindWord(shop.kind).toUpperCase()}`,
      }),
      h("div", { class: "show-caption-name", text: shop.name }),
      line ? h("div", { class: "show-caption-line", text: line }) : "",
      h("div", { class: "show-caption-glint" }),
    );
    this.captionEl.classList.remove("hidden");
  }

  /** The lower third's word for a place Muse Spark picked. */
  private captionMark(shop: ShopAhead): string {
    const why = this.whyPicked(shop);
    if (why) return ` · ✦ ${PICK_REASONS[why].toUpperCase()}`;
    return this.bestPicked(shop) ? " · ✦ MUSE SPARK" : "";
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
    const placesEnd = this.shown < street.route.length - 1 ? ` · places up to ${distanceText(this.shown)}` : "";
    rows.push({ id: "route", key: "ROUTE", value: `${distanceText(street.route.length)} ahead${street.route.length < 4990 ? " (the street ends)" : ""}${placesEnd}`, state: tick(2) });
    rows.push({ id: "places", key: "PLACES", value: `${street.shops.length}${street.placesFound ? ` of ${street.placesFound}` : ""}`, state: tick(3) });
    const named =
      this.picksState === "asking"
        ? `Muse Spark choosing from ${this.pickCount} places${dots}`
        : this.picksState === "done"
          ? `${this.landmarks.length} · picked by Muse Spark${this.picksNote}`
          : this.picksState === "failed"
            ? `${this.landmarks.length} · by the map's ranking (Muse Spark ${this.picksNote})`
            : `${this.landmarks.length}`;
    rows.push({ id: "landmarks", key: "LANDMARKS", value: named, state: this.picksState === "asking" ? "wait" : tick(4) });
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
    // Muse Spark's best known of this kind first, then the map's ranking; the map's alone when the model knows none.
    const rules = pickGroup(street.shops, group, this.shown || street.route.length, street.name);
    const byId = new Map(street.shops.map((s) => [s.id, s]));
    const known = (this.aiBest[group.key] ?? []).map((id) => byId.get(id)).filter((s): s is ShopAhead => s !== undefined);
    const focus: Focus = {
      key: group.key,
      noun: group.noun,
      color: group.color,
      match: (shop) => group.categories.includes(shop.category),
      picks: known.length > 0 ? mergePicks(known, rules, 6, 3) : rules,
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
      roundButton(REPLAY_PATH, "Replay the quest", () => this.beginRun(focus, this.clock())),
      h("button", { class: "show-round", "aria-label": "End the quest", title: "End the quest", onclick: () => this.endQuest(true) }, "×"),
    );
    this.questBarEl.classList.remove("hidden", "offer");
    this.beginRun(focus, this.clock());
    this.walkBarKey = "";
    if (this.walk) this.renderWalkBar(this.clock());
    this.measureInsets();
  }

  private endQuest(back: boolean): void {
    if (this.questBarEl.classList.contains("hidden")) return;
    this.questBarEl.classList.add("hidden");
    this.walkBarKey = "";
    if (this.walk) this.renderWalkBar(this.clock());
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
    const light = lightRun(this.route.along[0], this.reach(null), [], TOUR_PACE);
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

  // ----- Walking the street -----

  /** Once the first run is over: a street from the live camera follows the phone along it; one from the map alone offers a SIMULATED walk. */
  private offerWalk(): void {
    if (this.walk || !this.street) return;
    if (this.options.live) this.startWalk("live");
    else if (this.options.simulate) this.renderWalkBar(this.clock(), true);
  }

  private startWalk(mode: "live" | "simulated"): void {
    if (!this.route || !this.local || this.disposed) return;
    this.stopWalk(false);
    const now = this.clock();
    const walk: Walk = { mode, spot: null, shown: null, lastFrame: now, follow: true, camFrom: this.lastPose, camAt: now, offSince: null, watch: null, timer: 0, started: now };
    if (mode === "live") {
      if (!("geolocation" in navigator)) {
        this.note("This browser gives no position: the dot cannot follow you.", 5000);
        return;
      }
      walk.watch = navigator.geolocation.watchPosition(
        (p) => this.onFix({ lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy, at: p.timestamp }),
        (error) => {
          if (error.code !== 1) return;
          this.note("Location is off for this page, so the dot cannot follow you.", 6000);
          this.stopWalk();
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
      );
    } else {
      // A fix a second, as a phone gives them.
      const tick = () => this.onFix(simulatedFix(this.route!, this.local!, this.clock() - walk.started));
      walk.timer = window.setInterval(tick, 1000);
      window.setTimeout(tick, 0);
    }
    this.walk = walk;
    this.userPose = null;
    this.glide = null;
    this.fitButton.classList.add("hidden");
    void this.keepAwake();
    this.renderWalkBar(now);
  }

  /** Stops following the phone (or the SIMULATED walk); `offer`: the bar then offers to walk again. */
  private stopWalk(offer = true): void {
    const walk = this.walk;
    if (!walk) return;
    if (walk.watch !== null) navigator.geolocation.clearWatch(walk.watch);
    window.clearInterval(walk.timer);
    this.walk = null;
    this.walkAt = null;
    const wake = this.wake;
    this.wake = null;
    void wake?.release().catch(() => undefined);
    if (!this.disposed) this.renderWalkBar(this.clock(), offer);
  }

  private onFix(fix: WalkFix): void {
    const walk = this.walk;
    if (!walk || !this.route || !this.local || this.disposed) return;
    const prev = walk.spot;
    const spot = walkStep(prev, this.route, this.local, fix);
    if (!spot) return;
    const now = this.clock();
    walk.spot = spot;
    walk.shown ??= { s: spot.s, offset: spot.offset };
    walk.offSince = spot.onStreet ? null : (walk.offSince ?? now);
    // A landmark passed: it lights up again, the phone buzzes, a line says which.
    if (prev?.onStreet && spot.onStreet && !this.focus) {
      for (const shop of passed(this.landmarks, prev.s, spot.s)) {
        this.popAt.set(shop.id, now);
        buzz(14);
        this.note(`Passing ${shop.name}, on your ${shop.side}`, 4000);
      }
    }
  }

  /** Where the dot is this frame: gliding towards the last fix, so it moves rather than jumps once a second. */
  private walkShown(now: number): { s: number; offset: number } | null {
    const walk = this.walk;
    if (!walk?.spot || !walk.shown) return null;
    const k = 1 - Math.exp(-Math.max(0, now - walk.lastFrame) / 450);
    walk.lastFrame = now;
    walk.shown = { s: walk.shown.s + k * (walk.spot.s - walk.shown.s), offset: walk.shown.offset + k * (walk.spot.offset - walk.shown.offset) };
    return walk.shown;
  }

  /**
   * The camera while walking: behind and above you, moved so your dot
   * stands a little above the bar, the buttons and any open card (on a
   * short screen they cover the lower third, where the follow camera alone
   * would put it), with the street ahead above it.
   */
  private walkPose(at: { s: number; offset: number }): Pose {
    const pose = followPose(this.route!, at.s, WALK_FOLLOW);
    const sx = this.view.centerX ?? this.view.width / 2;
    const sy = Math.max(this.insets.top + 140, this.labelBottom() - 64);
    return poseKeeping(pose, this.view, this.walkPoint(at), sx, sy) ?? pose;
  }

  /** The dot on the ground: on the street's line, a little to the side you are on. */
  private walkPoint(at: { s: number; offset: number }): EN {
    const { at: p, headingDeg } = pointAt(this.route!, at.s);
    const h = (headingDeg * Math.PI) / 180;
    const off = Math.max(-24, Math.min(24, at.offset));
    return { x: p.x + Math.cos(h) * off, y: p.y - Math.sin(h) * off };
  }

  /** Back to following the dot, after a look around. */
  private followAgain(): void {
    if (!this.walk) return;
    this.walk.follow = true;
    this.walk.camFrom = this.lastPose;
    this.walk.camAt = this.clock();
    this.userPose = null;
    this.glide = null;
    this.fitButton.classList.add("hidden");
  }

  /**
   * The bar above the buttons while walking: the next place (on a quest, the
   * next stop), how far along the street you are and the next landmark (or the
   * quest). One bar at a time: walking, it stands in for the quest's. Before
   * a walk, Walk in the buttons offers it (SIMULATED where no phone is on the
   * street).
   */
  private renderWalkBar(now: number, offer = false): void {
    const walk = this.walk;
    const street = this.street;
    const quest = this.questBarEl.classList.contains("hidden") ? null : (this.focus?.quest ?? null);
    let key = "";
    let parts: (Node | null)[] = [];
    if (street && walk) {
      const spot = walk.spot;
      const where = street.name ?? "the street";
      const tag = walk.mode === "simulated" ? `SIMULATED ×${SIMULATED_SPEEDUP}` : "LIVE";
      let title = "Finding your position…";
      let line = `${tag} · the dot follows your phone along ${where}`;
      let gold = false;
      if (spot && !spot.onStreet) {
        title = `Off ${where}, ${distanceText(spot.awayM)} away`;
        line = `${tag} · back on it, the dot picks you up again`;
      } else if (spot) {
        const along = `${tag} · ${(Math.max(0, spot.s) / 1000).toFixed(2)} km along`;
        const stops = quest ? [...quest.stops].sort((a, b) => a.s - b.s) : [];
        const stop = stops.findIndex((x) => x.s > spot.s + 5);
        if (quest && stop >= 0) {
          const next = stops[stop];
          title = `Stop ${stop + 1}/${stops.length}: ${next.name} · ${distanceText(next.s - spot.s)} on the ${next.side}`;
          line = `${along} · ✦ ${quest.quest.title}`;
          gold = true;
        } else {
          const next = nextPlace(street.shops, spot.s);
          const mark = this.landmarks.find((l) => l.s > spot.s + 5);
          title = next ? `Next: ${next.name} · ${distanceText(next.s - spot.s)} on the ${next.side}` : `The end of ${where} is near`;
          line = quest ? `${along} · ✦ ${quest.quest.title}: every stop passed` : `${along}${mark && mark !== next ? ` · ✦ ${mark.name} in ${distanceText(mark.s - spot.s)}` : ""}`;
        }
      }
      const away = walk.offSince !== null && now - walk.offSince > OFF_STREET_MS && this.options.onNewStreet;
      key = `walk|${title}|${line}|${walk.follow}|${away}|${gold}`;
      parts = [
        h("div", { class: "show-quest-text" }, h("strong", { class: gold ? "gold" : "" }, h("i", { class: `show-walk-dot${walk.mode === "simulated" ? " sim" : ""}` }), title), h("span", { text: line })),
        away ? h("button", { class: "show-pill", onclick: () => this.options.onNewStreet?.() }, "New street here") : null,
        walk.follow ? null : roundButton(LOCATE_PATH, "Follow your dot again", () => this.followAgain()),
        h("button", { class: "show-round", "aria-label": "Stop following", title: "Stop following", onclick: () => this.stopWalk() }, "×"),
      ];
    }
    const offering = !walk && offer && street !== null && (this.options.live === true || this.options.simulate === true);
    this.walkButton.classList.toggle("hidden", !offering);
    this.bottomEl.classList.toggle("walking", walk !== null);
    if (key === this.walkBarKey) return;
    this.walkBarKey = key;
    this.walkBarEl.replaceChildren(...parts.filter((x): x is Node => x !== null));
    this.walkBarEl.classList.toggle("hidden", key === "");
    this.measureInsets();
  }

  /** The screen stays on while walking: a phone in hand, glanced at now and then. */
  private async keepAwake(): Promise<void> {
    const lock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!lock || !this.walk) return;
    try {
      this.wake = await lock.request("screen");
    } catch {
      // Not granted (low battery, an older browser): the screen sleeps as it would.
    }
  }

  /** A wake lock ends when the page is hidden; back in view, while walking, it is asked for again. */
  private onVisible = (): void => {
    if (document.visibilityState !== "visible" || !this.walk) return;
    this.wake = null;
    void this.keepAwake();
  };

  // ----- Exploring: pinch, drag, scroll -----

  /** After the run has begun: before it the street is not drawn yet. */
  private canExplore(): boolean {
    return this.street !== null && this.exploreBox !== null && (this.phase === "run" || this.phase === "settle" || this.phase === "overview");
  }

  private limits(): ExploreLimits {
    return { minDistance: 150, maxDistance: Math.max(1500, this.overview.distance * 1.4), box: this.exploreBox! };
  }

  /** The visitor takes the camera: a running light first jumps to its end, so the whole street is there to explore. */
  private takeCamera(): void {
    if (this.phase === "run") this.skip();
    if (this.walk) this.walk.follow = false;
    if (!this.userPose) this.userPose = { ...this.lastPose };
    this.glide = null;
    this.zoomHinted = true;
    if (this.hintUp) this.noteEl.classList.add("hidden");
    this.fitButton.classList.remove("hidden");
  }

  /** The show's camera again (a new run, or back to the whole street). */
  private releaseCamera(): void {
    this.userPose = null;
    this.glide = null;
    this.gesture = null;
    this.fitButton.classList.add("hidden");
  }

  /** Glides back to the whole street, then hands the camera back to the show. */
  private fitWhole(): void {
    if (!this.userPose) return;
    this.glide = { from: this.lastPose, to: this.overview, at: this.clock(), ms: 700, done: () => this.releaseCamera() };
  }

  private pointerAt(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Where the gesture is: the finger, or the middle of two; and how far apart two are. */
  private gestureSpot(): { x: number; y: number; spread: number } {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return { ...pts[0], spread: 0 };
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, spread: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
  }

  /** A gesture starts (or changes from one finger to two): the ground under it is held from now on. */
  private beginGesture(moved: boolean): void {
    if (this.pointers.size === 0) {
      this.gesture = null;
      return;
    }
    const at = this.gestureSpot();
    const pose = this.userPose ?? this.lastPose;
    this.gesture = { pose, anchor: groundAt(pose, this.view, at.x, at.y), startX: at.x, startY: at.y, spread: at.spread, moved };
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.canExplore()) return;
    if (this.pointers.size === 0) this.suppressClick = false;
    this.pointers.set(e.pointerId, this.pointerAt(e));
    try {
      // The finger keeps the gesture even when it slides over the buttons.
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the gesture goes on without the capture.
    }
    this.beginGesture(this.gesture?.moved ?? false);
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, this.pointerAt(e));
    const g = this.gesture;
    if (!g) return;
    const at = this.gestureSpot();
    if (!g.moved) {
      if (this.pointers.size < 2 && Math.hypot(at.x - g.startX, at.y - g.startY) < DRAG_SLOP_PX) return;
      this.takeCamera();
      // The camera may have moved since the finger went down (the light was running): hold the ground under it now.
      g.pose = this.userPose!;
      g.anchor = groundAt(g.pose, this.view, g.startX, g.startY);
      g.moved = true;
      this.canvas.classList.add("dragging");
    }
    if (!g.anchor) return;
    const limits = this.limits();
    const pose = g.spread > 0 && at.spread > 0 ? clampPose({ ...g.pose, distance: (g.pose.distance * g.spread) / at.spread }, limits) : g.pose;
    this.userPose = clampPose(poseKeeping(pose, this.view, g.anchor, at.x, at.y) ?? pose, limits);
  }

  private pointerUp(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId)) return;
    const moved = this.gesture?.moved ?? false;
    if (moved) this.suppressClick = true;
    if (this.pointers.size > 0) this.beginGesture(moved);
    else {
      this.gesture = null;
      this.canvas.classList.remove("dragging");
    }
  }

  private wheel(e: WheelEvent): void {
    if (!this.canExplore()) return;
    e.preventDefault();
    this.takeCamera();
    const at = this.pointerAt(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    // A trackpad pinch arrives as a wheel with ctrlKey and small steps.
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
    this.userPose = zoomAbout(this.userPose!, this.view, factor, at.x, at.y, this.limits());
  }

  /**
   * After a tap on a place: the camera glides so the place sits in the open
   * space above its card, closer in when the street was seen from far, so
   * its neighbours get their names too.
   */
  private bringIntoView(shop: ShopAhead): void {
    if ((this.phase !== "settle" && this.phase !== "overview") || !this.exploreBox) return;
    const spot = this.spots.get(shop.id);
    if (!spot) return;
    const from = this.lastPose;
    const top = this.insets.top + 30;
    const cardTop = this.cardEl.classList.contains("hidden") ? this.view.height - this.insets.bottom : this.cardEl.offsetTop;
    const x = this.view.centerX ?? this.view.width / 2;
    const y = Math.max(top, (top + cardTop) / 2);
    const limits = this.limits();
    const closer = groundScale(from, this.view) < TAP_PPM ? clampPose({ ...from, distance: focalPx(this.view) / TAP_PPM }, limits) : from;
    const to = clampPose(poseKeeping(closer, this.view, spot, x, y) ?? closer, limits);
    this.userPose = this.userPose ?? { ...from };
    if (this.walk) this.walk.follow = false;
    this.glide = { from, to, at: this.clock(), ms: 650 };
    this.zoomHinted = true;
    this.fitButton.classList.remove("hidden");
  }

  /** Once, after the first run: how to look closer (when no other line is up). */
  private hintZoom(tries: number): void {
    window.setTimeout(() => {
      if (this.disposed || this.zoomHinted || this.phase === "run") return;
      // Not over the signs' flight: after it.
      if (this.flight || this.flightPending) {
        if (tries > 1) this.hintZoom(tries - 1);
        return;
      }
      if (!this.noteEl.classList.contains("hidden")) {
        if (tries > 1) this.hintZoom(tries - 1);
        return;
      }
      this.zoomHinted = true;
      this.note("Pinch or scroll to zoom into a stretch: every place there gets its name. Drag to move.", 5000);
      this.hintUp = true;
    }, 1500);
  }

  private tap(e: MouseEvent): void {
    if (!this.street || this.phase === "computing" || this.phase === "failed") return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = this.labels.find((l) => l.item.shop && x >= l.box.x && x <= l.box.x + l.box.w && y >= l.box.y && y <= l.box.y + l.box.h);
    if (hit?.item.shop) {
      this.showCard(hit.item.shop);
      this.bringIntoView(hit.item.shop);
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
    if (best) {
      this.showCard(best);
      this.bringIntoView(best);
    } else {
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
      h("p", { class: "show-card-where", text: this.cardWhere(shop) }),
      this.pickWhy.has(shop.id) && this.landmarks.includes(shop)
        ? h("p", { class: "show-card-quest", text: `✦ Landmark picked by Muse Spark: ${PICK_REASONS[this.pickWhy.get(shop.id)!].toLowerCase()}` })
        : this.aiBest[group.key]?.includes(shop.id)
          ? h("p", { class: "show-card-quest", text: `✦ Muse Spark knows it by name: among the street's best-known ${group.noun}` })
          : null,
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

  /** Where a place is, for its card: behind you, or how far ahead and on which side, with the walk when it is walkable. */
  private cardWhere(shop: ShopAhead): string {
    const d = this.aheadM(shop);
    if (this.walkAt && d < -5) return `Behind you, on the ${shop.side}`;
    const walk = d >= 0 && d <= WALK_MINUTES_UP_TO_M ? ` · ≈${walkMinutes(d)} min walk` : "";
    return `${distanceText(Math.max(0, d))} ahead on the ${shop.side}${walk}`;
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
    this.hintUp = false;
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
    const canvas = drawShareCard({ street: this.street, photo: this.options.photo, quest, landmarks: this.landmarks, reach: this.shown });
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
   * Asks Muse Spark Open which of the street's places to name: the
   * landmarks and the best known of each kind. The first run waits a few
   * seconds for the answer; a later answer names the places from the next
   * view on, and none at all leaves the map's ranking, as before.
   */
  private async askPicks(places: PickPlace[]): Promise<void> {
    this.picksState = "asking";
    let asked = this.demoAsked;
    try {
      let res = this.demoPicks ? await this.demoPicks : null;
      if (!res) {
        asked = performance.now();
        res = await fetch("/api/landmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ places, street: this.street?.name?.slice(0, 80), near: roughPosition(this.options.origin) }),
          signal: this.abort.signal,
        });
      }
      const body = (await res.json().catch(() => ({}))) as { picks?: Picks; cached?: boolean; latencyMs?: number };
      if (this.disposed) return;
      if (!res.ok || !body.picks) {
        this.picksState = "failed";
        this.picksNote = res.status === 503 ? "off" : "did not answer";
        return;
      }
      // An answer kept by the server or the CDN comes back quicker than the model took to give it.
      const took = performance.now() - asked;
      this.applyPicks(body.picks, body.cached || took + 100 < (body.latencyMs ?? 0) ? "asked before" : `${(took / 1000).toFixed(1)} s`);
      this.options.onPicks?.(body.picks);
    } catch {
      if (this.disposed) return;
      this.picksState = "failed";
      this.picksNote = "did not answer";
    }
  }

  /** Muse Spark's picks take over: at once while the readings are up, after the first run when it is under way. */
  private applyPicks(picks: Picks, note: string): void {
    const street = this.street;
    if (!street) return;
    const landmarks = landmarksFrom(picks, street.shops, this.ruleLandmarks, this.shown || street.route.length);
    const why = new Map(picks.landmarks.map((l) => [l.id, l.why] as const));
    this.pickWhy = new Map(landmarks.filter((s) => why.has(s.id)).map((s) => [s.id, why.get(s.id)!] as const));
    this.aiBest = picks.best;
    this.modelNamed = knownIds(picks);
    this.picksState = "done";
    this.picksAt = this.clock();
    this.picksNote = note ? ` · ${note}` : "";
    if (this.phase === "computing" || this.phase === "failed") this.landmarks = landmarks;
    else if (this.phase === "run" && this.run?.first) this.pendingLandmarks = landmarks;
    else {
      this.landmarks = landmarks;
      if (!this.focus && this.phase !== "run") this.popPicks(this.clock() + 200);
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
      const flying: FlightSign[] = [];
      const signs = signsForPlaces(read, boxes);
      for (const x of read) {
        const box = signs.get(x.id);
        if (!box) continue;
        // From the full photo for a sharp picture, unless that would be a large one to make while the light runs.
        const sharp = (box.x2 - box.x1) * full <= CUT_MAX_PX;
        const picture = sharp ? cutSign(photo, box, full) : cutSign(model.canvas, box);
        const src = picture.toDataURL("image/png");
        this.signCuts.set(x.id, src);
        if (pictures.length < 4) pictures.push({ src, alt: `The sign of ${byId.get(x.id)!.name}` });
        if (flying.length < 5) flying.push({ shop: byId.get(x.id)!, picture, box, landedAt: null });
      }
      if (names.length > 0) {
        this.signNews({
          text: `✓ Muse Spark read ${names.length === 1 ? "a sign" : `${names.length} signs`} in your photo: ${names.join(", ")}. Right street, right way.`,
          pictures,
          caption: pictures.length > 0 ? "outlined by SAM 3.1" : "",
          signs: flying.sort((a, b) => a.shop.s - b.shop.s),
        });
      } else if (body.spotted.view === "across") this.note("Muse Spark sees building fronts, not a street running away from you. Turn to look along the street and try again.", 9000);
    } catch {
      // The sign check is a bonus: without it the street still shows.
    }
  }
}
