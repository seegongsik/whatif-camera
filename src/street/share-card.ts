/**
 * A 1080 × 1920 card of the street ahead for stories and chats, in the
 * show's look: the whole street as light on black with its landmarks (or
 * the quest's stops), how many places of each kind it holds, the photo in
 * a circle, and the map's credits in full. Shared through the phone's share
 * sheet (Instagram Stories, WhatsApp and the rest), or saved where sharing
 * files is not supported.
 */
import type { EN } from "../geo/enu.js";
import type { ShopAhead } from "./ahead.js";
import type { Quest } from "./quest.js";
import { pointAt } from "./route.js";
import { drawTag, glow, MONO, rgba, SANS, tagMeasure, type TagStyle } from "./show-draw.js";
import { dotSpot, groupOf, GROUPS, kindWord, LIGHT, overviewPose, pickLandmarks, projector, QUEST_GOLD, sampleRoute, type Pose, type Projected } from "./show-plan.js";
import { distanceText } from "./signs.js";
import { layoutLabels, type LabelInput } from "./street-labels.js";
import { localRoute, type StreetAhead } from "./street.js";

const W = 1080;
const H = 1920;
const PAD = 72;

export type ShareInput = {
  street: StreetAhead;
  photo?: HTMLCanvasElement | null;
  quest?: { quest: Quest; stops: ShopAhead[] } | null;
};

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number, minSize = 28): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${SANS}`;
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${SANS}`;
  }
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxWidth) t = `${t.slice(0, -2)}…`;
  return t;
}

/** Words onto lines no wider than `maxWidth`, in the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws the card. Every word on it comes from the map, the app, or the quest's checked lines. */
export function drawShareCard(input: ShareInput): HTMLCanvasElement {
  const { street, photo, quest } = input;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const bg = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, H * 0.7);
  bg.addColorStop(0, "#0b1522");
  bg.addColorStop(0.55, "#04080d");
  bg.addColorStop(1, "#000000");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // The title.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = LIGHT;
  ctx.font = `600 30px ${MONO}`;
  ctx.fillText(street.synthetic ? "STREET AHEAD · SYNTHETIC" : "STREET AHEAD", PAD, 120);
  const nameMax = W - 2 * PAD - (photo ? 250 : 0);
  const name = street.name ?? "Unnamed street";
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, name, 800, 96, nameMax, 48);
  ctx.fillText(ellipsize(ctx, name, nameMax), PAD, 222);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `600 34px ${MONO}`;
  ctx.fillText(`${(street.route.length / 1000).toFixed(1)} km · ${street.shops.length} places`, PAD, 284);
  if (photo) drawPhoto(ctx, photo);

  const bottom = quest ? 1160 : 1430;
  drawStreet(ctx, input, 330, bottom);
  if (quest) drawQuest(ctx, quest, bottom + 20);
  else drawCounts(ctx, street, bottom + 30);

  // The credits, in full.
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `500 24px ${SANS}`;
  const credits = [...wrap(ctx, street.attribution, W - 2 * PAD), "Places change; the map may be out of date.", "What If Camera · Street Ahead"];
  credits.forEach((line, i) => ctx.fillText(line, PAD, H - 40 - (credits.length - 1 - i) * 34));
  return canvas;
}

