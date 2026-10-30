/**
 * Name tags for the street show, set out the way a printed map sets out
 * callouts: each beside the street on its own side (a place on the
 * street's left gets its tag to the left), clear of the street's line
 * behind and ahead of the light, stacked in a column on each side so they
 * read top to bottom, with a leader line back to the place. A tag that
 * finds no room is left out; the dots still show where every place is.
 */
export const MAX_LABELS = 12;
export const LABEL_PAD_X = 9;
export const LABEL_PAD_Y = 5;
/** Room kept between a tag and the street's line (with its glow). */
export const ROAD_GAP = 16;
/** Room between two tags in a column. */
export const TAG_SPACING = 5;
/** Room between a tag and its place's dot. */
const DOT_GAP = 10;
const MAX_TEXT_PX = 190;
/** With less room than this for the text, the tag is left out. */
const MIN_TEXT_PX = 56;

export type Side = "left" | "right";
export type ScreenPoint = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export type LabelInput<T = unknown> = {
  key: string;
  /** The place on the screen, CSS pixels: the leader line starts here. */
  x: number;
  y: number;
  /** The side of the street's line the tag goes on. */
  side: Side;
  /** Lower goes first when there is no room for every tag. */
  priority: number;
  name: string;
  /** The second line: distance and kind. */
  detail: string;
  /** What a narrow tag keeps of the second line when all of it does not fit (the distance), rather than cutting the end off. */
  short?: string;
  item: T;
  /** Font size of the name, CSS pixels; padding keeps its proportion to it. */
  font: number;
};

/** A placed tag: its box, and its name on one or two lines. */
export type PlacedLabel<T = unknown> = LabelInput<T> & { box: Box; lines: string[] };

export type Measure = (text: string, font: number, bold: boolean) => number;

export type Area = { left: number; top: number; right: number; bottom: number; blocked?: Box[] };

const overlaps = (a: Box, b: Box, margin = 3) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

/** Cuts a text to fit `maxPx`, with an ellipsis; the spaces around " · " go first. */
export function fitText(text: string, maxPx: number, width: (text: string) => number): string {
  if (width(text) <= maxPx) return text;
  const tight = text.replace(/ · /g, "·");
  if (width(tight) <= maxPx) return tight;
  let cut = text;
  while (cut.length > 1 && width(`${cut}…`) > maxPx) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * A name on at most `maxLines` lines no wider than `maxPx`: whole words
 * carried to the next line, a word too long for a line broken, the last
 * line cut with an ellipsis when the name still does not fit.
 */
export function wrapText(text: string, maxPx: number, width: (text: string) => number, maxLines = 2): string[] {
  const lines: string[] = [];
  let rest = text.trim();
  while (rest && lines.length < maxLines - 1 && width(rest) > maxPx) {
    const words = rest.split(" ");
    let take = "";
    let k = 0;
    while (k < words.length && width(take ? `${take} ${words[k]}` : words[k]) <= maxPx) {
      take = take ? `${take} ${words[k]}` : words[k];
      k += 1;
    }
    if (take) rest = words.slice(k).join(" ");
    else {
      let n = words[0].length;
      while (n > 1 && width(words[0].slice(0, n)) > maxPx) n -= 1;
      take = words[0].slice(0, n);
      rest = rest.slice(n).trimStart();
    }
    lines.push(take);
  }
  if (rest) lines.push(fitText(rest, maxPx, width));
  return lines;
}

/** Where the street's line lies across the screen between two heights: its leftmost and rightmost x, or null when it does not pass there. */
export function roadSpan(road: readonly (readonly ScreenPoint[])[], y0: number, y1: number): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const line of road) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      const a = line[i];
      const b = line[i + 1];
      const lo = Math.max(y0, Math.min(a.y, b.y));
      const hi = Math.min(y1, Math.max(a.y, b.y));
      if (lo > hi) continue;
      if (a.y === b.y) {
        min = Math.min(min, a.x, b.x);
        max = Math.max(max, a.x, b.x);
        continue;
      }
      // Where the segment enters and leaves the band.
      for (const y of [lo, hi]) {
        const x = a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
    }
  }
  return min <= max ? { min, max } : null;
}

/**
 * Places the tags. On each side they are taken by priority while the
 * column has room, then set in order of their places' height, each as near
 * its place as the tags above and below allow; then pushed out sideways
 * until clear of the street's line (and of the place's own dot). A tag
 * that meets something blocked (the "you" marker) moves just above or
 * below it. A tag keeps to its side: with no room there it is left out.
 */
