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
 * A name tag: dark glass with a rim in the place's colour, its name, and
 * distance and kind below; laid out by layoutLabels with the same font, so
 * the padding (9 px at 13 px type) matches.
 */
export function drawTag(ctx: CanvasRenderingContext2D, label: PlacedLabel<TagStyle>): void {
  const { box, item, font } = label;
  const scale = font / 13;
  const pad = 9 * scale;
  if (label.lifted) {
    ctx.strokeStyle = rgba(item.color, 0.6);
    ctx.lineWidth = scale;
    ctx.beginPath();
    ctx.moveTo(label.x, label.y);
    ctx.lineTo(Math.min(box.x + box.w - 10 * scale, Math.max(box.x + 10 * scale, label.x)), box.y + box.h);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(6,9,14,0.86)";
  ctx.strokeStyle = rgba(item.color, item.end ? 0.35 : 0.7);
  ctx.lineWidth = scale;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 6 * scale);
  ctx.fill();
  ctx.stroke();
  const mark = font * 0.7;
  if (item.number) {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(box.x + pad + mark / 2, box.y + box.h / 2, mark / 2 + scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.font = `800 ${Math.round(font * 0.72)}px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(item.number), box.x + pad + mark / 2, box.y + box.h / 2 + 0.5 * scale);
  } else {
    ctx.fillStyle = item.color;
    ctx.fillRect(box.x + pad, box.y + 6 * scale, 2.5 * scale, box.h - 12 * scale);
  }
  const tx = box.x + pad + mark + 6 * scale;
  const top = box.y + 5 * scale;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `650 ${font}px ${SANS}`;
  ctx.fillText(label.name, tx, top + font * 0.98);
  ctx.fillStyle = item.end ? "rgba(255,255,255,0.6)" : item.color;
  ctx.font = `600 ${Math.round(font * 0.8)}px ${MONO}`;
  ctx.fillText(label.detail, tx, top + font * 1.2 + font * 0.8);
}
