/**
 * The page: home → camera (or a photo, a demo street on the map, the
 * synthetic street) → the street view.
 */
import { LiveCamera } from "../capture/camera.js";
import { readExif } from "../capture/exif.js";
import { APPROXIMATE_FIX_M, approximateHelp, askingHelp, cameraHelp, inAppBrowser, LOCATION_WAIT_MS, locationHelp, waitingHelp } from "../capture/help.js";
import { Sensors, screenAngle } from "../capture/sensors.js";
import type { CaptureMeta } from "../capture/types.js";
import { compassWord } from "../geo/enu.js";
import { FAMOUS_STREETS, nearestStreet, orderForZone } from "../street/famous.js";
import { addFieldShot, clearFieldLog, fieldLogText, fieldShot, readFieldLog, type FieldShot } from "../street/field-log.js";
import type { StreetAhead } from "../street/street.js";
import { syntheticStreet } from "../street/synthetic.js";
import { readSaved, savePicks, saveStreet, type SavedStreet } from "../street/saved.js";
import { StreetShow, type StreetShowOptions } from "../street/show.js";
import { h, fmt } from "./dom.js";

const params = new URLSearchParams(location.search);

/** The eight directions to pick from when the phone has no compass, as they sit around you on a map. */
const DIRECTIONS: ([string, number] | null)[] = [
  ["NW", 315], ["N", 0], ["NE", 45],
  ["W", 270], null, ["E", 90],
  ["SW", 225], ["S", 180], ["SE", 135],
];

