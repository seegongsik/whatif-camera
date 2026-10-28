/** What the app measured, estimated and assumed, in plain words. */
import type { BuildingSpec } from "../estimate/spec.js";
import type { DesignPlan } from "../design/plan.js";
import type { SceneInput } from "../pipeline.js";
import { ASSUMED_FLOOR_HEIGHT_M } from "../estimate/height.js";
import { ASSUMED_CAMERA_HEIGHT_M } from "../estimate/register.js";
import { tiltFromVerticals } from "../estimate/verticals.js";
import { wrapDeg } from "../geo/enu.js";
import { h, fmt } from "./dom.js";

function row(label: string, value: string, note?: string): HTMLElement {
  return h("div", { class: "fact" }, h("dt", { text: label }), h("dd", {}, value, note ? h("small", { text: note }) : null));
}

export function factsPanel(input: SceneInput, spec: BuildingSpec, plan: DesignPlan, planNote: string): HTMLElement {
  const H = spec.height;
  const tags = spec.target.tags;
  const reg = spec.registration;
  const building = h(
    "dl",
    { class: "facts" },
    row("Height", `≈ ${fmt(H.heightM)} m`, `estimate from the photo and the map (edges: ${[H.leftHeightM, H.rightHeightM, H.nearHeightM].filter((x): x is number => x !== null).map((x) => fmt(x)).join(", ")} m)`),
    tags.heightM !== undefined && !input.synthetic ? row("Height in OpenStreetMap", `${fmt(tags.heightM)} m`, "for comparison") : null,
    tags.heightM === undefined && tags.tileHeightM !== undefined && !input.synthetic
      ? row("Height on the map", `≈ ${fmt(tags.tileHeightM, 0)} m`, "from OpenStreetMap height or levels, via map tiles; for comparison")
      : null,
    row("Floors", `${H.floors}`, H.floorsSource === "OpenStreetMap building:levels" ? "OpenStreetMap building:levels" : `height ÷ ${fmt(ASSUMED_FLOOR_HEIGHT_M)} m per floor (assumption)`),
    row("Footprint", `${fmt(spec.widthM)} × ${fmt(spec.depthM)} m · roof ${Math.round(spec.roofAreaM2)} m²`, spec.footprintSource),
  );
  const tilt = tiltFromVerticals(spec.marks, spec.pose.intrinsics);
  const camera = h(
    "dl",
    { class: "facts" },
    row("GPS corrected by", `${fmt(reg.positionShiftM)} m`, `reported accuracy ±${Math.round(input.capture.accuracyM)} m`),
    row("Compass corrected by", `${fmt(reg.headingShiftDeg)}°`, input.capture.headingSource === "compass" ? "magnetic compass" : input.capture.headingSource),
    row("Fit of the marks", `${fmt(reg.rmsDeg, 2)}° rms`, "how well the photo and the map agree"),
    row("Camera height", `${fmt(H.cameraHeightM)} m`, H.cameraHeightSource === "assumption" ? `assumption (${fmt(ASSUMED_CAMERA_HEIGHT_M)} m, wall foot hidden)` : "measured from the wall foot"),
    row(
      "Camera tilt",
      `pitch ${fmt(input.capture.pitchDeg)}°, roll ${fmt(input.capture.rollDeg)}°`,
      `${input.capture.tiltSource ?? "sensor"}${tilt ? `; from the building's edges: ${fmt(tilt.pitchDeg)}°, ${fmt(tilt.rollDeg)}°` : ""}`,
    ),
  );
  const assumptions = h(
    "ul",
    { class: "assumptions" },
    h("li", { text: "The roof stands at the same height at both outer edges (flat roof)." }),
    input.capture.fovSource === "assumption" ? h("li", { text: `Field of view ${input.capture.fovLongDeg}° across the long side (typical phone main camera).` }) : null,
    input.capture.principalPoint
      ? h("li", { text: `The picture is a crop: its optical centre is taken at (${Math.round(input.capture.principalPoint.u)}, ${Math.round(input.capture.principalPoint.v)}) px, worked out from the picture's lines.` })
      : null,
    H.floorsSource !== "OpenStreetMap building:levels" ? h("li", { text: `${fmt(ASSUMED_FLOOR_HEIGHT_M)} m per floor.` }) : null,
    H.cameraHeightSource === "assumption" ? h("li", { text: `Phone at ${fmt(ASSUMED_CAMERA_HEIGHT_M)} m (wall foot hidden).` }) : null,
    spec.neighbours.some((n) => n.heightSource === "assumption")
      ? h("li", { text: `${spec.neighbours.filter((n) => n.heightSource === "assumption").length} neighbouring buildings drawn at an assumed height (context only).` })
      : null,
    spec.neighbours.some((n) => n.heightSource === "map tiles (approximate)")
      ? h("li", { text: `${spec.neighbours.filter((n) => n.heightSource === "map tiles (approximate)").length} neighbouring buildings drawn at the map tiles' approximate height (context only).` })
      : null,
    h("li", { text: "Walls the photo did not see are drawn with a generic window grid on the storey height: an illustration, not measured." }),
    h("li", { text: "Decorations are an idea, not a plan: a real roof garden needs a structural check." }),
  );
  const design = h("div", { class: "design" }, h("p", { class: "plan-note", text: planNote }), h("p", { text: plan.rationale }));
  const panel = h(
    "section",
    { class: "panel" },
    h("h3", { text: "Building" }),
    building,
    h("h3", { text: "Camera" }),
    camera,
    h("h3", { text: plan.source === "muse-spark-open" ? "Design (Muse Spark Open)" : "Design (local plan)" }),
    design,
    h("h3", { text: "Assumptions" }),
    assumptions,
  );
  if (input.truth) {
    const t = input.truth;
    const posErr = Math.hypot(reg.position.x - t.cameraEN.x, reg.position.y - t.cameraEN.y);
    panel.append(
      h("h3", { text: "Synthetic check (truth the app never saw)" }),
      h(
        "dl",
        { class: "facts" },
        row("True height", `${fmt(t.heightM)} m`, `estimate off by ${fmt(H.heightM - t.heightM, 2)} m (${fmt((100 * (H.heightM - t.heightM)) / t.heightM)}%)`),
        row("Camera position error", `${fmt(posErr, 2)} m`, "after correcting the offset GPS fix"),
        row("Heading error", `${fmt(wrapDeg(reg.headingDeg - t.headingDeg), 2)}°`, "after correcting the compass"),
        row("Floors", `${t.floors} true`, `${H.floors} estimated`),
      ),
    );
  }
  return panel;
}
