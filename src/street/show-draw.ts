/**
 * Drawing shared by the street show and its share card: colours, type, a
 * soft round light, and the name tags the light leaves at landmarks.
 */
import type { PlacedLabel } from "./street-labels.js";

export const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
export const SANS = '"Inter", system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif';

export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const sprites = new Map<string, HTMLCanvasElement>();

/** A soft round light in a colour (with a white core when `core`), drawn once and stamped. */
export function glow(color: string, core: boolean): HTMLCanvasElement {
  const key = `${color}${core ? ":core" : ""}`;
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (core) {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.16, color);
    grad.addColorStop(0.3, rgba(color, 0.45));
    grad.addColorStop(1, rgba(color, 0));
  } else {
    grad.addColorStop(0, rgba(color, 0.85));
    grad.addColorStop(0.35, rgba(color, 0.22));
    grad.addColorStop(1, rgba(color, 0));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}

export type TagStyle = { color: string; number?: number; end?: boolean };

/** Measures a tag's two lines: the name in bold, the detail in the monospace. */
export function tagMeasure(ctx: CanvasRenderingContext2D): (text: string, size: number, bold: boolean) => number {
  return (text, size, bold) => {
    ctx.font = bold ? `650 ${size}px ${SANS}` : `600 ${size}px ${MONO}`;
    return ctx.measureText(text).width;
  };
}

/**
 * A name tag beside the street: a leader line from the place, dark glass
 * with a rim in the place's colour, the name, and distance and kind below.
 * The colour mark and the text face the street, so a tag on the left
 * reads from its right edge. Laid out by layoutLabels with the same font,
 * so the padding (9 px at 13 px type) matches.
 */
export function drawTag(ctx: CanvasRenderingContext2D, label: PlacedLabel<TagStyle>): void {
  drawLeader(ctx, label);
  drawTagBody(ctx, label);
}

/** The thin line from the place to its tag. */
function drawLeader(ctx: CanvasRenderingContext2D, label: PlacedLabel<TagStyle>): void {
  const { box, item, font } = label;
  const inner = label.side === "left" ? box.x + box.w : box.x;
  ctx.strokeStyle = rgba(item.color, 0.65);
  ctx.lineWidth = font / 13;
  ctx.beginPath();
  ctx.moveTo(label.x, label.y);
  ctx.lineTo(inner, box.y + box.h / 2);
  ctx.stroke();
}

/** The tag itself: its box, the colour mark (or stop number) and its lines. */
function drawTagBody(ctx: CanvasRenderingContext2D, label: PlacedLabel<TagStyle>): void {
  const { box, item, font } = label;
  const scale = font / 13;
  const pad = 9 * scale;
  const left = label.side === "left";
  ctx.lineWidth = scale;
  ctx.fillStyle = "rgba(6,9,14,0.86)";
  ctx.strokeStyle = rgba(item.color, item.end ? 0.35 : 0.7);
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 6 * scale);
  ctx.fill();
  ctx.stroke();
  const mark = font * 0.7;
  // The colour mark (or the stop's number) sits on the side facing the street.
  const markX = left ? box.x + box.w - pad - mark : box.x + pad;
  if (item.number) {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(markX + mark / 2, box.y + box.h / 2, mark / 2 + scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = `800 ${Math.round(font * 0.72)}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(item.number), markX + mark / 2, box.y + box.h / 2 + 0.5 * scale);
  } else {
    ctx.fillStyle = item.color;
    ctx.fillRect(left ? markX + mark - 2.5 * scale : markX, box.y + 6 * scale, 2.5 * scale, box.h - 12 * scale);
  }
  const tx = left ? markX - 6 * scale : markX + mark + 6 * scale;
  const top = box.y + 5 * scale;
  ctx.textAlign = left ? "right" : "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `650 ${font}px ${SANS}`;
  label.lines.forEach((line, i) => ctx.fillText(line, tx, top + font * 0.98 + i * font * 1.2));
  ctx.fillStyle = item.end ? "rgba(255,255,255,0.6)" : item.color;
  ctx.font = `600 ${Math.round(font * 0.8)}px ${MONO}`;
  ctx.fillText(label.detail, tx, top + font * 1.2 * label.lines.length + font * 0.8);
  ctx.textAlign = "left";
}

/**
 * Tags drawn once and stamped after: text is the dearest thing on the
 * screen to draw, and a tag does not change while it stays up. Keyed by
 * what it shows, its size and the canvas's resolution; the oldest go first.
 */
const tagSprites = new Map<string, HTMLCanvasElement>();
const TAG_SPRITES_MAX = 200;
/** Room around the box for its border. */
const TAG_MARGIN = 2;

/** drawTag for a canvas redrawn every frame: the leader line as it is, the tag from its picture. `dpr`: the canvas's pixels per CSS pixel. */
export function drawTagStamped(ctx: CanvasRenderingContext2D, label: PlacedLabel<TagStyle>, dpr: number): void {
  drawLeader(ctx, label);
  const { box, item } = label;
  const key = [dpr, label.font, box.w, box.h, label.side, item.color, item.number ?? "", item.end ? 1 : 0, label.detail, ...label.lines].join("|");
  let sprite = tagSprites.get(key);
  if (sprite) {
    // Most recently used last, so the oldest is the first to go.
    tagSprites.delete(key);
  } else {
    sprite = document.createElement("canvas");
    sprite.width = Math.ceil((box.w + 2 * TAG_MARGIN) * dpr);
    sprite.height = Math.ceil((box.h + 2 * TAG_MARGIN) * dpr);
    const g = sprite.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, (TAG_MARGIN - box.x) * dpr, (TAG_MARGIN - box.y) * dpr);
    drawTagBody(g, label);
    if (tagSprites.size >= TAG_SPRITES_MAX) tagSprites.delete(tagSprites.keys().next().value!);
  }
  tagSprites.set(key, sprite);
  // On whole device pixels, so the text stays as sharp as drawn.
  const x = Math.round((box.x - TAG_MARGIN) * dpr) / dpr;
  const y = Math.round((box.y - TAG_MARGIN) * dpr) / dpr;
  ctx.drawImage(sprite, x, y, sprite.width / dpr, sprite.height / dpr);
}
