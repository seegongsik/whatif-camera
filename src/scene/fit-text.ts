/**
 * Fits overlay text to the frame. Model-written titles and captions run up
 * to 48 and 64 characters, wider than a 9:16 frame at caption size. Such text
 * first shrinks a little; past that it breaks at the space that best balances
 * two lines, and shrinks further only when the longer line still does not fit.
 */

/** Width in pixels of a label holding one line at a font size; it scales with the size. */
export type MeasureLabel = (line: string, size: number) => number;

export type FittedText = { lines: string[]; size: number };

/** A single line may shrink to this share of the requested size before it breaks. */
export const MIN_ONE_LINE_SCALE = 0.85;

export function fitText(text: string, size: number, maxWidth: number, measure: MeasureLabel): FittedText {
  // Widths scale with the font size, so one measurement at the requested size is enough.
  const sizeFor = (...lines: string[]) =>
    Math.min(size, (size * maxWidth) / Math.max(...lines.map((line) => measure(line, size))));
  let best: FittedText = { lines: [text], size: sizeFor(text) };
  if (best.size >= size * MIN_ONE_LINE_SCALE) return best;
  for (let i = text.indexOf(" "); i >= 0; i = text.indexOf(" ", i + 1)) {
    const first = text.slice(0, i).trim();
    const second = text.slice(i + 1).trim();
    if (!first || !second) continue;
    const twoLines = sizeFor(first, second);
    if (twoLines > best.size) best = { lines: [first, second], size: twoLines };
  }
  return best;
}
