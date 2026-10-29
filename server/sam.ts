/**
 * SAM 3.1 on Meta Model API: every shop sign in the photo, each as a box and
 * an outline, from the short noun phrase "shop sign" (one concept per
 * request is SAM's rule). The reply is SAM's token text, one line per frame;
 * Meta's parser (@meta-sam/parser) reads it and turns each mask into an SVG
 * path, so the page can cut the sign out of its own copy of the photo. Only
 * boxes and outlines go back to the page, never the picture.
 */
import { decodeMaskToSVGPath, formats, recordsOfKind } from "@meta-sam/parser";
import { resolveModelApiKey, type EnvMap } from "./keys.js";

export const META_API_BASE = "https://api.meta.ai/v1";
export const SAM_MODEL = "sam-3.1";
export const SIGN_PROMPT = "shop sign";
/** At most this many signs go back, the most certain first. */
export const MAX_SIGNS = 24;

export type SamSign = {
  /** SAM's object id within this reply. */
  id: string;
  /** The box in the sent image's pixels: left and top, then the right and bottom edges (exclusive), so it is x2 − x1 wide. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 0 to 1, when SAM gave one. */
  confidence?: number;
  /** The mask's outline as an SVG path, in pixels from the mask's own top-left corner (ox, oy). */
  path: string;
  ox: number;
  oy: number;
};

export type SamSigns = { width: number; height: number; signs: SamSign[] };

export class SamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SamError";
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** The text of a non-streamed Responses reply: its output_text parts, in order. */
export function outputText(body: unknown): string {
  const root = asRecord(body);
  if (typeof root?.output_text === "string") return root.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(root?.output) ? root.output : []) {
    for (const part of Array.isArray(asRecord(item)?.content) ? (asRecord(item)!.content as unknown[]) : []) {
      const p = asRecord(part);
      if (p?.type === "output_text" && typeof p.text === "string") parts.push(p.text);
    }
  }
  return parts.join("");
}

/** SAM's token text read into signs. No match is an empty text, and no signs. */
export function signsFromSamText(text: string, max = MAX_SIGNS): SamSigns {
  // Every box token repeats the image's size.
  const size = /;w=(\d+);h=(\d+)/.exec(text);
  const width = size ? Number(size[1]) : 0;
  const height = size ? Number(size[2]) : 0;
  if (!text.trim()) return { width, height, signs: [] };
  const parser = formats.segmentation.image().createParser();
  parser.push(text);
  const { result } = parser.finish({ status: "completed" });
  const masks = new Map(recordsOfKind(result.records, "mask").map((m) => [m.objectId, m]));
  const signs: SamSign[] = [];
  for (const box of recordsOfKind(result.records, "box")) {
    const mask = masks.get(box.objectId);
    let path = "";
    try {
      path = mask ? decodeMaskToSVGPath(mask.mask) : "";
    } catch {
      // A mask that does not decode leaves the box alone.
    }
    signs.push({
      id: box.objectId,
      x1: box.left,
      y1: box.top,
      x2: box.right,
      y2: box.bottom,
      confidence: box.confidence,
      path,
      ox: mask ? mask.bounds.left : box.left,
      oy: mask ? mask.bounds.top : box.top,
    });
  }
  signs.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return { width, height, signs: signs.slice(0, max) };
}

export async function signsWithSam(
  imageDataUrl: string,
  deps: { env?: EnvMap; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
): Promise<SamSigns & { latencyMs: number; model: string; prompt: string }> {
  const key = resolveModelApiKey(deps.env ?? process.env);
  if (!key) throw new SamError(503, "MODEL_API_KEY is not configured");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const started = now();
  let res: Response;
  try {
    res = await fetchImpl(`${META_API_BASE}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SAM_MODEL,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: SIGN_PROMPT },
              { type: "input_image", image_url: imageDataUrl },
            ],
          },
        ],
        // The smallest masks, and how sure SAM is of each sign.
        metadata: { mask_encoding: "one_bit", include_confidence: "true" },
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
    });
  } catch (error) {
    throw new SamError(502, `SAM 3.1 did not answer: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    // Meta's own error message, never the request.
    const detail = await res
      .json()
      .then((b: unknown) => asRecord(asRecord(b)?.error)?.message)
      .catch(() => undefined);
    throw new SamError(res.status === 429 ? 429 : 502, `SAM 3.1 answered ${res.status}${typeof detail === "string" ? `: ${detail.slice(0, 160)}` : ""}`);
  }
  const body = (await res.json()) as unknown;
  return { ...signsFromSamText(outputText(body)), latencyMs: now() - started, model: SAM_MODEL, prompt: SIGN_PROMPT };
}
