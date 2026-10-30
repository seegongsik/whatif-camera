/**
 * Muse Spark Open on the street: the places the show names (picked by list
 * number from the mapped places, with a reason from a menu), a quest along
 * it (stops chosen by id from the mapped places, told by kind only) and a
 * check of which mapped places it can read in the photo. Every answer is
 * checked before the page sees it (src/street/picks.ts, src/street/quest.ts,
 * src/street/spotted.ts).
 */
import { parsePicks, type PickPlace, type Picks } from "../src/street/picks.js";
import { parseQuest, QUEST_THEMES, type Quest, type QuestPlace, type QuestTheme } from "../src/street/quest.js";
import { parseSpotted, type SpotPlace, type Spotted } from "../src/street/spotted.js";
import type { EnvMap } from "./keys.js";
import { firstJsonObject, MUSE_SPARK_OPEN_MODEL, SparkError, sparkChat, type ChatMessage, type ChatReply } from "./spark.js";

type Deps = { env?: EnvMap; fetchImpl?: typeof fetch; now?: () => number };

export const QUEST_SYSTEM_PROMPT = [
  "You plan a short walking quest along one real street for someone standing at its start.",
  "Choose two to four stops, only from the list of places, by their id, in walking order (nearest first), and keep the walk short unless the theme needs more.",
  "Reply with exactly one JSON object and nothing else: {\"title\": \"...\", \"stops\": [{\"id\": \"...\", \"line\": \"...\"}]}.",
  "The title is at most six words. Each line is at most fourteen words and says what to do or try there, from the kind of place and its tags only.",
  "Text contains no digits and no names of businesses, brands, places or people: the app shows each stop's name and distance itself.",
  "Do not invent menus, prices, ratings, opening times or facts about a place. When hours are listed, prefer places open at the given local time.",
].join(" ");

export function buildQuestMessages(places: QuestPlace[], theme: QuestTheme, context: { localTime?: string } = {}): ChatMessage[] {
  // Kinds, sides and distances only: the model never sees a name, so it cannot repeat one.
  const listed = places.map((p) => {
    const item: Record<string, unknown> = { id: p.id, kind: p.kind, side: p.side, metresAhead: p.distanceM };
    if (p.cuisine) item.cuisine = p.cuisine;
    if (p.openingHours) item.hours = p.openingHours;
    return item;
  });
  const text = [
    `Theme: ${QUEST_THEMES[theme].label} (${QUEST_THEMES[theme].hint}).`,
    context.localTime ? `Local time: ${context.localTime}.` : "Local time: unknown.",
    "Places along the street ahead:",
    JSON.stringify(listed),
  ].join("\n");
  return [
    { role: "system", content: QUEST_SYSTEM_PROMPT },
    { role: "user", content: text },
  ];
}

export const SIGNS_SYSTEM_PROMPT = [
  "You check a street photo against a list of places mapped along the street ahead of the camera.",
  "For each listed place whose name you can actually read in the photo (on a sign, an awning or a window), give its id and where it appears: the left, middle or right third of the picture.",
  "Do not guess from the kind of shop or from the list; leave out names you cannot read.",
  "Also say whether the photo looks along a street (the street runs away from the camera), across it (facing the building fronts), or neither.",
  "Reply with exactly one JSON object and nothing else: {\"seen\": [{\"id\": \"...\", \"where\": \"left|middle|right\"}], \"view\": \"along|across|unclear\"}.",
  "Do not describe or identify people.",
].join(" ");

/** The same check on a photo where SAM 3.1's signs are boxed and numbered: the boxes help the model look, they do not tell it what it reads. */
export const SIGNS_BOXED_SYSTEM_PROMPT = [
  "You check a street photo against a list of places mapped along the street ahead of the camera.",
  "A segmentation model has drawn numbered yellow boxes around the signs it found. The boxes only help you look: read names anywhere in the photo, inside a box or not.",
  "For each listed place whose name you can actually read in the photo (on a sign, an awning or a window), give its id, where it appears (the left, middle or right third of the picture), and the number of the box the name is in, or 0 when it is in no box.",
  "Do not guess from the kind of shop or from the list; leave out names you cannot read.",
  "Also say whether the photo looks along a street (the street runs away from the camera), across it (facing the building fronts), or neither.",
  "Reply with exactly one JSON object and nothing else: {\"seen\": [{\"id\": \"...\", \"where\": \"left|middle|right\", \"box\": 0}], \"view\": \"along|across|unclear\"}.",
  "Do not describe or identify people.",
].join(" ");

