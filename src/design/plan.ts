/**
 * The "what if" design: a short menu the model chooses from. The model never
 * places anything or states a number; the layout code places every item from
 * the measured footprint, and numbers on screen come from the building spec.
 */

export type PlanSource = "muse-spark-open" | "local";

export type DesignPlan = {
  source: PlanSource;
  title: string;
  captions: string[];
  palette: { accent: string; wood: string; planter: string; bloom: string; foliage: string };
  roof: {
    deck: boolean;
    planters: "edge" | "clusters" | "none";
    trees: number;
    pergola: boolean;
    seating: boolean;
    stringLights: boolean;
  };
  facade: {
    vines: "none" | "corners" | "full";
    windowBoxes: boolean;
    awning: boolean;
    washLights: boolean;
  };
  rationale: string;
};

/** What the designer is told about the building (all from the spec). */
export type DesignFacts = {
  heightM: number;
  floors: number;
  roofAreaM2: number;
  widthM: number;
  depthM: number;
  mainFacadeFacing: string;
  hemisphere: "north" | "south";
  buildingKind?: string;
  facadeColor?: string;
};

export const MAX_TREES = 6;

export const DEFAULT_PALETTE: DesignPlan["palette"] = {
  accent: "#d9733f",
  wood: "#b07a4a",
  planter: "#5b5e60",
  bloom: "#f2c14e",
  foliage: "#4f8a3c",
};

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassWord(bearingDeg: number): string {
  const i = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

/** Plain text with no digits, no control characters, bounded length. */
export function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const printable = Array.from(value, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  }).join("");
  const text = printable
    .replace(/[0-9]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxLength * 0.6 ? cut.slice(0, space) : text.slice(0, maxLength)).trim()}…`;
}

function hexOr(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function localPlan(facts: DesignFacts): DesignPlan {
  const roomy = facts.roofAreaM2 >= 40;
  const usable = facts.roofAreaM2 >= 20;
  const shopfront = ["retail", "commercial", "shop", "kiosk", "supermarket"].includes(facts.buildingKind ?? "");
  return {
    source: "local",
    title: usable ? "A garden on the roof" : "Green walls and warm light",
    captions: usable
      ? ["What if the roof became a garden?", "Green climbing up the corners", "Warm light after sunset"]
      : ["What if the walls turned green?", "Warm light after sunset"],
    palette: { ...DEFAULT_PALETTE },
    roof: {
      deck: roomy,
      planters: usable ? "edge" : "none",
      trees: usable ? Math.max(1, Math.min(4, Math.round(facts.roofAreaM2 / 70))) : 0,
      pergola: facts.roofAreaM2 >= 60,
      seating: roomy,
      stringLights: usable,
    },
    facade: {
      vines: facts.floors <= 4 ? "full" : "corners",
      windowBoxes: false,
      awning: shopfront,
      washLights: true,
    },
    rationale: "Local plan chosen from the measured roof area and floor count; no model was called.",
  };
}

/**
 * Checks a plan that came from the model. Unknown or broken fields fall back
 * to the local plan's choice, and each fallback is noted.
 */
export function parsePlan(raw: unknown, facts: DesignFacts, source: PlanSource): { plan: DesignPlan; notes: string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("the design is not a JSON object");
  }
  const r = raw as Record<string, unknown>;
  const base = localPlan(facts);
  const notes: string[] = [];
  const roof = (typeof r.roof === "object" && r.roof !== null ? r.roof : {}) as Record<string, unknown>;
  const facade = (typeof r.facade === "object" && r.facade !== null ? r.facade : {}) as Record<string, unknown>;
  const palette = (typeof r.palette === "object" && r.palette !== null ? r.palette : {}) as Record<string, unknown>;

  let title = sanitizeText(r.title, 48);
  if (!title) {
    title = base.title;
    notes.push("title missing; used the local title");
  }
  let captions = Array.isArray(r.captions)
    ? r.captions.map((c) => sanitizeText(c, 64)).filter((c) => c.length > 0).slice(0, 3)
    : [];
  if (captions.length === 0) {
    captions = base.captions;
    notes.push("captions missing; used the local captions");
  }
  const treesRaw = typeof roof.trees === "number" && Number.isFinite(roof.trees) ? roof.trees : base.roof.trees;
  const plan: DesignPlan = {
    source,
    title,
    captions,
    palette: {
      accent: hexOr(palette.accent, base.palette.accent),
      wood: hexOr(palette.wood, base.palette.wood),
      planter: hexOr(palette.planter, base.palette.planter),
      bloom: hexOr(palette.bloom, base.palette.bloom),
      foliage: hexOr(palette.foliage, base.palette.foliage),
    },
    roof: {
      deck: boolOr(roof.deck, base.roof.deck),
      planters: enumOr(roof.planters, ["edge", "clusters", "none"] as const, base.roof.planters),
      trees: Math.max(0, Math.min(MAX_TREES, Math.round(treesRaw))),
      pergola: boolOr(roof.pergola, base.roof.pergola),
      seating: boolOr(roof.seating, base.roof.seating),
      stringLights: boolOr(roof.stringLights, base.roof.stringLights),
    },
    facade: {
      vines: enumOr(facade.vines, ["none", "corners", "full"] as const, base.facade.vines),
      windowBoxes: boolOr(facade.windowBoxes, base.facade.windowBoxes),
      awning: boolOr(facade.awning, base.facade.awning),
      washLights: boolOr(facade.washLights, base.facade.washLights),
    },
    rationale: sanitizeText(r.rationale, 240) || base.rationale,
  };
  return { plan, notes };
}

/** The menu as the model sees it. */
export const DESIGN_MENU = `{
  "title": "short name for the idea, at most 48 characters, no digits",
  "captions": ["one to three short lines for the video, at most 64 characters each, no digits"],
  "palette": {"accent": "#rrggbb", "wood": "#rrggbb", "planter": "#rrggbb", "bloom": "#rrggbb", "foliage": "#rrggbb"},
  "roof": {"deck": true|false, "planters": "edge"|"clusters"|"none", "trees": 0-${MAX_TREES}, "pergola": true|false, "seating": true|false, "stringLights": true|false},
  "facade": {"vines": "none"|"corners"|"full", "windowBoxes": true|false, "awning": true|false, "washLights": true|false},
  "rationale": "one or two sentences on why this suits the building, no digits"
}`;
