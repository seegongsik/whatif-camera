/**
 * One path from inputs to the video, for a live capture, a saved preset or
 * the synthetic scene alike: footprints → building pick → registration and
 * height → design plan → layout.
 */
import type { CaptureMeta } from "./capture/types.js";
import type { FootprintSet } from "./data/footprints.js";
import type { EN } from "./geo/enu.js";
import { bearingDeg } from "./geo/enu.js";
import { edges } from "./geo/polygon.js";
import { buildSpec, locate, type BuildingSpec, type Located } from "./estimate/spec.js";
import type { CornerMarks } from "./estimate/register.js";
import { compassWord, localPlan, type DesignFacts, type DesignPlan } from "./design/plan.js";
import { layoutDesign, type Layout } from "./design/layout.js";

export type SyntheticTruth = {
  heightM: number;
  floors: number;
  /** True camera position in the local frame of the (offset) GPS fix. */
  cameraEN: EN;
  headingDeg: number;
};

export type SceneInput = {
  synthetic: boolean;
  label: string;
  /** The photo at full resolution. */
  photo: HTMLCanvasElement;
  capture: CaptureMeta;
  footprints: FootprintSet;
  selectionId?: string;
  marks?: CornerMarks;
  plan?: DesignPlan;
  truth?: SyntheticTruth;
};

export function prepare(input: SceneInput): Located {
  return locate(input.capture, { width: input.photo.width, height: input.photo.height }, input.footprints);
}

export function specFor(input: SceneInput, located: Located, selectionId: string, marks: CornerMarks): BuildingSpec {
  return buildSpec({
    synthetic: input.synthetic,
    capture: input.capture,
    located,
    footprintSet: input.footprints,
    selectionId,
    marks,
  });
}

/** Mean colour of the photo between the four marks (the facade), as #rrggbb. */
export function facadeColor(photo: HTMLCanvasElement, marks: CornerMarks): string | undefined {
  const ctx = photo.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  const xs = [marks.roofLeft.u, marks.roofRight.u, marks.groundLeft.u, marks.groundRight.u];
  const ys = [marks.roofLeft.v, marks.roofRight.v, marks.groundLeft.v, marks.groundRight.v];
  const x0 = Math.max(0, Math.floor(Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * 0.15));
  const x1 = Math.min(photo.width, Math.ceil(Math.max(...xs) - (Math.max(...xs) - Math.min(...xs)) * 0.15));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.15));
  const y1 = Math.min(photo.height, Math.ceil(Math.max(...ys) - (Math.max(...ys) - Math.min(...ys)) * 0.15));
  if (x1 - x0 < 4 || y1 - y0 < 4) return undefined;
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  }
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return n > 0 ? `#${hex(r)}${hex(g)}${hex(b)}` : undefined;
}

export function designFacts(spec: BuildingSpec, facade?: string): DesignFacts {
  const main = edges(spec.target.ring)[spec.mainFacade];
  const facing = bearingDeg({ x: 0, y: 0 }, main.normal);
  const facts: DesignFacts = {
    heightM: Math.round(spec.height.heightM * 10) / 10,
    floors: spec.height.floors,
    roofAreaM2: Math.round(spec.roofAreaM2),
    widthM: Math.round(spec.widthM * 10) / 10,
    depthM: Math.round(spec.depthM * 10) / 10,
    mainFacadeFacing: compassWord(facing),
    hemisphere: spec.frame.origin.lat >= 0 ? "north" : "south",
  };
  if (spec.target.tags.kind && /^[a-z_:;-]{1,40}$/.test(spec.target.tags.kind)) facts.buildingKind = spec.target.tags.kind;
  if (facade) facts.facadeColor = facade;
  return facts;
}

/** A small JPEG of the photo for the design model. */
export function photoForModel(photo: HTMLCanvasElement, longSide = 1024): string {
  const scale = Math.min(1, longSide / Math.max(photo.width, photo.height));
  const c = document.createElement("canvas");
  c.width = Math.round(photo.width * scale);
  c.height = Math.round(photo.height * scale);
  c.getContext("2d")!.drawImage(photo, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

export type PlanOutcome = { plan: DesignPlan; note: string };

/** Muse Spark Open through /api/design when the server has a key; otherwise the local plan, said so. */
export async function designPlan(facts: DesignFacts, image: string | undefined, fetchImpl: typeof fetch = fetch): Promise<PlanOutcome> {
  try {
    const res = await fetchImpl("/api/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facts, image }),
    });
    const body = (await res.json().catch(() => ({}))) as { plan?: DesignPlan; error?: string; notes?: string[]; latencyMs?: number };
    if (res.ok && body.plan) {
      const notes = body.notes && body.notes.length > 0 ? ` (${body.notes.join("; ")})` : "";
      return { plan: body.plan, note: `Design by Muse Spark Open in ${Math.round((body.latencyMs ?? 0) / 100) / 10} s${notes}` };
    }
    return { plan: localPlan(facts), note: `Local plan: ${body.error ?? `design service answered ${res.status}`}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { plan: localPlan(facts), note: `Local plan: design service unreachable (${message})` };
  }
}

export function layoutFor(spec: BuildingSpec, plan: DesignPlan): Layout {
  return layoutDesign({
    id: spec.target.id,
    ring: spec.target.ring,
    heightM: spec.height.heightM,
    floors: spec.height.floors,
    floorHeightM: spec.height.floorHeightM,
    mainFacade: spec.mainFacade,
    plan,
    // Only the synthetic scene draws its windows on the storey grid the layout uses.
    windowGridKnown: spec.synthetic,
  });
}
