/**
 * SAM 3.1's signs on the photo Muse Spark Open reads: the most certain few,
 * numbered from left to right in yellow boxes, so the model can say which
 * sign it read a name on; and each read sign cut out of the photo along
 * SAM's outline, for the place's card. A box only points at a sign: the
 * name still comes from the model's reading and the map's list, and every
 * word on screen is the app's.
 */
import { MAX_SIGN_BOXES } from "./spotted.js";

export type SamSignBox = { x1: number; y1: number; x2: number; y2: number; confidence?: number; path: string; ox: number; oy: number };

/** A sign as the photo shows it: its number on the photo, then SAM's box (edges exclusive) and outline. */
export type SignBox = SamSignBox & { n: number };

export type SamSigns = { width: number; height: number; signs: SamSignBox[] };

const BOX_COLOR = "#ffe600";
const EDGE_COLOR = "rgba(0, 0, 0, 0.9)";

function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** The /api/sam reply, checked: the picture's size, and boxes that lie inside it; a sign without a usable outline keeps its box. */
export function readSamReply(raw: unknown): SamSigns | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.width) || !finite(r.height) || r.width < 1 || r.height < 1 || !Array.isArray(r.signs)) return null;
  const width = r.width;
  const height = r.height;
  const signs: SamSignBox[] = [];
  for (const item of r.signs) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    if (![s.x1, s.y1, s.x2, s.y2].every(finite)) continue;
    const [x1, y1, x2, y2] = [s.x1, s.y1, s.x2, s.y2] as number[];
    if (x1 < 0 || y1 < 0 || x2 > width || y2 > height || x2 - x1 < 2 || y2 - y1 < 2) continue;
    signs.push({
      x1,
      y1,
      x2,
      y2,
      confidence: finite(s.confidence) ? s.confidence : undefined,
      path: typeof s.path === "string" ? s.path : "",
      ox: finite(s.ox) ? s.ox : x1,
      oy: finite(s.oy) ? s.oy : y1,
    });
  }
  return { width, height, signs };
}

/** The most certain signs, at most `max`, numbered 1, 2, … from left to right (then top to bottom), the way a reader scans. */
export function numberSigns(signs: SamSignBox[], max = MAX_SIGN_BOXES): SignBox[] {
  return [...signs]
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, max)
    .sort((a, b) => a.x1 + a.x2 - (b.x1 + b.x2) || a.y1 - b.y1)
    .map((s, i) => ({ ...s, n: i + 1 }));
}

/** The number's size on a photo of this height: small enough not to cover a neighbouring sign. */
export function badgeFont(height: number): number {
  return Math.max(12, Math.min(22, Math.round(height * 0.016)));
}

/** Where a box's number goes: on its top-left corner just above it, or inside the box when it touches the top of the photo. */
export function badgeAt(box: { x1: number; y1: number }, badge: { w: number; h: number }): { x: number; y: number } {
  const above = box.y1 - 2 - badge.h;
  return { x: Math.max(0, box.x1 - 2), y: above >= 0 ? above : box.y1 };
}

/** A copy of the photo with the numbered boxes drawn on it, for the model only. */
export function drawSignBoxes(photo: HTMLCanvasElement, boxes: SignBox[]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = photo.width;
  c.height = photo.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(photo, 0, 0);
  const font = badgeFont(photo.height);
  ctx.font = `700 ${font}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  for (const box of boxes) {
    const x = box.x1 - 2;
    const y = box.y1 - 2;
    const w = box.x2 - box.x1 + 4;
    const h = box.y2 - box.y1 + 4;
    ctx.lineWidth = 4;
    ctx.strokeStyle = EDGE_COLOR;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = BOX_COLOR;
    ctx.strokeRect(x, y, w, h);
    const label = String(box.n);
    const badge = { w: Math.ceil(ctx.measureText(label).width) + 8, h: font + 4 };
    const at = badgeAt(box, badge);
    ctx.fillStyle = EDGE_COLOR;
    ctx.fillRect(at.x, at.y, badge.w, badge.h);
    ctx.fillStyle = BOX_COLOR;
    ctx.fillText(label, at.x + 4, at.y + 2);
  }
  return c;
}

/**
 * The sign cut out of the photo along SAM's outline, with a little room
 * around it; a plain crop when the outline does not draw. The box and the
 * outline are in the model picture's pixels; `scale` is how much larger
 * `photo` is, so the cut-out can come from the full photo.
 */
export function cutSign(photo: HTMLCanvasElement, box: SamSignBox, scale = 1, pad = 6): HTMLCanvasElement {
  const x = Math.max(0, Math.floor((box.x1 - pad) * scale));
  const y = Math.max(0, Math.floor((box.y1 - pad) * scale));
  const w = Math.min(photo.width, Math.ceil((box.x2 + pad) * scale)) - x;
  const h = Math.min(photo.height, Math.ceil((box.y2 + pad) * scale)) - y;
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext("2d")!;
  let outlined = false;
  if (box.path && typeof Path2D === "function") {
    try {
      const outline = new Path2D(box.path);
      ctx.save();
      ctx.translate(box.ox * scale - x, box.oy * scale - y);
      ctx.scale(scale, scale);
      ctx.clip(outline);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(photo, x, y, w, h, 0, 0, w, h);
      ctx.restore();
      outlined = true;
    } catch {
      ctx.restore();
    }
  }
  if (!outlined) ctx.drawImage(photo, x, y, w, h, 0, 0, w, h);
  return c;
}
