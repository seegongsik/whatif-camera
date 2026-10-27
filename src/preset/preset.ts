/**
 * A preset is one capture saved whole: the photo, what the phone knew, the
 * footprints as fetched, the building pick, the marks and the design plan.
 * Replaying it runs the same pipeline as a live capture, with no network
 * needed, so a demo video can be recorded the same way every time.
 */
import type { CaptureMeta } from "../capture/types.js";
import { isFootprintSet, type FootprintSet } from "../data/footprints.js";
import type { CornerMarks } from "../estimate/register.js";
import type { DesignPlan } from "../design/plan.js";
import type { SceneInput } from "../pipeline.js";

export const PRESET_FORMAT = "whatif-camera-preset";

export type PresetFile = {
  format: typeof PRESET_FORMAT;
  version: 1;
  label: string;
  synthetic: boolean;
  savedAt: string;
  photo: { dataUrl: string; width: number; height: number };
  capture: CaptureMeta;
  footprints: FootprintSet;
  selectionId?: string;
  marks?: CornerMarks;
  plan?: DesignPlan;
};

export function presetFrom(input: SceneInput, extra: { selectionId: string; marks: CornerMarks; plan?: DesignPlan }): PresetFile {
  return {
    format: PRESET_FORMAT,
    version: 1,
    label: input.label,
    synthetic: input.synthetic,
    savedAt: new Date().toISOString(),
    photo: { dataUrl: input.photo.toDataURL("image/jpeg", 0.9), width: input.photo.width, height: input.photo.height },
    capture: input.capture,
    footprints: input.footprints,
    selectionId: extra.selectionId,
    marks: extra.marks,
    plan: extra.plan,
  };
}

function isNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isPixel(p: unknown): boolean {
  return typeof p === "object" && p !== null && isNumber((p as { u: unknown }).u) && isNumber((p as { v: unknown }).v);
}

export function parsePreset(text: string): PresetFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The preset is not valid JSON.");
  }
  const p = raw as Partial<PresetFile>;
  if (!p || p.format !== PRESET_FORMAT || p.version !== 1) throw new Error("This file is not a What If Camera preset.");
  if (!p.photo || typeof p.photo.dataUrl !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(p.photo.dataUrl)) {
    throw new Error("The preset has no photo.");
  }
  const c = p.capture;
  if (!c || !isNumber(c.lat) || !isNumber(c.lon) || !isNumber(c.headingDeg) || !isNumber(c.pitchDeg) || !isNumber(c.rollDeg)) {
    throw new Error("The preset's capture is incomplete (position, heading, pitch, roll).");
  }
  if (!isNumber(c.fovLongDeg) || !isNumber(c.accuracyM)) throw new Error("The preset's capture lacks the field of view or accuracy.");
  if (c.principalPoint !== undefined && !isPixel(c.principalPoint)) throw new Error("The preset's optical centre is malformed.");
  if (!isFootprintSet(p.footprints)) throw new Error("The preset's footprints are missing or malformed.");
  if (p.marks) {
    const m = p.marks;
    if (![m.roofLeft, m.roofRight, m.groundLeft, m.groundRight].every(isPixel) || (m.nearCorner && !isPixel(m.nearCorner))) {
      throw new Error("The preset's marks are malformed.");
    }
  }
  return p as PresetFile;
}

export async function sceneFromPreset(preset: PresetFile): Promise<SceneInput> {
  const image = new Image();
  image.decoding = "async";
  image.src = preset.photo.dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return {
    synthetic: preset.synthetic,
    label: preset.label,
    photo: canvas,
    capture: preset.capture,
    footprints: preset.footprints,
    selectionId: preset.selectionId,
    marks: preset.marks,
    plan: preset.plan,
  };
}

export function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
