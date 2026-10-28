/**
 * The page. Street ahead (the default): home → camera (or a photo, a street
 * on the map, the synthetic street) → the street view. Building what-if
 * (?mode=building, the earlier prototype): home → camera (or a photo, a
 * preset, the synthetic scene) → pick the building on the top view → mark it
 * on the photo → the video.
 */
import { LiveCamera } from "../capture/camera.js";
import { readExif } from "../capture/exif.js";
import { Sensors, screenAngle } from "../capture/sensors.js";
import { ASSUMED_FOV_LONG_DEG, gpsSigmaM, type CaptureMeta } from "../capture/types.js";
import { intrinsicsFrom35mm, horizontalFovDeg, longSideFovDeg } from "../camera/pose.js";
import { isFootprintSet, type FootprintSet } from "../data/footprints.js";
import type { CornerMarks } from "../estimate/register.js";
import { predictMarks, type BuildingSpec, type Located } from "../estimate/spec.js";
import { tiltFromVerticals } from "../estimate/verticals.js";
import { compassWord, type DesignPlan } from "../design/plan.js";
import {
  designFacts,
  designPlan,
  facadeColor,
  layoutFor,
  photoForModel,
  prepare,
  specFor,
  type SceneInput,
} from "../pipeline.js";
import { downloadJson, parsePreset, presetFrom, sceneFromPreset } from "../preset/preset.js";
import { Player, pickRecordingType } from "../scene/player.js";
import { syntheticScene } from "../synthetic/scene.js";
import type { StreetAhead } from "../street/street.js";
import { syntheticStreet } from "../street/synthetic.js";
import { StreetShow } from "../street/show.js";
import { h, fmt } from "./dom.js";
import { factsPanel } from "./facts.js";
import { Marker } from "./marker.js";
import { topView } from "./topview.js";

type Status = { basetenApiKeyConfigured: boolean; modelApiKeyConfigured: boolean } | null;

const params = new URLSearchParams(location.search);

/**
 * Streets to fly down from the map alone, without a photo: a point near the
 * street, the direction to look and the street's name on the map (which
 * picks it out when the point is a little off). Starting points, not survey marks.
 */
const FAMOUS_STREETS = [
  { label: "Gangnam-daero, Seoul (north from Gangnam Station)", lat: 37.4985, lon: 127.0274, headingDeg: 343, street: "강남대로" },
  { label: "Fifth Avenue, New York (north from 42nd Street)", lat: 40.7536, lon: -73.9807, headingDeg: 29, street: "5th Avenue" },
  { label: "Robson Street, Vancouver (north-west from Burrard)", lat: 49.2838, lon: -123.1233, headingDeg: 315, street: "Robson Street" },
];