/** The photo in a circle at the top right. */
function drawPhoto(ctx: CanvasRenderingContext2D, photo: HTMLCanvasElement): void {
  const r = 105;
  const cx = W - PAD - r;
  const cy = 190;
  const scale = Math.max((2 * r) / photo.width, (2 * r) / photo.height);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(photo, cx - (photo.width * scale) / 2, cy - (photo.height * scale) / 2, photo.width * scale, photo.height * scale);
  ctx.restore();
  ctx.strokeStyle = LIGHT;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** The whole street from above at an angle, as the show leaves it: light, dots, landmarks or stops. */
function drawStreet(ctx: CanvasRenderingContext2D, input: ShareInput, top: number, bottom: number): void {
  const { street, quest } = input;
  const route = localRoute(street);
  const line = sampleRoute(route, 10);
  const view = { width: W, height: H, fovDeg: 50 };
  // With a quest, only as far as its last stop and a little beyond, so the stops stand apart.
  const limit = quest ? Math.min(route.length, Math.max(600, ...quest.stops.map((s) => s.s + 300))) : Infinity;
  const shown = line.points.filter((_, i) => line.along[i] <= limit);
  const step = Math.max(1, Math.floor(shown.length / 120));
  const fitPoints = [...shown.filter((_, i) => i % step === 0), shown[shown.length - 1], { x: 0, y: 0 }];
  const pose = overviewPose(fitPoints, view, { top: top + 190, bottom: H - bottom + 70, left: 150, right: 150 });
  const project = projector(pose, view);
  drawGrid(ctx, project, pose, top, bottom);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, W, bottom - top);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const pts = line.points.map((p) => project(p));
  for (const [alpha, width] of [
    [0.14, 22],
    [0.42, 8],
    [1, 3],
  ]) {
    ctx.strokeStyle = rgba(quest ? QUEST_GOLD : LIGHT, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    let open = false;
    for (const q of pts) {
      if (!q) {
        open = false;
        continue;
      }
      if (open) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
      open = true;
    }
    ctx.stroke();
  }
  const stops = new Set(quest?.stops.map((s) => s.id));
  for (const shop of street.shops) {
    const q = project(dotSpot(route, shop));
    if (!q) continue;
    const color = stops.has(shop.id) ? QUEST_GOLD : quest ? "#6b7785" : groupOf(shop.category).color;
    const size = stops.has(shop.id) ? 40 : 20;
    ctx.globalAlpha = quest && !stops.has(shop.id) ? 0.5 : 1;
    ctx.drawImage(glow(color, true), q.x - size / 2, q.y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // You, at the start.
  const you = project({ x: 0, y: 0 });
  if (you) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(you.x, you.y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(you.x, you.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 22px ${MONO}`;
    ctx.textAlign = "center";
    ctx.fillText("YOU", you.x, you.y + 46);
    ctx.textAlign = "left";
  }

  // Beams and names: the landmarks, or the quest's stops in order.
  const picks = quest ? [...quest.stops].sort((a, b) => a.s - b.s) : pickLandmarks(street.shops, street.route.length, street.name);
  const inputs: LabelInput<TagStyle>[] = [];
  ctx.lineCap = "round";
  for (const shop of picks) {
    const spot = dotSpot(route, shop);
    const base = project(spot);
    if (!base) continue;
    const color = quest ? QUEST_GOLD : groupOf(shop.category).color;
    const tipY = base.y - 70;
    const beam = ctx.createLinearGradient(0, base.y, 0, tipY);
    beam.addColorStop(0, rgba(color, 0.95));
    beam.addColorStop(1, rgba(color, 0));
    ctx.strokeStyle = beam;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x, tipY);
    ctx.stroke();
    inputs.push({
      key: shop.id,
      x: base.x,
      y: tipY,
      ahead: base.depth,
      name: shop.name,
      detail: `${distanceText(shop.s)} · ${kindWord(shop.kind)}`.toUpperCase(),
      item: { color, number: quest ? quest.stops.indexOf(shop) + 1 : undefined },
      font: 26,
    });
  }
  const end = project(pointAt(route, route.length).at);
  if (end) inputs.push({ key: "end", x: end.x, y: end.y - 10, ahead: 1e9, name: distanceText(route.length), detail: street.route.length < 4990 ? "THE STREET ENDS" : "END OF ROUTE", item: { color: "#ffffff", end: true }, font: 22 });
  const placed = layoutLabels(inputs, tagMeasure(ctx), { left: 40, top: top + 10, right: W - 40, bottom: bottom - 10 }, 10);
  for (const label of placed) drawTag(ctx, label);
  ctx.restore();
}

/** Grid lines every 250 m on the ground, fading with distance. */
function drawGrid(ctx: CanvasRenderingContext2D, project: (p: EN) => Projected | null, pose: Pose, top: number, bottom: number): void {
  const step = 250;
  const half = 26;
  const x0 = (Math.round(pose.x / step) - half) * step;
  const y0 = (Math.round(pose.y / step) - half) * step;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, W, bottom - top);
  ctx.clip();
  ctx.strokeStyle = rgba(LIGHT, 0.09);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= 2 * half; i += 1) {
    for (let j = 0; j < 2 * half; j += 1) {
      for (const [a, b] of [
        [{ x: x0 + i * step, y: y0 + j * step }, { x: x0 + i * step, y: y0 + (j + 1) * step }],
        [{ x: x0 + j * step, y: y0 + i * step }, { x: x0 + (j + 1) * step, y: y0 + i * step }],
      ]) {
        const p = project(a);
        const q = project(b);
        if (!p || !q || p.depth > pose.distance * 3) continue;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** How many places of each kind: a bar in their colours and a key. */
function drawCounts(ctx: CanvasRenderingContext2D, street: StreetAhead, y: number): void {
  const counts = GROUPS.map((g) => ({ g, n: street.shops.filter((s) => g.categories.includes(s.category)).length })).filter((x) => x.n > 0);
  const total = counts.reduce((sum, x) => sum + x.n, 0);
  let x = PAD;
  const width = W - 2 * PAD - 4 * (counts.length - 1);
  for (const { g, n } of counts) {
    const w = (width * n) / Math.max(1, total);
    ctx.fillStyle = g.color;
    ctx.fillRect(x, y, w, 12);
    x += w + 4;
  }
  counts.slice(0, 8).forEach(({ g, n }, i) => {
    const cx = PAD + (i % 2) * ((W - 2 * PAD) / 2);
    const cy = y + 80 + Math.floor(i / 2) * 58;
    ctx.fillStyle = g.color;
    ctx.beginPath();
    ctx.arc(cx + 10, cy - 11, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `650 34px ${SANS}`;
    ctx.fillText(g.label, cx + 36, cy);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `600 30px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(String(n), cx + (W - 2 * PAD) / 2 - 40, cy);
    ctx.textAlign = "left";
  });
}

/** The quest: its title and stops, with the lines Muse Spark wrote (checked: no names, no numbers). */
function drawQuest(ctx: CanvasRenderingContext2D, quest: { quest: Quest; stops: ShopAhead[] }, y: number): void {
  ctx.fillStyle = QUEST_GOLD;
  ctx.font = `600 30px ${MONO}`;
  ctx.fillText(quest.quest.source === "muse-spark-open" ? "✦ QUEST BY MUSE SPARK" : "✦ QUEST", PAD, y + 40);
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, quest.quest.title, 800, 58, W - 2 * PAD, 36);
  ctx.fillText(ellipsize(ctx, quest.quest.title, W - 2 * PAD), PAD, y + 112);
  let row = y + 200;
  quest.stops.forEach((shop, i) => {
    const line = quest.quest.stops.find((s) => s.id === shop.id)?.line ?? "";
    ctx.fillStyle = QUEST_GOLD;
    ctx.beginPath();
    ctx.arc(PAD + 26, row - 14, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000000";
    ctx.font = `800 30px ${SANS}`;
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), PAD + 26, row - 3);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = `750 40px ${SANS}`;
    ctx.fillText(ellipsize(ctx, shop.name, W - 2 * PAD - 360), PAD + 76, row);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `600 30px ${MONO}`;
    ctx.textAlign = "right";
    ctx.fillText(`${distanceText(shop.s)} · ${shop.side}`, W - PAD, row);
    ctx.textAlign = "left";
    if (line) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `500 30px ${SANS}`;
      ctx.fillText(ellipsize(ctx, line, W - 2 * PAD - 76), PAD + 76, row + 44);
    }
    row += 112;
  });
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
