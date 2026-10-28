/**
 * Name tags for the street show, laid out on the screen the way a map lays
 * out its labels: nearest places first, larger when near, never on top of
 * one another, never under the page's bars. A tag that would cover a nearer
 * one is lifted once on a leader line, or left out; the dots still show
 * where every place is.
 */
export const MAX_LABELS = 14;
/** Places further ahead than this get a pin but no name tag. */
export const LABEL_AHEAD_M = 300;

export type LabelInput<T = unknown> = {
  key: string;
  /** Where the place's pin is on the screen, CSS pixels. */
  x: number;
  y: number;
  /** Metres ahead along the street. */
  ahead: number;
  name: string;
  /** The second line: distance and kind. */
  detail: string;
  item: T;
  /** Font size, CSS pixels; by default from the distance ahead. */
  font?: number;
};

export type Box = { x: number; y: number; w: number; h: number };
export type PlacedLabel<T = unknown> = LabelInput<T> & { box: Box; font: number; lifted: boolean };

/** Font size, CSS pixels: 16 for the nearest places, down to 11 by about 230 m. */
export function labelFont(ahead: number): number {
  return Math.round(Math.max(11, Math.min(16, 16 - Math.max(0, ahead) / 45)));
}

export const LABEL_PAD_X = 9;
export const LABEL_PAD_Y = 5;
/** Gap between a tag and its pin. */
export const LABEL_POINTER = 7;
const MAX_NAME_PX = 190;

const overlaps = (a: Box, b: Box, margin = 3) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

/** Cuts a name to fit, with an ellipsis. */
export function fitName(name: string, font: number, measure: (text: string, font: number, bold: boolean) => number, maxPx = MAX_NAME_PX): string {
  if (measure(name, font, true) <= maxPx) return name;
  let cut = name;
  while (cut.length > 1 && measure(`${cut}…`, font, true) > maxPx) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Places tags for the inputs, nearest first. `area` is the part of the
 * screen tags may use (between the top and bottom bars); `blocked` holds
 * what floats over it (the small map, the quest bar).
 */
export function layoutLabels<T>(
  inputs: LabelInput<T>[],
  measure: (text: string, font: number, bold: boolean) => number,
  area: { left: number; top: number; right: number; bottom: number; blocked?: Box[] },
  max = MAX_LABELS,
): PlacedLabel<T>[] {
  const placed: PlacedLabel<T>[] = [];
  for (const input of [...inputs].sort((a, b) => a.ahead - b.ahead)) {
    if (placed.length >= max) break;
    if (input.x < area.left - 20 || input.x > area.right + 20) continue;
    const font = input.font ?? labelFont(input.ahead);
    // A tag with its own font keeps its padding in proportion to it.
    const unit = input.font ? input.font / 13 : 1;
    const name = fitName(input.name, font, measure, MAX_NAME_PX * unit);
    const dot = font * 0.7;
    const textW = Math.max(measure(name, font, true), measure(input.detail, Math.round(font * 0.8), false));
    const w = LABEL_PAD_X * unit * 2 + dot + 6 * unit + textW;
    const h = LABEL_PAD_Y * unit * 2 + font * 1.2 + font * 0.95;
    const x = Math.min(area.right - w, Math.max(area.left, input.x - w / 2));
    let box: Box = { x, y: input.y - LABEL_POINTER - h, w, h };
    let lifted = false;
    const clear = (b: Box) =>
      b.y >= area.top && b.y + b.h <= area.bottom && !placed.some((p) => overlaps(p.box, b)) && !(area.blocked ?? []).some((k) => overlaps(k, b, 6));
    if (!clear(box)) {
      // Once, higher up on a leader line; otherwise the pin goes without a tag.
      const up = { ...box, y: box.y - h - 8 };
      if (!clear(up)) continue;
      box = up;
      lifted = true;
    }
    placed.push({ ...input, name, box, font, lifted });
  }
  return placed;
}