export class App {
  private readonly root: HTMLElement;
  private status: Status = null;
  private input: SceneInput | null = null;
  private located: Located | null = null;
  private selectedId: string | null = null;
  private marks: CornerMarks | null = null;
  /** The marks were placed by a person (or come with a preset), not just guessed from the sensors. */
  private marksPlaced = false;
  private player: Player | null = null;
  private spec: BuildingSpec | null = null;
  private plan: DesignPlan | null = null;
  private sensors: Sensors | null = null;
  private camera: LiveCamera | null = null;
  private hudTimer = 0;
  private readonly mode: "street" | "building" = params.get("mode") === "building" ? "building" : "street";
  private streetShow: StreetShow | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    // Street ahead is drawn on black throughout: home, photo form and show.
    document.body.classList.toggle("street-mode", this.mode === "street");
  }

  async start(): Promise<void> {
    void fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        this.status = s as Status;
        const el = document.getElementById("model-status");
        if (el) el.replaceWith(this.statusLine());
      })
      .catch(() => undefined);
    const autoplay = params.get("autoplay") === "1";
    try {
      if (params.get("demo") === "synthetic") {
        await this.load(syntheticScene(), autoplay);
        return;
      }
      if (params.get("demo") === "street") {
        this.showStreet(syntheticStreet());
        return;
      }
      const at = params.get("street")?.split(",");
      const nums = at?.slice(0, 3).map(Number);
      if (at && nums && nums.length === 3 && nums.every(Number.isFinite)) {
        await this.streetFor({ lat: nums[0], lon: nums[1], headingDeg: nums[2], street: at.slice(3).join(",").trim() || undefined });
        return;
      }
      const preset = params.get("preset");
      if (preset) {
        // Same-origin presets only, so a link cannot put someone else's captions on this site.
        if (!preset.startsWith("/") || preset.startsWith("//")) throw new Error("Presets load from this site only (a path starting with /).");
        const res = await fetch(preset);
        if (!res.ok) throw new Error(`Could not load the preset (${res.status}).`);
        await this.load(await sceneFromPreset(parsePreset(await res.text())), autoplay);
        return;
      }
    } catch (error) {
      this.home(error instanceof Error ? error.message : String(error));
      return;
    }
    this.home();
  }

  private screen(...children: (Node | null | false)[]): void {
    this.player?.pause();
    this.streetShow?.dispose();
    this.streetShow = null;
    this.root.replaceChildren(...children.filter((c): c is Node => Boolean(c)));
    window.scrollTo(0, 0);
  }

  private statusLine(): HTMLElement {
    const s = this.status;
    const text = !s
      ? "Design model: checking…"
      : s.basetenApiKeyConfigured
        ? "Design model: Muse Spark Open connected"
        : "Design model not configured: the app uses its local plan";
    return h("p", { id: "model-status", class: "muted small", text });
  }

  private home(error?: string): void {
    this.stopLive();
    if (this.mode === "street") {
      this.streetHome(error);
      return;
    }
    const presetInput = h("input", { type: "file", accept: "application/json,.json", class: "hidden" });
    presetInput.addEventListener("change", async () => {
      const file = presetInput.files?.[0];
      if (!file) return;
      try {
        await this.load(await sceneFromPreset(parsePreset(await file.text())), false);
      } catch (e) {
        this.home(e instanceof Error ? e.message : String(e));
      }
    });
    const photoInput = h("input", { type: "file", accept: "image/jpeg,image/*", class: "hidden" });
    photoInput.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (file) void this.fromUpload(file);
    });
    const list = h("ul", { class: "preset-list" });
    void fetch("/presets/index.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((items: { file: string; label: string }[]) => {
        for (const item of Array.isArray(items) ? items : []) {
          list.append(h("li", {}, h("a", { href: `?preset=/presets/${encodeURIComponent(item.file)}&autoplay=1`, text: item.label })));
        }
      })
      .catch(() => undefined);
    this.screen(
      h(
        "main",
        { class: "home" },
        h("h1", {}, "What if", h("span", { class: "accent", text: "?" })),
        h("p", { class: "lead", text: "Point your phone at a building. One photo and the map turn it into a 3D model with its measurements, then you see what it could become." }),
        error ? h("p", { class: "error", text: error }) : null,
        h("button", { class: "primary big", onclick: () => void this.openCamera() }, "Open camera"),
        h("div", { class: "row" },
          h("button", { onclick: () => photoInput.click() }, "Use a photo"),
          h("button", { onclick: () => presetInput.click() }, "Load a preset"),
        ),
        h("button", { class: "ghost", onclick: () => void this.load(syntheticScene(), false) }, "Try the synthetic demo"),
        list,
        photoInput,
        presetInput,
        this.statusLine(),
        h("p", { class: "muted small", text: "Footprints © OpenStreetMap contributors (ODbL). Heights, floors and designs are estimates and ideas, not survey results." }),
      ),
    );
  }

  private streetHome(error?: string): void {
    const photoInput = h("input", { type: "file", accept: "image/jpeg,image/*", class: "hidden" });
    photoInput.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (file) void this.fromUpload(file);
    });
    this.screen(
      h(
        "main",
        { class: "home" },
        h("div", { class: "home-kicker", text: "STREET AHEAD" }),
        h("h1", {}, "What's ahead", h("span", { class: "accent", text: "?" })),
        h("p", {
          class: "lead",
          text: "Point your phone down a street and take one photo. A light runs 5 km down the street, dotting every place the map knows at its distance and side, and stops at the landmarks. Then tap Restaurants, Cafés, Shops… to send it down the street again for just those.",
        }),
        error ? h("p", { class: "error", text: error }) : null,
        h("button", { class: "primary big", onclick: () => void this.openCamera() }, "Open camera"),
        h(
          "div",
          { class: "row" },
          h("button", { onclick: () => photoInput.click() }, "Use a photo"),
          h("button", { class: "ghost", onclick: () => this.showStreet(syntheticStreet()) }, "Synthetic street"),
        ),
        h("p", { class: "muted small", text: "Or fly down a street from the map alone:" }),
        h("div", { class: "street-places" }, ...FAMOUS_STREETS.map((s) => h("button", { onclick: () => void this.streetFor(s) }, s.label))),
        photoInput,
        h("p", { class: "muted small", text: "Streets © OpenStreetMap contributors (ODbL); places © Overture Maps Foundation (CDLA-Permissive-2.0). Places change; the map may be out of date." }),
        h("p", { class: "muted small" }, h("a", { href: "?mode=building" }, "Building what-if (the earlier prototype)")),
      ),
    );
  }

  private async streetFor(at: { lat: number; lon: number; headingDeg: number; street?: string }, photo?: HTMLCanvasElement, capture?: CaptureMeta): Promise<void> {
    // The show starts at once: its radar runs while the street is looked up.
    const show = this.openShow(at, photo, capture, () => void this.streetFor(at, photo, capture));
    try {
      const query = new URLSearchParams({ lat: String(at.lat), lon: String(at.lon), heading: String(at.headingDeg) });
      if (at.street) query.set("street", at.street);
      const res = await fetch(`/api/street?${query}`);
      const body = (await res.json().catch(() => ({}))) as Partial<StreetAhead> & { error?: string };
      if (!res.ok || !body.route) throw new Error(body.error ?? `The street lookup answered ${res.status}.`);
      show.load(body as StreetAhead);
    } catch (error) {
      show.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private showStreet(street: StreetAhead): void {
    this.openShow({ lat: street.origin.lat, lon: street.origin.lon, headingDeg: street.headingDeg }).load(street);
  }

  private openShow(at: { lat: number; lon: number; headingDeg: number }, photo?: HTMLCanvasElement, capture?: CaptureMeta, onRetry?: () => void): StreetShow {
    const show = new StreetShow({ origin: { lat: at.lat, lon: at.lon }, headingDeg: at.headingDeg, photo, capture, onClose: () => this.home(), onRetry });
    this.screen(show.element);
    this.streetShow = show;
    show.start();
    // Handle for the browser tests on the dev server.
    if (import.meta.env.DEV) Object.assign(window, { __street: show });
    return show;
  }

  private stopLive(): void {
    window.clearInterval(this.hudTimer);
    this.camera?.stop();
    this.camera = null;
    this.sensors?.stop();
    this.sensors = null;
  }

  // ----- Live capture -----

  private async openCamera(): Promise<void> {
    const sensors = new Sensors();
    const camera = new LiveCamera();
    try {
      await sensors.start();
      await camera.start();
    } catch (error) {
      sensors.stop();
      camera.stop();
      this.home(error instanceof Error ? error.message : String(error));
      return;
    }
    this.sensors = sensors;
    this.camera = camera;
    const fovParam = Number(params.get("fov"));
    const fovGiven = Number.isFinite(fovParam) && fovParam >= 20 && fovParam <= 120;
    const fov = fovGiven ? fovParam : ASSUMED_FOV_LONG_DEG;
    const hud = h("div", { class: "hud" });
    const level = h("div", { class: "level" });
    const shoot = h("button", { class: "shutter", "aria-label": "Take the photo" });
    const back = h("button", { class: "ghost on-dark", onclick: () => this.home() }, "Back");
    const opened = performance.now();
    const update = () => {
      const o = sensors.cameraOrientation();
      const p = sensors.latestPosition();
      const parts: string[] = [];
      if (o) {
        parts.push(`${o.hasCompass ? `${Math.round(o.headingDeg)}° ${compassWord(o.headingDeg)}` : "no compass"}`);
        parts.push(`tilt ${fmt(o.pitchDeg, 0)}°`);
        level.style.transform = `rotate(${-o.rollDeg}deg) translateY(${o.pitchDeg * 4}px)`;
      } else if (sensors.motionDenied || performance.now() - opened > 3000) {
        parts.push("no motion sensors: tilt comes from the photo");
      } else parts.push("waiting for motion sensors");
      parts.push(p ? `GPS ±${Math.round(p.accuracyM)} m` : sensors.positionError ?? "waiting for GPS");
      if (screenAngle() !== 0) parts.push("hold the phone upright");
      hud.textContent = parts.join("  ·  ");
      shoot.toggleAttribute("disabled", !p);
    };
    sensors.onChange = update;
    this.hudTimer = window.setInterval(update, 400);
    shoot.addEventListener("click", () => {
      const o = sensors.cameraOrientation();
      const p = sensors.latestPosition();
      if (!p) return;
      window.clearInterval(this.hudTimer);
      let photo: HTMLCanvasElement;
      try {
        photo = camera.grab();
      } catch (error) {
        this.home(error instanceof Error ? error.message : String(error));
        return;
      }
      // Without motion data: tilt from the building's edges, building picked on the map.
      const capture: CaptureMeta = {
        lat: p.lat,
        lon: p.lon,
        accuracyM: p.accuracyM,
        headingDeg: o ? o.headingDeg : 0,
        headingAccuracyDeg: o?.hasCompass ? o.headingAccuracyDeg : 180,
        headingSource: o?.hasCompass ? "compass" : "manual",
        pitchDeg: o ? o.pitchDeg : 0,
        rollDeg: o ? o.rollDeg : 0,
        tiltSource: o ? "gravity sensor" : "photo verticals",
        fovLongDeg: fov,
        fovSource: fovGiven ? "preset" : "assumption",
        takenAt: new Date().toISOString(),
        raw: o ? { ...o.raw, screenAngle: screenAngle() } : { screenAngle: screenAngle() },
      };
      this.stopLive();
      if (this.mode === "street") void this.streetFor({ lat: capture.lat, lon: capture.lon, headingDeg: capture.headingDeg }, photo, capture);
      else void this.withFootprints(photo, capture, "Live capture");
    });
    this.screen(h("main", { class: "camera" }, camera.video, level, hud, h("div", { class: "camera-bar" }, back, shoot)));
    update();
  }

  // ----- Upload -----

  private async fromUpload(file: File): Promise<void> {
    try {
      const exif = readExif(await file.arrayBuffer());
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      const photo = h("canvas");
      photo.width = Math.round(bitmap.width * scale);
      photo.height = Math.round(bitmap.height * scale);
      photo.getContext("2d")!.drawImage(bitmap, 0, 0, photo.width, photo.height);
      const fov = exif.focal35mm ? longSideFovDeg(intrinsicsFrom35mm(photo.width, photo.height, exif.focal35mm)) : ASSUMED_FOV_LONG_DEG;
      this.uploadForm(photo, exif.lat, exif.lon, exif.headingDeg, exif.accuracyM, fov, exif.focal35mm !== undefined, exif.takenAt);
    } catch (error) {
      this.home(`Could not read that photo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private uploadForm(
    photo: HTMLCanvasElement,
    lat: number | undefined,
    lon: number | undefined,
    heading: number | undefined,
    accuracy: number | undefined,
    fov: number,
    fovFromExif: boolean,
    takenAt: string | undefined,
  ): void {
    const field = (label: string, value: number | undefined, step: string) => {
      const input = h("input", { type: "number", step, inputmode: "decimal", value: value !== undefined ? String(value) : "" });
      return { input, el: h("label", {}, label, input) };
    };
    const fLat = field("Latitude", lat, "0.000001");
    const fLon = field("Longitude", lon, "0.000001");
    const fHead = field("Camera heading (° from north)", heading !== undefined ? Math.round(heading * 10) / 10 : undefined, "0.1");
    const note = h("p", { class: "muted small", text: lat !== undefined ? "Filled in from the photo's location data." : "This photo has no location; enter where it was taken." });
    const useHere = h("button", {
      class: "ghost",
      onclick: () =>
        navigator.geolocation.getCurrentPosition(
          (p) => {
            fLat.input.value = p.coords.latitude.toFixed(6);
            fLon.input.value = p.coords.longitude.toFixed(6);
          },
          (e) => (note.textContent = e.message),
          { enableHighAccuracy: true },
        ),
    }, "Use my current location");
    const go = h("button", { class: "primary" }, this.mode === "street" ? "Find the street" : "Find the building");
    go.addEventListener("click", () => {
      const la = Number(fLat.input.value);
      const lo = Number(fLon.input.value);
      const he = Number(fHead.input.value);
      if (!fLat.input.value || !fLon.input.value || !Number.isFinite(la) || !Number.isFinite(lo)) {
        note.textContent = "Latitude and longitude are needed.";
        return;
      }
      const capture: CaptureMeta = {
        lat: la,
        lon: lo,
        accuracyM: accuracy ?? 30,
        headingDeg: Number.isFinite(he) && fHead.input.value ? ((he % 360) + 360) % 360 : 0,
        headingAccuracyDeg: fHead.input.value ? (heading !== undefined ? 15 : 30) : 180,
        headingSource: heading !== undefined ? "compass" : "manual",
        pitchDeg: 0,
        rollDeg: 0,
        tiltSource: "photo verticals",
        fovLongDeg: fov,
        fovSource: fovFromExif ? "EXIF" : "assumption",
        takenAt: takenAt ?? new Date().toISOString(),
      };
      if (this.mode === "street") void this.streetFor({ lat: capture.lat, lon: capture.lon, headingDeg: capture.headingDeg }, photo, capture);
      else void this.withFootprints(photo, capture, "Uploaded photo");
    });
    const preview = h("canvas", { class: "thumb" });
    preview.width = photo.width;
    preview.height = photo.height;
    preview.getContext("2d")!.drawImage(photo, 0, 0);
    this.screen(
      h("main", { class: "page" },
        h("h2", { text: "Where was it taken?" }),
        preview,
        note,
        h("div", { class: "form" }, fLat.el, fLon.el, useHere, fHead.el),
        this.mode === "building" ? h("p", { class: "muted small", text: "Pitch and roll are worked out later from the building's vertical edges." }) : null,
        h("div", { class: "row" }, h("button", { class: "ghost", onclick: () => this.home() }, "Back"), go),
      ),
    );
  }

  private async withFootprints(photo: HTMLCanvasElement, capture: CaptureMeta, label: string): Promise<void> {
    this.screen(h("main", { class: "page center" }, h("div", { class: "spinner" }), h("p", { text: "Looking up buildings around you (OpenStreetMap)…" })));
    try {
      const res = await fetch(`/api/footprints?lat=${capture.lat}&lon=${capture.lon}&radius=150`);
      const body = (await res.json().catch(() => ({}))) as FootprintSet | { error?: string };
      if (!res.ok || !isFootprintSet(body)) {
        throw new Error((body as { error?: string }).error ?? `Footprint lookup failed (${res.status}).`);
      }
      await this.load({ synthetic: false, label, photo, capture, footprints: body }, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.screen(
        h("main", { class: "page" },
          h("h2", { text: "No building data" }),
          h("p", { class: "error", text: message }),
          h("div", { class: "row" },
            h("button", { class: "ghost", onclick: () => this.home() }, "Home"),
            h("button", { class: "primary", onclick: () => void this.withFootprints(photo, capture, label) }, "Try again"),
          ),
        ),
      );
    }
  }

  // ----- Pick and mark -----

  private async load(input: SceneInput, autoplay: boolean): Promise<void> {
    this.input = input;
    this.located = prepare(input);
    this.plan = input.plan ?? null;
    this.selectedId = input.selectionId ?? this.located.candidates[0]?.id ?? null;
    this.marks = input.marks ?? null;
    this.marksPlaced = Boolean(input.marks);
    if (autoplay && this.selectedId && this.marks) {
      await this.build(true);
      return;
    }
    this.locateScreen();
  }

  private locateScreen(): void {
    const input = this.input!;
    const located = this.located!;
    if (located.footprints.length === 0) {
      this.screen(h("main", { class: "page" }, h("h2", { text: "No buildings nearby" }), h("p", { text: "OpenStreetMap has no building footprints within 150 m of this spot." }), h("button", { class: "primary", onclick: () => this.home() }, "Home")));
      return;
    }
    const holder = h("div", { class: "topview-holder" });
    const info = h("p", { class: "muted" });
    const draw = () => {
      const best = located.candidates[0]?.id === this.selectedId;
      const saved = Boolean(input.selectionId) && input.selectionId === this.selectedId;
      info.textContent = !this.selectedId
        ? "Tap the building you photographed."
        : saved
          ? "The orange building is the one saved with this capture. Tap another footprint to change it."
          : best
            ? "The orange building is the best match for where the camera pointed. Tap another footprint if it is not the one."
            : "Using the building you tapped.";
      holder.replaceChildren(
        topView({
          footprints: located.footprints,
          candidates: located.candidates,
          selectedId: this.selectedId,
          camera: {
            x: 0,
            y: 0,
            headingDeg: input.capture.headingDeg,
            fovDeg: horizontalFovDeg(located.intrinsics),
            accuracyM: input.capture.accuracyM,
            headingKnown: (input.capture.headingAccuracyDeg ?? 0) < 90,
          },
          onSelect: (id) => {
            if (id !== this.selectedId) {
              this.marks = null;
              this.marksPlaced = false;
            }
            this.selectedId = id;
            draw();
          },
        }),
      );
    };
    draw();
    this.screen(
      h("main", { class: "page" },
        input.synthetic ? h("p", { class: "badge", text: "SYNTHETIC SCENE" }) : null,
        h("h2", { text: "Which building?" }),
        holder,
        info,
        h("p", { class: "muted small", text: `${input.footprints.source} · ${input.footprints.attribution} · GPS ±${Math.round(input.capture.accuracyM)} m (σ ${fmt(gpsSigmaM(input.capture.accuracyM))} m)` }),
        h("div", { class: "row" },
          h("button", { class: "ghost", onclick: () => this.home() }, "Home"),
          h("button", { class: "primary", onclick: () => this.selectedId && this.markScreen() }, "Next: mark it"),
        ),
      ),
    );
  }

  private markScreen(): void {
    const input = this.input!;
    const located = this.located!;
    const target = located.footprints.find((f) => f.id === this.selectedId);
    if (!target) return this.locateScreen();
    const marks = this.marks ?? predictMarks(target, located.priorPose);
    const marker = new Marker(input.photo, marks);
    marker.onChange = (m) => {
      this.marks = m;
      if (marker.outerPlaced) this.marksPlaced = true;
    };
    this.marks = marker.value;
    const hidden = h("input", { type: "checkbox", checked: marks.groundHidden });
    hidden.addEventListener("change", () => marker.setGroundHidden(hidden.checked));
    const near = h("input", { type: "checkbox", checked: Boolean(marks.nearCorner) });
    near.addEventListener("change", () => marker.setNearCorner(near.checked));
    const error = h("p", { class: "error" });
    this.screen(
      h("main", { class: "page" },
        input.synthetic ? h("p", { class: "badge", text: "SYNTHETIC SCENE" }) : null,
        h("h2", { text: "Mark the building" }),
        h("p", { class: "muted", text: "Drag the dots to the outermost left and right edges of the building: where each edge meets the roof line, and where it meets the ground." }),
        marker.el,
        h("label", { class: "check" }, hidden, "The foot of the walls is hidden (cars, trees)"),
        h("label", { class: "check" }, near, "Two sides show: also mark the top of the near corner"),
        error,
        h("div", { class: "row" },
          h("button", { class: "ghost", onclick: () => this.locateScreen() }, "Back"),
          h("button", {
            class: "primary",
            onclick: () => {
              // The starting dots are only the sensors' guess; measuring them would just echo it.
              if (!this.marksPlaced) {
                error.textContent = `Drag each of the four dots onto the building's edges first (${marker.outerPlacedCount} of 4 placed).`;
                return;
              }
              void this.build(false).catch((e) => (error.textContent = String(e instanceof Error ? e.message : e)));
            },
          }, "Build 3D"),
        ),
      ),
    );
    requestAnimationFrame(() => marker.refresh());
  }

  // ----- Build and play -----

  private async build(autoplay: boolean): Promise<void> {
    const input = this.input!;
    const located = this.located!;
    const marks = this.marks!;
    if (input.capture.tiltSource === "photo verticals") {
      const tilt = tiltFromVerticals(marks, located.intrinsics);
      if (!tilt) throw new Error("Mark the left and right edges a little longer to read the camera tilt.");
      input.capture = { ...input.capture, pitchDeg: tilt.pitchDeg, rollDeg: tilt.rollDeg };
    }
    const spec = specFor(input, located, this.selectedId!, marks);
    this.screen(h("main", { class: "page center" }, h("div", { class: "spinner" }), h("p", { text: this.plan ? "Building the scene…" : "Designing the what if…" })));
    let note = "Plan saved with the preset";
    let plan = this.plan;
    if (!plan) {
      const facts = designFacts(spec, facadeColor(input.photo, marks));
      const outcome = await designPlan(facts, photoForModel(input.photo));
      plan = outcome.plan;
      note = outcome.note;
    }
    if (plan.facade.windowBoxes && !spec.synthetic) note += " · window boxes left out: the photo does not give the window positions yet";
    this.plan = plan;
    this.spec = spec;
    const size = params.get("size") === "1080" ? [1080, 1920] : [720, 1280];
    if (!this.player || this.player.width !== size[0]) {
      this.player?.dispose();
      this.player = new Player(size[0], size[1]);
    }
    this.player.load({ spec, plan, layout: layoutFor(spec, plan), photo: input.photo });
    // Handle for the browser tests on the dev server.
    if (import.meta.env.DEV) Object.assign(window, { __whatif: { player: this.player, spec, truth: input.truth } });
    this.resultScreen(note);
    if (autoplay) this.player.play(0);
  }

  private resultScreen(planNote: string): void {
    const input = this.input!;
    const spec = this.spec!;
    const plan = this.plan!;
    const player = this.player!;
    const scrub = h("input", { type: "range", min: "0", max: String(player.duration), step: "0.05", value: "0", class: "scrub" });
    scrub.addEventListener("input", () => {
      player.pause();
      player.renderAt(Number(scrub.value));
    });
    player.onTime = (t) => (scrub.value = String(t));
    const out = h("div", { class: "downloads" });
    const record = h("button", {}, "Record video");
    record.toggleAttribute("disabled", !pickRecordingType());
    record.addEventListener("click", async () => {
      record.setAttribute("disabled", "");
      const label = record.textContent;
      try {
        const { blob, mimeType } = await player.record((s) => (record.textContent = `Recording ${Math.round(s * 100)}%`));
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const name = `whatif-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
        const url = URL.createObjectURL(blob);
        out.replaceChildren(h("a", { href: url, download: name, class: "button primary" }, `Download ${ext.toUpperCase()} (${(blob.size / 1e6).toFixed(1)} MB)`));
        const file = new File([blob], name, { type: mimeType });
        if (navigator.canShare?.({ files: [file] })) {
          out.append(h("button", { onclick: () => void navigator.share({ files: [file], title: "What if?" }).catch(() => undefined) }, "Share"));
        }
      } catch (error) {
        out.replaceChildren(h("p", { class: "error", text: error instanceof Error ? error.message : String(error) }));
      } finally {
        record.textContent = label;
        record.removeAttribute("disabled");
      }
    });
    const save = h("button", {
      class: "ghost",
      onclick: () =>
        downloadJson(`whatif-preset-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`, presetFrom(input, { selectionId: this.selectedId!, marks: this.marks!, plan })),
    }, "Save preset");
    this.screen(
      h("main", { class: "result" },
        h("div", { class: "stage" }, player.canvas),
        scrub,
        h("div", { class: "row wrap" },
          h("button", { class: "primary", onclick: () => player.play(player.currentTime >= player.duration - 0.05 ? 0 : player.currentTime) }, "Play"),
          record,
          save,
          h("button", { class: "ghost", onclick: () => this.markScreen() }, "Adjust marks"),
          h("button", { class: "ghost", onclick: () => this.home() }, "New"),
        ),
        out,
        factsPanel(input, spec, plan, planNote),
      ),
    );
  }
}
