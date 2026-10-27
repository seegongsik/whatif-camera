/** The top view: footprints around the camera, the view cone, and the picked building. */
import type { LocalFootprint } from "../data/footprints.js";
import type { Candidate } from "../estimate/identify.js";
import { svg } from "./dom.js";

export type TopViewOptions = {
  footprints: LocalFootprint[];
  candidates: Candidate[];
  selectedId: string | null;
  camera: { x: number; y: number; headingDeg: number; fovDeg: number; accuracyM: number; headingKnown?: boolean };
  refined?: { x: number; y: number; headingDeg: number } | null;
  radiusM?: number;
  onSelect?: (id: string) => void;
};

const DEG = Math.PI / 180;

function cone(x: number, y: number, headingDeg: number, fovDeg: number, length: number): string {
  const a = (headingDeg - fovDeg / 2) * DEG;
  const b = (headingDeg + fovDeg / 2) * DEG;
  const p1 = `${x + Math.sin(a) * length},${-(y + Math.cos(a) * length)}`;
  const p2 = `${x + Math.sin(b) * length},${-(y + Math.cos(b) * length)}`;
  return `M${x},${-y} L${p1} A${length},${length} 0 0 1 ${p2} Z`;
}

export function topView(opts: TopViewOptions): SVGSVGElement {
  const r = opts.radiusM ?? 120;
  const root = svg("svg", { viewBox: `${-r} ${-r} ${2 * r} ${2 * r}`, class: "topview", role: "img", "aria-label": "Top view of nearby buildings" });
  root.append(svg("rect", { x: -r, y: -r, width: 2 * r, height: 2 * r, class: "tv-bg" }));
  const scored = new Map(opts.candidates.map((c) => [c.id, c.score]));
  for (const f of opts.footprints) {
    const score = scored.get(f.id) ?? 0;
    const cls = f.id === opts.selectedId ? "tv-fp tv-selected" : score > 0.05 ? "tv-fp tv-candidate" : "tv-fp";
    const poly = svg("polygon", { points: f.ring.map((p) => `${p.x},${-p.y}`).join(" "), class: cls });
    if (opts.onSelect) {
      poly.addEventListener("click", () => opts.onSelect?.(f.id));
      poly.setAttribute("tabindex", "0");
    }
    root.append(poly);
  }
  const c = opts.camera;
  if (c.headingKnown !== false) root.append(svg("path", { d: cone(c.x, c.y, c.headingDeg, c.fovDeg, r * 0.85), class: "tv-cone" }));
  root.append(svg("circle", { cx: c.x, cy: -c.y, r: Math.max(2, c.accuracyM), class: "tv-accuracy" }));
  root.append(svg("circle", { cx: c.x, cy: -c.y, r: 2.6, class: "tv-camera" }));
  if (opts.refined) {
    const f = opts.refined;
    root.append(svg("path", { d: cone(f.x, f.y, f.headingDeg, c.fovDeg, r * 0.85), class: "tv-cone tv-refined-cone" }));
    root.append(svg("circle", { cx: f.x, cy: -f.y, r: 2.6, class: "tv-refined" }));
  }
  // North arrow and a 20 m scale bar.
  const n = svg("g", { transform: `translate(${r - 14},${-r + 16})` });
  n.append(svg("path", { d: "M0,-9 L5,5 L0,2 L-5,5 Z", class: "tv-north" }));
  const label = svg("text", { x: 0, y: 15, class: "tv-label", "text-anchor": "middle" });
  label.textContent = "N";
  n.append(label);
  root.append(n);
  root.append(svg("rect", { x: -r + 8, y: r - 12, width: 20, height: 2.2, class: "tv-scale" }));
  const scale = svg("text", { x: -r + 18, y: r - 15, class: "tv-label", "text-anchor": "middle" });
  scale.textContent = "20 m";
  root.append(scale);
  return root;
}
