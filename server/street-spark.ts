/**
 * Muse Spark Open on the street: a quest along it (stops chosen by id from
 * the mapped places, told by kind only) and a check of which mapped places
 * it can read in the photo. Both answers are checked before the page sees
 * them (src/street/quest.ts, src/street/spotted.ts).
 */
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

export function buildSignsMessages(places: SpotPlace[], imageDataUrl: string): ChatMessage[] {
  const listed = places.map((p) => ({ id: p.id, name: p.name, side: p.side, metresAhead: p.distanceM }));
  return [
    { role: "system", content: SIGNS_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: `Places mapped along the street ahead (side as seen walking ahead):\n${JSON.stringify(listed)}` },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
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

export async function signsWithSpark(places: SpotPlace[], imageDataUrl: string, deps: Deps = {}): Promise<{ spotted: Spotted; latencyMs: number; model: string }> {
  const reply = await sparkChat(buildSignsMessages(places, imageDataUrl), { temperature: 0.2 }, deps);
  let spotted: Spotted;
  try {
    spotted = parseSpotted(answerObject(reply, "seen"), places);
  } catch (error) {
    if (error instanceof SparkError) throw error;
    throw new SparkError(502, `the answer did not check out: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { spotted, latencyMs: reply.latencyMs, model: MUSE_SPARK_OPEN_MODEL };
}
