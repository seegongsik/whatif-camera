/**
 * A 1080 × 1920 card of the street ahead for stories and chats: the photo
 * (when there is one), the street's name, the quest or the next places, a
 * small map, and the map's credit. Shared through the phone's share sheet
 * (Instagram Stories, WhatsApp and the rest), or saved where sharing files
 * is not supported.
 */
import type { ShopAhead } from "./ahead.js";
import { localRoute } from "./photo-labels.js";
import type { Quest } from "./quest.js";
import { pointAt } from "./route.js";
import { CATEGORY_STYLE, distanceText } from "./signs.js";
import type { StreetAhead } from "./street.js";

const W = 1080;
const H = 1920;
const FONT = '"Inter", system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif';

export type ShareInput = {
  street: StreetAhead;
  photo?: HTMLCanvasElement | null;
  quest?: { quest: Quest; stops: ShopAhead[] } | null;
};

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number, minSize = 28): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  return s;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxWidth) t = `${t.slice(0, -2)}…`;
  return t;
}

/** Draws the card. Every word on it comes from the map, the app, or the quest's checked lines. */
export function drawShareCard(input: ShareInput): HTMLCanvasElement {
  const { street, photo, quest } = input;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background: the photo across the top, fading into the card's colour.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#5aa7e8");
  sky.addColorStop(1, "#1b2a3a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  if (photo) {
    const scale = Math.max(W / photo.width, (H * 0.62) / photo.height);
    const pw = photo.width * scale;
    const ph = photo.height * scale;
    ctx.drawImage(photo, (W - pw) / 2, 0, pw, ph);
  } else {
    drawRoute(ctx, input, { x: 140, y: 150, w: W - 280, h: H * 0.3 });
  }
  const shade = ctx.createLinearGradient(0, H * 0.25, 0, H * 0.62);
  shade.addColorStop(0, "rgba(16, 24, 34, 0)");
  shade.addColorStop(1, "rgba(16, 24, 34, 1)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, H * 0.25, W, H * 0.37);
  ctx.fillStyle = "#101822";
  ctx.fillRect(0, H * 0.62, W, H * 0.38);

  const pad = 72;
  let y = H * 0.47;
  ctx.fillStyle = "#ffcb3d";
  ctx.font = `800 34px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(street.synthetic ? "STREET AHEAD · SYNTHETIC" : "STREET AHEAD", pad, y);
  y += 96;
  ctx.fillStyle = "#ffffff";
  const name = street.name ?? "Unnamed street";
  fitFont(ctx, name, 900, 92, W - 2 * pad, 48);
  ctx.fillText(ellipsize(ctx, name, W - 2 * pad), pad, y);
  y += 64;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText(`${street.shops.length} places in the next ${distanceText(street.route.length)}`, pad, y);
  y += 90;

  if (quest) {
    ctx.fillStyle = "#ffcb3d";
    ctx.font = `800 36px ${FONT}`;
    ctx.fillText(quest.quest.source === "muse-spark-open" ? "✦ QUEST BY MUSE SPARK" : "✦ QUEST", pad, y);
    y += 70;
    ctx.fillStyle = "#ffffff";
    fitFont(ctx, quest.quest.title, 800, 58, W - 2 * pad, 36);
    ctx.fillText(ellipsize(ctx, quest.quest.title, W - 2 * pad), pad, y);
    y += 40;
    quest.stops.forEach((shop, i) => {
      y += 92;
      const line = quest.quest.stops.find((s) => s.id === shop.id)?.line ?? "";
      ctx.fillStyle = CATEGORY_STYLE[shop.category].color;
      ctx.beginPath();
      ctx.arc(pad + 30, y - 14, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 34px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), pad + 30, y - 2);
      ctx.textAlign = "left";
      ctx.font = `800 42px ${FONT}`;
      const head = `${shop.name}`;
      ctx.fillText(ellipsize(ctx, head, W - 2 * pad - 330), pad + 84, y);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `600 34px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(`${distanceText(shop.s)} · ${shop.side}`, W - pad, y);
      ctx.textAlign = "left";
      if (line) {
        ctx.font = `500 32px ${FONT}`;
        ctx.fillText(ellipsize(ctx, line, W - 2 * pad - 84), pad + 84, y + 44);
      }
      y += 30;
    });
  } else {
    ctx.fillStyle = "#ffcb3d";
    ctx.font = `800 36px ${FONT}`;
    ctx.fillText("NEXT UP", pad, y);
    for (const shop of street.shops.filter((s) => s.s > 5).slice(0, 6)) {
      y += 88;
      ctx.fillStyle = CATEGORY_STYLE[shop.category].color;
      ctx.beginPath();
      ctx.roundRect(pad, y - 44, 18, 54, 9);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 42px ${FONT}`;
      ctx.fillText(ellipsize(ctx, shop.name, W - 2 * pad - 340), pad + 40, y);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `600 34px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(`${distanceText(shop.s)} · ${shop.side}`, W - pad, y);
      ctx.textAlign = "left";
    }
  }

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(ellipsize(ctx, street.attribution, W - 2 * pad), pad, H - 108);
  ctx.fillText("Shops change; the map may be out of date.", pad, H - 70);
  ctx.fillText("What If Camera · Street Ahead", pad, H - 32);
  return canvas;
}

/** The street as a line with a dot per place (and the quest's stops), for a card without a photo. */
function drawRoute(ctx: CanvasRenderingContext2D, input: ShareInput, box: { x: number; y: number; w: number; h: number }): void {
  const route = localRoute(input.street);
  // With a quest, only as far as its last stop and a little beyond, so the stops stand apart.
  const limit = input.quest ? Math.min(route.length, Math.max(...input.quest.stops.map((s) => s.s)) + 400) : route.length;
  const points = [...route.points.filter((_, i) => route.along[i] < limit), pointAt(route, limit).at];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const k = Math.min(box.w / Math.max(1, maxX - minX), box.h / Math.max(1, maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const px = (x: number) => box.x + box.w / 2 + (x - cx) * k;
  const py = (y: number) => box.y + box.h / 2 - (y - cy) * k;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(px(p.x), py(p.y)) : ctx.lineTo(px(p.x), py(p.y))));
  ctx.stroke();
  for (const shop of input.street.shops) {
    if (shop.s > limit) break;
    const { at, headingDeg } = pointAt(route, shop.s);
    const h = (headingDeg * Math.PI) / 180;
    const off = (shop.side === "right" ? 1 : -1) * (24 / k);
    ctx.fillStyle = CATEGORY_STYLE[shop.category].color;
    ctx.beginPath();
    ctx.arc(px(at.x + Math.cos(h) * off), py(at.y - Math.sin(h) * off), 7, 0, Math.PI * 2);
    ctx.fill();
  }
  input.quest?.stops.forEach((shop, i) => {
    const { at } = pointAt(route, shop.s);
    ctx.fillStyle = "#ffb300";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(px(at.x), py(at.y), 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 30px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), px(at.x), py(at.y) + 11);
    ctx.textAlign = "left";
  });
  const start = route.points.find((_, i) => route.along[i] >= 0) ?? route.points[0];
  ctx.fillStyle = "#ff6a2b";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(px(start.x), py(start.y), 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** The phone's share sheet when it takes files; otherwise the picture is saved. */
export async function shareCard(canvas: HTMLCanvasElement, title: string): Promise<"shared" | "saved" | "cancelled"> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The card could not be drawn.");
  const file = new File([blob], "street-ahead.png", { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "street-ahead.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}