export function layoutLabels<T>(
  inputs: LabelInput<T>[],
  measure: Measure,
  area: Area,
  road: readonly (readonly ScreenPoint[])[],
  max = MAX_LABELS,
): PlacedLabel<T>[] {
  type Slot = { input: LabelInput<T>; unit: number; lines: string[]; h: number; y: number };
  const columns: Record<Side, Slot[]> = { left: [], right: [] };
  const room = area.bottom - area.top;
  const nameWidth = (input: LabelInput<T>) => (t: string) => measure(t, input.font, true);
  const fixedOf = (input: LabelInput<T>, unit: number) => LABEL_PAD_X * unit * 2 + input.font * 0.7 + 6 * unit;
  const heightOf = (input: LabelInput<T>, unit: number, lines: number) => LABEL_PAD_Y * unit * 2 + input.font * 1.2 * lines + input.font * 0.95;
  // The edge of a tag facing the street at a height, and the room for its text there.
  const fit = (input: LabelInput<T>, unit: number, y: number, h: number) => {
    const span = roadSpan(road, y - ROAD_GAP / 2, y + h + ROAD_GAP / 2);
    const inner =
      input.side === "left"
        ? Math.min(input.x - DOT_GAP, span ? span.min - ROAD_GAP : Infinity)
        : Math.max(input.x + DOT_GAP, span ? span.max + ROAD_GAP : -Infinity);
    const roomX = input.side === "left" ? inner - area.left : area.right - inner;
    return { inner, maxText: Math.min(MAX_TEXT_PX * unit, roomX - fixedOf(input, unit)) };
  };
  let count = 0;
  for (const input of [...inputs].sort((a, b) => a.priority - b.priority)) {
    if (count >= max) break;
    // A place far off the screen gets no tag: its leader would cross the picture.
    if (input.x < area.left - 20 || input.x > area.right + 20 || input.y < area.top - 40 || input.y > area.bottom + 40) continue;
    const unit = input.font / 13;
    // Lines from the room beside the place; the column then sets the height.
    const guess = fit(input, unit, input.y - heightOf(input, unit, 1) / 2, heightOf(input, unit, 1));
    if (guess.maxText < MIN_TEXT_PX * unit) continue;
    const lines = wrapText(input.name, guess.maxText, nameWidth(input));
    const h = heightOf(input, unit, lines.length);
    const column = columns[input.side];
    if (column.reduce((sum, s) => sum + s.h + TAG_SPACING, 0) + h > room) continue;
    column.push({ input, unit, lines, h, y: input.y - h / 2 });
    count += 1;
  }
  const placed: PlacedLabel<T>[] = [];
  const clear = (box: Box) => box.y >= area.top && box.y + box.h <= area.bottom && !(area.blocked ?? []).some((b) => overlaps(b, box, 4)) && !placed.some((p) => overlaps(p.box, box));
  for (const side of ["left", "right"] as const) {
    const column = columns[side].sort((a, b) => a.input.y - b.input.y);
    // Down from the top, then up from the bottom: in order, apart, inside the area.
    let floor = area.top;
    for (const slot of column) {
      slot.y = Math.max(slot.y, floor);
      floor = slot.y + slot.h + TAG_SPACING;
    }
    let ceiling = area.bottom;
    for (const slot of [...column].reverse()) {
      slot.y = Math.min(slot.y, ceiling - slot.h);
      ceiling = slot.y - TAG_SPACING;
    }
    for (const { input, unit, h, y } of column) {
      const box = boxAt(input, unit, h, y);
      if (box && clear(box)) {
        placed.push(box.label);
        continue;
      }
      // Something in the way (the "you" marker): just above it, or just below.
      const block = (area.blocked ?? []).find((b) => box && overlaps(b, box, 4));
      if (!block) continue;
      for (const ny of [block.y - h - 6, block.y + block.h + 6].sort((a, b) => Math.abs(a - y) - Math.abs(b - y))) {
        const moved = boxAt(input, unit, h, ny);
        if (moved && clear(moved)) {
          placed.push(moved.label);
          break;
        }
      }
    }
  }
  return placed;

  function boxAt(input: LabelInput<T>, unit: number, h: number, y: number): (Box & { label: PlacedLabel<T> }) | null {
    const { inner, maxText } = fit(input, unit, y, h);
    if (maxText < MIN_TEXT_PX * unit) return null;
    const detailFont = Math.round(input.font * 0.8);
    // As many lines as the column made room for; cut more if this height has less room.
    const lines = wrapText(input.name, maxText, nameWidth(input), Math.max(1, Math.round((h - heightOf(input, unit, 0)) / (input.font * 1.2))));
    const detailWidth = (t: string) => measure(t, detailFont, false);
    const whole = fitText(input.detail, maxText, detailWidth);
    const detail = input.short && whole.endsWith("…") ? fitText(input.short, maxText, detailWidth) : whole;
    const w = fixedOf(input, unit) + Math.max(measure(detail, detailFont, false), ...lines.map((l) => measure(l, input.font, true)));
    const box: Box = { x: input.side === "left" ? inner - w : inner, y, w, h };
    return { ...box, label: { ...input, name: lines.join(" "), detail, box, lines } };
  }
}