/** `boxes`: how many numbered SAM boxes are drawn on the photo; with none, the request is the plain check. */
export function buildSignsMessages(places: SpotPlace[], imageDataUrl: string, boxes = 0): ChatMessage[] {
  const listed = places.map((p) => ({ id: p.id, name: p.name, side: p.side, metresAhead: p.distanceM }));
  const list = `Places mapped along the street ahead (side as seen walking ahead):\n${JSON.stringify(listed)}`;
  return [
    { role: "system", content: boxes > 0 ? SIGNS_BOXED_SYSTEM_PROMPT : SIGNS_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: boxes > 0 ? `${list}\nThe photo has ${boxes} numbered ${boxes === 1 ? "box" : "boxes"} around signs.` : list },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

export const PICKS_SYSTEM_PROMPT = [
  "You choose which places a visitor would want named on a map of one street, from a numbered list of the places along it.",
  "Use what you know about these places: famous sights, historic places, flagship stores, museums, theatres and venues known by name, restaurants, cafés and bars known well beyond their block.",
  "landmarks: up to ten places a visitor is most likely to know or look for by name, most recognisable first. Give each a reason: iconic (known well beyond the street in its own right), historic (long-standing or historic), flagship (a brand's main or best-known store, such as its store on this very street), culture (a museum, gallery, theatre or venue known by name) or well_known (one place known by name in its own right).",
  "A chain's everyday branch is never a landmark, however famous the brand: not a coffee chain, fast-food chain, supermarket, pharmacy, bank, or a fashion chain's ordinary store. Pick a chain's place only when that very place is famous (a flagship, a landmark store).",
  "best: for each group in the list, up to four places of that group that are best known by name in their own right, most recognisable first; a chain's everyday branch only when nothing else in that group is known.",
  "Pick only places you recognise; it is fine to give few or none. Never pick a place for its kind alone, and skip names that look misplaced for this street.",
  'Reply with exactly one JSON object and nothing else: {"landmarks": [{"n": 1, "why": "iconic"}], "best": {"food": [2, 5], "cafe": []}}. Use only numbers from the list.',
].join(" ");

/** The list the model reads: numbers instead of ids (shorter, and nothing to copy wrong), and no text of its own goes back to the page. */
export function buildPicksMessages(places: PickPlace[], context: { street?: string; near?: { lat: number; lon: number } } = {}): ChatMessage[] {
  const where = [
    context.street ? `Street: ${context.street}` : "Street: unnamed",
    // Two decimals, about a kilometre: enough to tell which city, no more.
    context.near ? `near ${context.near.lat.toFixed(2)}, ${context.near.lon.toFixed(2)}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const rows = places.map((p, i) => `${i + 1}|${p.name.replace(/[|\n]/g, "/")}|${p.kind}|${p.group}|${p.distanceM}|${p.side}`);
  const text = [`${where}.`, `Places ahead (n|name|kind|group|metres ahead|side):`, ...rows].join("\n");
  return [
    { role: "system", content: PICKS_SYSTEM_PROMPT },
    { role: "user", content: text },
  ];
}

/** Answers kept per server instance: the same street asked again (a demo street, a replay) answers at once. */
const pickCache = new Map<string, { at: number; value: { picks: Picks; latencyMs: number; model: string } }>();
const PICK_CACHE_MS = 6 * 3600 * 1000;
const PICK_CACHE_MAX = 300;

export function resetPicksCacheForTests(): void {
  pickCache.clear();
}

export async function picksWithSpark(
  places: PickPlace[],
  context: { street?: string; near?: { lat: number; lon: number } },
  deps: Deps = {},
): Promise<{ picks: Picks; latencyMs: number; model: string; cached: boolean }> {
  const now = (deps.now ?? Date.now)();
  const key = JSON.stringify([context.street ?? "", context.near?.lat.toFixed(2), context.near?.lon.toFixed(2), places.map((p) => [p.id, p.name, p.group])]);
  const hit = pickCache.get(key);
  if (hit && now - hit.at < PICK_CACHE_MS) return { ...hit.value, cached: true };
  const reply = await sparkChat(buildPicksMessages(places, context), { temperature: 0.2, maxTokens: 4000 }, { ...deps, timeoutMs: 25_000 });
  let picks: Picks;
  try {
    picks = parsePicks(answerObject(reply, "landmarks"), places);
  } catch (error) {
    if (error instanceof SparkError) throw error;
    throw new SparkError(502, `the picks did not check out: ${error instanceof Error ? error.message : String(error)}`);
  }
  const value = { picks, latencyMs: reply.latencyMs, model: MUSE_SPARK_OPEN_MODEL };
  if (pickCache.size >= PICK_CACHE_MAX) pickCache.delete(pickCache.keys().next().value!);
  pickCache.set(key, { at: now, value });
  return { ...value, cached: false };
}

/** The JSON object in the answer, or in the reasoning when the budget ran out mid-answer. */
function answerObject(reply: ChatReply, firstKey: string): unknown {
  try {
    return firstJsonObject(reply.text);
  } catch {
    const at = reply.reasoning.lastIndexOf(`{"${firstKey}"`);
    if (at >= 0) {
      try {
        return firstJsonObject(reply.reasoning.slice(at));
      } catch {
        // Fall through to the error below.
      }
    }
    throw new SparkError(
      502,
      `the model reply has no JSON object (finish_reason ${reply.finishReason || "none"}, answer ${reply.text.length} characters, reasoning ${reply.reasoning.length} characters)`,
    );
  }
}

export async function questWithSpark(
  places: QuestPlace[],
  theme: QuestTheme,
  context: { localTime?: string },
  deps: Deps = {},
): Promise<{ quest: Quest; latencyMs: number; model: string }> {
  const reply = await sparkChat(buildQuestMessages(places, theme, context), { temperature: 0.8 }, deps);
  let quest: Quest;
  try {
    quest = parseQuest(answerObject(reply, "title"), places, theme);
  } catch (error) {
    if (error instanceof SparkError) throw error;
    throw new SparkError(502, `the quest did not check out: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { quest, latencyMs: reply.latencyMs, model: MUSE_SPARK_OPEN_MODEL };
}

export async function signsWithSpark(places: SpotPlace[], imageDataUrl: string, deps: Deps = {}, boxes = 0): Promise<{ spotted: Spotted; latencyMs: number; model: string }> {
  const reply = await sparkChat(buildSignsMessages(places, imageDataUrl, boxes), { temperature: 0.2 }, deps);
  let spotted: Spotted;
  try {
    spotted = parseSpotted(answerObject(reply, "seen"), places, boxes);
  } catch (error) {
    if (error instanceof SparkError) throw error;
    throw new SparkError(502, `the answer did not check out: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { spotted, latencyMs: reply.latencyMs, model: MUSE_SPARK_OPEN_MODEL };
}
