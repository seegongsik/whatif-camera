/**
 * Marking the building on the photo: drag four dots to the outer left and
 * right edges at the roof line and at the ground, and optionally a fifth to
 * the top of the near corner. A loupe shows the spot under the finger.
 */
import type { CornerMarks, Pixel } from "../estimate/register.js";
import { h, svg } from "./dom.js";

type Key = "roofLeft" | "roofRight" | "groundLeft" | "groundRight" | "nearCorner";

const LABELS: Record<Key, string> = {
  roofLeft: "roof · left",
  roofRight: "roof · right",
  groundLeft: "ground · left",
  groundRight: "ground · right",
  nearCorner: "near corner",
};

export class Marker {
  readonly el: HTMLElement;
  private marks: CornerMarks;
  private readonly overlay: SVGSVGElement;
  private readonly loupe: HTMLCanvasElement;
  private readonly photo: HTMLCanvasElement;
  private dragging: Key | null = null;
  /** Handles the person has moved at least once. */
  readonly moved = new Set<Key>();
  onChange: ((marks: CornerMarks) => void) | null = null;

  constructor(photo: HTMLCanvasElement, marks: CornerMarks) {
    this.photo = photo;
    this.marks = structuredClone(marks);
    const view = h("canvas", { class: "marker-photo" });
    view.width = photo.width;
    view.height = photo.height;
    view.getContext("2d")!.drawImage(photo, 0, 0);
    this.overlay = svg("svg", { viewBox: `0 0 ${photo.width} ${photo.height}`, class: "marker-overlay", preserveAspectRatio: "none" });
    this.loupe = h("canvas", { class: "loupe" });
    this.loupe.width = 180;
    this.loupe.height = 180;
    this.el = h("div", { class: "marker" }, view, this.overlay, this.loupe);
    this.overlay.addEventListener("pointerdown", (e) => this.down(e));
    this.overlay.addEventListener("pointermove", (e) => this.move(e));
    this.overlay.addEventListener("pointerup", () => this.up());
    this.overlay.addEventListener("pointercancel", () => this.up());
    this.draw();
  }

  get value(): CornerMarks {
    return structuredClone(this.marks);
  }

  setGroundHidden(hidden: boolean): void {
    this.marks.groundHidden = hidden;
    this.draw();
    this.onChange?.(this.value);
  }

  setNearCorner(enabled: boolean): void {
    if (enabled && !this.marks.nearCorner) {
      const m = this.marks;
      this.marks.nearCorner = { u: (m.roofLeft.u + m.roofRight.u) / 2, v: Math.max(m.roofLeft.v, m.roofRight.v) - 0.02 * this.photo.height };
    } else if (!enabled) delete this.marks.nearCorner;
    this.draw();
    this.onChange?.(this.value);
  }

  private toPhoto(e: PointerEvent): Pixel {
    const box = this.overlay.getBoundingClientRect();
    return {
      u: Math.min(this.photo.width, Math.max(0, ((e.clientX - box.left) / box.width) * this.photo.width)),
      v: Math.min(this.photo.height, Math.max(0, ((e.clientY - box.top) / box.height) * this.photo.height)),
    };
  }

  private scale(): number {
    const box = this.overlay.getBoundingClientRect();
    return box.width > 0 ? this.photo.width / box.width : 1;
  }

  private down(e: PointerEvent): void {
    const p = this.toPhoto(e);
    const reach = 34 * this.scale();
    let best: Key | null = null;
    let bestD = reach;
    for (const key of Object.keys(LABELS) as Key[]) {
      const q = this.marks[key] as Pixel | undefined;
      if (!q) continue;
      const d = Math.hypot(q.u - p.u, q.v - p.v);
      if (d < bestD) {
        bestD = d;
        best = key;
      }
    }
    if (!best) return;
    e.preventDefault();
    this.overlay.setPointerCapture(e.pointerId);
    this.dragging = best;
    this.moved.add(best);
    this.move(e);
  }

  private move(e: PointerEvent): void {
    if (!this.dragging) return;
    const p = this.toPhoto(e);
    (this.marks[this.dragging] as Pixel) = p;
    this.draw();
    this.showLoupe(p, e);
  }

  private up(): void {
    if (!this.dragging) return;
    this.dragging = null;
    this.loupe.style.display = "none";
    this.onChange?.(this.value);
  }

  private showLoupe(p: Pixel, e: PointerEvent): void {
    const ctx = this.loupe.getContext("2d")!;
    const zoom = 3;
    const size = this.loupe.width;
    const src = size / zoom;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(this.photo, p.u - src / 2, p.v - src / 2, src, src, 0, 0, size, size);
    ctx.strokeStyle = "#ff6a2b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
    const box = this.el.getBoundingClientRect();
    this.loupe.style.display = "block";
    this.loupe.style.left = `${Math.min(box.width - 96, Math.max(-6, e.clientX - box.left - 90))}px`;
    this.loupe.style.top = `${Math.max(-6, e.clientY - box.top - 220)}px`;
  }

  private draw(): void {
    const s = this.scale();
    const m = this.marks;
    this.overlay.replaceChildren();
    const line = (a: Pixel, b: Pixel, cls: string) =>
      this.overlay.append(svg("line", { x1: a.u, y1: a.v, x2: b.u, y2: b.v, class: cls, "stroke-width": 3 * s }));
    if (m.nearCorner) {
      line(m.roofLeft, m.nearCorner, "mk-line mk-roof");
      line(m.nearCorner, m.roofRight, "mk-line mk-roof");
    } else line(m.roofLeft, m.roofRight, "mk-line mk-roof");
    line(m.groundLeft, m.groundRight, m.groundHidden ? "mk-line mk-ground mk-hidden" : "mk-line mk-ground");
    line(m.roofLeft, m.groundLeft, "mk-line mk-edge");
    line(m.roofRight, m.groundRight, "mk-line mk-edge");
    if (m.nearCorner) {
      const foot = { u: m.nearCorner.u, v: Math.max(m.groundLeft.v, m.groundRight.v) };
      line(m.nearCorner, foot, "mk-line mk-near");
    }
    for (const key of Object.keys(LABELS) as Key[]) {
      const p = m[key] as Pixel | undefined;
      if (!p) continue;
      const g = svg("g", { class: `mk-handle mk-${key}` });
      g.append(svg("circle", { cx: p.u, cy: p.v, r: 14 * s, class: "mk-ring", "stroke-width": 3 * s }));
      g.append(svg("circle", { cx: p.u, cy: p.v, r: 3 * s, class: "mk-dot" }));
      const t = svg("text", { x: p.u + 18 * s, y: p.v - 14 * s, class: "mk-label", "font-size": 15 * s, "stroke-width": 4 * s });
      t.textContent = LABELS[key];
      g.append(t);
      this.overlay.append(g);
    }
  }

  /** How many of the four outer marks have been placed by hand. */
  get outerPlacedCount(): number {
    return (["roofLeft", "roofRight", "groundLeft", "groundRight"] as Key[]).filter((k) => this.moved.has(k)).length;
  }

  get outerPlaced(): boolean {
    return this.outerPlacedCount === 4;
  }

  /** Re-draws after the element gets its size on screen. */
  refresh(): void {
    this.draw();
  }
}