export class App {
  private readonly root: HTMLElement;
  private sensors: Sensors | null = null;
  private camera: LiveCamera | null = null;
  private hudTimer = 0;
  private streetShow: StreetShow | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    // Drawn on black throughout: home, photo form and show.
    document.body.classList.add("street-mode");
  }

  async start(): Promise<void> {
    try {
      if (params.get("demo") === "street") {
        this.showStreet(syntheticStreet());
        return;
      }
      // The last street from a photo, after the browser reloaded the page (a tap out to a place's Instagram and back).
      const saved = params.get("resume") === "1" ? readSaved() : null;
      if (saved) {
        this.resumeStreet(saved);
        return;
      }
      const at = params.get("street")?.split(",");
      const nums = at?.slice(0, 3).map(Number);
      if (at && nums && nums.length === 3 && nums.every(Number.isFinite)) {
        await this.streetFor({ lat: nums[0], lon: nums[1], headingDeg: nums[2], street: at.slice(3).join(",").trim() || undefined });
        return;
      }
      // A demo street by its id (?street=fifth-avenue), as the README links them.
      const demo = FAMOUS_STREETS.find((s) => s.id === params.get("street"));
      if (demo) {
        await this.streetFor(demo);
        return;
      }
    } catch (error) {
      this.home(error instanceof Error ? error.message : String(error));
      return;
    }
    this.home();
  }

  private screen(...children: (Node | null | false)[]): void {
    this.streetShow?.dispose();
    this.streetShow = null;
    this.root.replaceChildren(...children.filter((c): c is Node => Boolean(c)));
    window.scrollTo(0, 0);
  }

  private home(error?: string): void {
    this.stopLive();
    resumable(false);
    this.streetHome(error);
  }

  private streetHome(error?: string): void {
    const streets = orderForZone(FAMOUS_STREETS, timeZone());
    const saved = readSaved();
    // On a laptop the camera is a dead end (no GPS fix, no compass, a lens facing you): a demo street is the way in there.
    const phone = phoneLike();
    const photoInput = h("input", { type: "file", accept: "image/jpeg,image/*", class: "hidden" });
    photoInput.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (file) void this.fromUpload(file);
    });
    this.screen(
      h(
        "main",
        { class: "home landing" },
        h("div", { class: "home-kicker", text: "ONE PHOTO · THE NEXT 5 KM" }),
        h("h1", {}, "What's Ahead", h("span", { class: "accent", text: "?" })),
        heroClip(),
        // The way in right under the clip, inside the first screen; what it does follows.
        error ? h("p", { class: "error", text: error }) : null,
        this.inAppNote(),
        phone
          ? h("button", { class: "primary big", onclick: () => void this.openCamera() }, "Open camera")
          : h("button", { class: "primary big", onclick: () => void this.streetFor(streets[0]) }, `Fly down ${streets[0].short} ›`),
        // The last street from a photo stays until the next photo makes another.
        saved
          ? h(
              "button",
              { class: "big continue", onclick: () => this.resumeStreet(saved) },
              h("span", { text: `Continue on ${saved.street.name ?? "your last street"} ›` }),
              h("small", { text: `${savedWhen(saved.savedAt)} · ${saved.street.shops.length} places${saved.live ? " · your dot follows you" : ""}` }),
            )
          : null,
        h("p", {
          class: "lead",
          text: "Point your phone down a street and take one photo. A light runs 5 km ahead, dots every place the map knows on its side of the street, and stops at the landmarks Muse Spark knows by name.",
        }),
        phone ? null : h("p", { class: "muted small", text: "The camera is for a phone on a street: open this page on your phone there. On this screen, fly down a demo street." }),
        h("div", { class: "row" }, phone ? null : h("button", { onclick: () => void this.openCamera() }, "Open camera"), h("button", { onclick: () => photoInput.click() }, "Use a photo")),
        h("p", { class: "muted small", text: PHOTO_NOTE }),
        h("div", { class: "home-section" }, h("span", { text: "DEMO STREETS" }), h("span", { class: "home-section-note", text: "from the map, no photo" })),
        h(
          "ol",
          { class: "demo-streets" },
          ...streets.map((s, i) =>
            h(
              "li",
              {},
              h(
                "button",
                { "aria-label": s.label, title: s.label, onclick: () => void this.streetFor(s) },
                h("span", { class: "demo-n", text: String(i + 1).padStart(2, "0") }),
                h("span", { class: "demo-name", text: s.name }),
                h("span", { class: "demo-city", text: s.city }),
                h("span", { class: "demo-go", "aria-hidden": "true", text: "›" }),
              ),
            ),
          ),
        ),
        this.fieldLogBox(readFieldLog()),
        photoInput,
        h("p", { class: "muted small", text: "Streets © OpenStreetMap contributors (ODbL); places © Overture Maps Foundation (CDLA-Permissive-2.0). Places change; the map may be out of date." }),
        // The made-up street is for a try without a photo or a location, so it sits down here, not with the ways in.
        h("p", { class: "muted small" }, h("a", { href: "?demo=street" }, "Synthetic street"), ": an invented street with invented places, to try the show without a photo."),
      ),
    );
  }

  /** Opened inside a chat or social app, whose browser often refuses the camera, location and compass: how to get out. */
  private inAppNote(): HTMLElement | null {
    const inApp = inAppBrowser(navigator.userAgent, location.href);
    if (!inApp) return null;
    return h(
      "div",
      { class: "in-app" },
      h("strong", { text: `Opened inside ${inApp.app}` }),
      h("p", { text: `${inApp.app}'s built-in browser often blocks the camera, location and compass this page needs. Open it in Safari or Chrome.` }),
      inApp.open
        ? h("a", { class: "button primary", href: inApp.open }, "Open in the phone's browser")
        : h("p", { class: "muted small", text: `In ${inApp.app}: the ⋯ menu → Open in Safari (or in another browser).` }),
    );
  }

  /** `live`: the photo came from the camera just now, so walking the street follows the phone. */
  private async streetFor(at: { lat: number; lon: number; headingDeg: number; street?: string; name?: string; id?: string }, photo?: HTMLCanvasElement, capture?: CaptureMeta, live = false): Promise<void> {
    // A street from a photo is kept (until the next photo), with Muse Spark's picks once they are in.
    let kept: StreetAhead | null = null;
    // The show starts at once: its radar runs while the street is looked up.
    const show = this.openShow(at, photo, capture, () => void this.streetFor(at, photo, capture, live), {
      live,
      // No camera behind a street from the map alone: a SIMULATED walk shows what walking it does.
      simulate: !photo,
      onPicks: (picks) => kept && savePicks(kept, picks),
      onNewStreet: () => void this.openCamera(),
      // A demo street goes by the name the world knows it by, and its picks come from the CDN.
      title: photo ? undefined : at.name,
      demo: photo ? undefined : at.id,
    });
    const asked = performance.now();
    // Shots from the phone go in the field log, to look into later.
    const log = (outcome: StreetAhead | string) => capture && addFieldShot(fieldShot(capture, (performance.now() - asked) / 1000, outcome));
    try {
      const query = new URLSearchParams({ lat: String(at.lat), lon: String(at.lon), heading: String(at.headingDeg) });
      if (at.street) query.set("street", at.street);
      const res = await fetch(`/api/street?${query}`);
      const body = (await res.json().catch(() => ({}))) as Partial<StreetAhead> & { error?: string };
      if (!res.ok || !body.route) throw new Error(body.error ?? `The street lookup answered ${res.status}.`);
      show.load(body as StreetAhead);
      log(body as StreetAhead);
      if (photo && saveStreet({ street: body as StreetAhead, savedAt: capture?.takenAt ?? new Date().toISOString(), live })) {
        kept = body as StreetAhead;
        resumable(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      show.fail(message);
      log(message);
    }
  }

  /** The shots taken on this phone, to copy and send when a street came out wrong. */
  private fieldLogBox(shots: FieldShot[]): HTMLElement | null {
    if (shots.length === 0) return null;
    const text = fieldLogText(shots, `${location.origin}${location.pathname}`);
    const area = h("textarea", { class: "field-log-text", readonly: "", rows: 5, spellcheck: "false" });
    area.value = text;
    const copy = h("button", {}, "Copy");
    copy.addEventListener("click", () => {
      const select = () => {
        area.focus();
        area.select();
      };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => (copy.textContent = "Copied"), select);
      else select();
    });
    const clear = h("button", { class: "ghost" }, "Clear");
    clear.addEventListener("click", () => {
      clearFieldLog();
      this.home();
    });
    return h(
      "details",
      { class: "field-log" },
      h("summary", { text: `Field log · ${shots.length} shot${shots.length === 1 ? "" : "s"} on this phone` }),
      h("p", { class: "muted small", text: "Where each photo was taken, where the phone faced and the street it found. It stays on this phone until you copy it." }),
      area,
      h("div", { class: "row" }, copy, clear),
    );
  }

  /** No compass: the person says which way they faced, to the nearest of eight directions. */
  private pickDirection(photo: HTMLCanvasElement, capture: CaptureMeta): void {
    const go = (headingDeg: number) => {
      const picked: CaptureMeta = { ...capture, headingDeg, headingAccuracyDeg: 22.5, headingSource: "manual" };
      void this.streetFor({ lat: picked.lat, lon: picked.lon, headingDeg }, photo, picked, true);
    };
    const preview = h("canvas", { class: "thumb direction-photo" });
    preview.width = photo.width;
    preview.height = photo.height;
    preview.getContext("2d")!.drawImage(photo, 0, 0);
    this.screen(
      h(
        "main",
        { class: "page" },
        h("h2", { text: "Which way were you facing?" }),
        h("p", { class: "muted small", text: "This phone gave no compass reading, so the direction comes from you: the nearest of the eight is close enough." }),
        preview,
        h(
          "div",
          { class: "direction-grid" },
          ...DIRECTIONS.map((d) => (d ? h("button", { onclick: () => go(d[1]) }, d[0]) : h("span", { class: "direction-you", text: "YOU" }))),
        ),
        h("div", { class: "row" }, h("button", { class: "ghost", onclick: () => this.home() }, "Back")),
      ),
    );
  }

  private showStreet(street: StreetAhead): void {
    this.openShow({ lat: street.origin.lat, lon: street.origin.lon, headingDeg: street.headingDeg }, undefined, undefined, undefined, { simulate: true }).load(street);
  }

  /** The last street from a photo, as it was: no lookup and no run, the whole street at once; walking follows the phone again when it came from the camera. */
  private resumeStreet(saved: SavedStreet): void {
    const street = saved.street;
    const show = this.openShow({ lat: street.origin.lat, lon: street.origin.lon, headingDeg: street.headingDeg }, undefined, undefined, undefined, {
      live: saved.live,
      resume: true,
      onPicks: (picks) => savePicks(street, picks),
      onNewStreet: () => void this.openCamera(),
    });
    show.load(street, saved.picks);
    resumable(true);
  }

  private openShow(
    at: { lat: number; lon: number; headingDeg: number },
    photo?: HTMLCanvasElement,
    capture?: CaptureMeta,
    onRetry?: () => void,
    more: Partial<StreetShowOptions> = {},
  ): StreetShow {
    // Where no street (or no place) is found, the nearest famous street is one tap away.
    const near = nearestStreet(FAMOUS_STREETS, at);
    const elsewhere = near ? { label: near.short, go: () => void this.streetFor(near) } : undefined;
    // ?sam=0 leaves SAM 3.1 out, to compare the sign check with and without it.
    const sam = params.get("sam") !== "0";
    const show = new StreetShow({ origin: { lat: at.lat, lon: at.lon }, headingDeg: at.headingDeg, photo, capture, onClose: () => this.home(), onRetry, elsewhere, sam, ...more });
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
    // The browser may ask now: say so, rather than leave a page that seems to do nothing.
    let cancelled = false;
    this.screen(
      h(
        "main",
        { class: "page center" },
        h("div", { class: "spinner" }),
        h("p", { text: "Opening the camera…" }),
        h("p", { class: "muted small", text: "If your browser asks for the camera and your location, choose Allow: the camera sees the street, the location says which street it is." }),
        h(
          "button",
          {
            class: "ghost",
            onclick: () => {
              cancelled = true;
              this.home();
            },
          },
          "Back",
        ),
      ),
    );
    try {
      await sensors.start();
      await camera.start();
    } catch (error) {
      sensors.stop();
      camera.stop();
      if (!cancelled) this.home(cameraHelp(error, navigator.userAgent));
      return;
    }
    if (cancelled) {
      sensors.stop();
      camera.stop();
      return;
    }
    this.sensors = sensors;
    this.camera = camera;
    // Whether the browser has still to ask for location: then the page says what to answer.
    let asking = false;
    void navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        asking = status.state === "prompt";
        status.onchange = () => (asking = status.state === "prompt");
      })
      .catch(() => undefined);
    const hud = h("div", { class: "hud" });
    // What to change when location is refused or only a rough area.
    const help = h("p", { class: "camera-help hidden" });
    // And a way on meanwhile, so a refusal is never a dead end: a demo street, or a photo with its own location.
    const demo = orderForZone(FAMOUS_STREETS, timeZone())[0];
    const photoInput = h("input", { type: "file", accept: "image/jpeg,image/*", class: "hidden" });
    photoInput.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      this.stopLive();
      void this.fromUpload(file);
    });
    const ways = h(
      "div",
      { class: "camera-ways hidden" },
      h(
        "button",
        {
          onclick: () => {
            this.stopLive();
            void this.streetFor(demo);
          },
        },
        `Fly down ${demo.short} ›`,
      ),
      h("button", { onclick: () => photoInput.click() }, "Use a photo"),
      photoInput,
    );
    const level = h("div", { class: "level" });
    const shoot = h("button", { class: "shutter", "aria-label": "Take the photo" });
    const back = h("button", { class: "ghost on-dark", onclick: () => this.home() }, "Back");
    const opened = performance.now();
    const update = () => {
      const o = sensors.cameraOrientation();
      const p = sensors.latestPosition();
      const parts: string[] = [];
      if (o) {
        parts.push(o.hasCompass ? `${Math.round(o.headingDeg)}° ${compassWord(o.headingDeg)}` : "no compass: you pick the direction after the photo");
        parts.push(`tilt ${fmt(o.pitchDeg, 0)}°`);
        level.style.transform = `rotate(${-o.rollDeg}deg) translateY(${o.pitchDeg * 4}px)`;
      } else if (sensors.motionDenied || performance.now() - opened > 3000) {
        parts.push("no motion sensors: you pick the direction after the photo");
      } else parts.push("waiting for motion sensors");
      // Past the street match's reach a fix may land on the next street over; past a kilometre it is only an area.
      parts.push(p ? `GPS ±${Math.round(p.accuracyM)} m${p.accuracyM > 35 ? " (rough)" : ""}` : sensors.positionErrorCode === 1 ? "location blocked" : sensors.positionError ?? "waiting for GPS");
      if (screenAngle() !== 0) parts.push("hold the phone upright");
      hud.textContent = parts.join("  ·  ");
      const area = p !== null && p.accuracyM > APPROXIMATE_FIX_M;
      const stuck = !p && (sensors.positionErrorCode !== null || performance.now() - opened > LOCATION_WAIT_MS);
      const advice =
        !p && sensors.positionErrorCode
          ? locationHelp(sensors.positionErrorCode, navigator.userAgent)
          : stuck
            ? waitingHelp(navigator.userAgent)
            : p && area
              ? approximateHelp(p.accuracyM, navigator.userAgent)
              : !p && asking
                ? askingHelp(navigator.userAgent)
                : "";
      if (help.textContent !== advice) help.textContent = advice;
      help.classList.toggle("hidden", !advice);
      ways.classList.toggle("hidden", !(stuck || area));
      shoot.toggleAttribute("disabled", !p || area);
    };
    sensors.onChange = update;
    this.hudTimer = window.setInterval(update, 400);
    shoot.addEventListener("click", () => {
      const o = sensors.cameraOrientation();
      const p = sensors.latestPosition();
      if (!p || p.accuracyM > APPROXIMATE_FIX_M) return;
      window.clearInterval(this.hudTimer);
      let photo: HTMLCanvasElement;
      try {
        photo = camera.grab();
      } catch (error) {
        this.home(error instanceof Error ? error.message : String(error));
        return;
      }
      // Without a compass the direction comes from the person, after the photo.
      const capture: CaptureMeta = {
        lat: p.lat,
        lon: p.lon,
        accuracyM: p.accuracyM,
        headingDeg: o ? o.headingDeg : 0,
        headingAccuracyDeg: o?.hasCompass ? o.headingAccuracyDeg : 180,
        headingSource: o?.hasCompass ? "compass" : "manual",
        pitchDeg: o ? o.pitchDeg : 0,
        rollDeg: o ? o.rollDeg : 0,
        takenAt: new Date().toISOString(),
        raw: o ? { ...o.raw, screenAngle: screenAngle() } : { screenAngle: screenAngle() },
      };
      this.stopLive();
      if (capture.headingSource === "manual") this.pickDirection(photo, capture);
      else void this.streetFor({ lat: capture.lat, lon: capture.lon, headingDeg: capture.headingDeg }, photo, capture, true);
    });
    const note = h("p", { class: "camera-note", text: PHOTO_NOTE });
    this.screen(h("main", { class: "camera" }, camera.video, level, h("div", { class: "camera-top" }, hud, help, ways), note, h("div", { class: "camera-bar" }, back, shoot)));
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
      this.uploadForm(photo, exif.lat, exif.lon, exif.headingDeg, exif.accuracyM, exif.takenAt);
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
          (e) => (note.textContent = locationHelp(e.code, navigator.userAgent)),
          { enableHighAccuracy: true, timeout: 20_000 },
        ),
    }, "Use my current location");
    const go = h("button", { class: "primary" }, "Find the street");
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
        takenAt: takenAt ?? new Date().toISOString(),
      };
      void this.streetFor({ lat: capture.lat, lon: capture.lon, headingDeg: capture.headingDeg }, photo, capture);
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
        h("div", { class: "row" }, h("button", { class: "ghost", onclick: () => this.home() }, "Back"), go),
      ),
    );
  }
}

