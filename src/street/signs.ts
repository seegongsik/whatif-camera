/**
 * How each kind of place looks on the street: a colour and a short word.
 * No logos: names come from the map, colours from the kind of place.
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
