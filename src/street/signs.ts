/**
 * How each kind of place looks on the street: a colour and a short word,
 * and the signboard texture drawn from the shop's name. No logos: names come
 * from the map, colours from the kind of place.
 */
import { CanvasTexture, SRGBColorSpace } from "three";
import type { ShopCategory } from "./osm.js";

export const CATEGORY_STYLE: Record<ShopCategory, { color: string; word: string; label: string }> = {
  food: { color: "#f4511e", word: "EAT", label: "Food" },
  cafe: { color: "#8d5b3e", word: "CAFE", label: "Cafés" },
  bar: { color: "#6a3fb5", word: "BAR", label: "Bars" },
  fashion: { color: "#d81b60", word: "STYLE", label: "Fashion" },
  grocery: { color: "#2e9d4a", word: "MART", label: "Groceries" },
  beauty: { color: "#e05297", word: "BEAUTY", label: "Beauty" },
  health: { color: "#00897b", word: "HEALTH", label: "Health" },
  money: { color: "#1e74d6", word: "BANK", label: "Banks" },
  fun: { color: "#f2a900", word: "FUN", label: "Fun" },
  stay: { color: "#3949ab", word: "STAY", label: "Stay" },
  shop: { color: "#546e7a", word: "SHOP", label: "Shops" },
};

export const CATEGORY_ORDER: ShopCategory[] = ["food", "cafe", "bar", "fashion", "grocery", "beauty", "health", "money", "fun", "stay", "shop"];

const FONT = '"Inter", system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif';

/**
 * A signboard: the kind of place on a coloured tab, the name in white
 * (auto-shrunk to fit) and how far along the street it stands; `ring` draws
 * a thick border (a quest stop).
 */
export function signTexture(name: string, category: ShopCategory, distance: string, ring?: string): CanvasTexture {
  const style = CATEGORY_STYLE[category];
  const w = 512;
  const h = 160;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.roundRect(6, 10, w - 8, h - 12, 28);
  ctx.fill();
  ctx.fillStyle = style.color;
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 8, h - 12, 28);
  ctx.fill();
  if (ring) {
    ctx.strokeStyle = ring;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.roundRect(8, 8, w - 20, h - 24, 22);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.roundRect(14, 14, 112, h - 36, 20);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${style.word.length > 4 ? 22 : 28}px ${FONT}`;
  ctx.fillText(style.word, 70, (h - 10) / 2);
  const room = w - 168;
  let size = 50;
  ctx.font = `800 ${size}px ${FONT}`;
  while (size > 24 && ctx.measureText(name).width > room) {
    size -= 2;
    ctx.font = `800 ${size}px ${FONT}`;
  }
  ctx.textAlign = "left";
  let text = name;
  while (text.length > 1 && ctx.measureText(text).width > room) text = `${text.slice(0, -2)}…`;
  ctx.fillText(text, 142, 56);
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.fillText(distance, 142, 112);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A flat label for distance posts and the kilometre arches. */
export function textTexture(text: string, color = "#1b1b1b", background = "#ffffff"): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 88, 20);
  ctx.fill();
  ctx.fillStyle = color;
  let size = 54;
  ctx.font = `900 ${size}px ${FONT}`;
  while (size > 24 && ctx.measureText(text).width > 224) {
    size -= 2;
    ctx.font = `900 ${size}px ${FONT}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 50);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A round badge with a number or a mark: quest stops. */
export function badgeTexture(text: string, color: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 64px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 68);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** "120 m" up to a kilometre, then "1.4 km". */
export function distanceText(m: number): string {
  if (m < 0) return "here";
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