/** A street from a photo is on screen: a reload comes back to it (?resume=1) rather than to the home page. */
function resumable(on: boolean): void {
  if (on === (new URLSearchParams(location.search).get("resume") === "1")) return;
  try {
    history.replaceState(null, "", on ? `${location.pathname}?resume=1` : location.pathname);
  } catch {
    // A sandboxed page: the reload goes home instead.
  }
}

/** When the kept street's photo was taken, in the phone's own words. */
function savedWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "Earlier";
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay ? `Today ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : at.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Where a street photo goes, said where the photo is taken and on the home page. */
const PHOTO_NOTE = "Your photo goes to Meta's SAM 3.1 and Muse Spark Open (on Baseten) to read the signs in it, and your position to this site's server to find the street. The app keeps neither.";

/** A phone or a tablet (a touch screen as the main pointer), rather than a laptop or a desktop. */
function phoneLike(): boolean {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** The device's time zone, which orders the starting points; nothing when the browser does not say. */
function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * The landing's moving picture: a recording of the app itself (the photo is
 * a drawn street; the street, its places and landmarks are real map data,
 * credited in the clip). It ends on a tap on a place and its Instagram link,
 * and a caption card with where that link goes. Still, on its poster, when
 * motion is reduced.
 */
function heroClip(): HTMLElement {
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const video = h("video", {
    class: "hero-clip",
    src: "/demo/whats-ahead-loop.mp4",
    poster: "/demo/whats-ahead-loop.jpg",
    "aria-label": "Recording of the app: a photo down 7th Avenue from Times Square, a light running the street and stopping at its landmarks, then a tap on a restaurant and on its Instagram link",
  });
  // Muted and inline, as attributes too, so phones let it play by itself.
  for (const name of ["muted", "playsinline", "loop"]) video.setAttribute(name, "");
  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  if (!still) {
    video.autoplay = true;
    void video.play().catch(() => undefined);
  }
  // The label sits above the picture, clear of the app's own title in it.
  return h(
    "figure",
    { class: "hero" },
    h("figcaption", { class: "hero-tag" }, h("span", {}, h("i"), "DEMO · FROM TIMES SQUARE, NEW YORK"), h("span", { class: "hero-tag-note", text: "real map data" })),
    h("div", { class: "hero-frame" }, video),
  );
}
