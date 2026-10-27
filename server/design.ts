/**
 * Asks Muse Spark Open to choose the "what if" from the menu, looking at the
 * photo and the measured facts.
 */
import { DESIGN_MENU, parsePlan, type DesignFacts, type DesignPlan } from "../src/design/plan.js";
import type { EnvMap } from "./keys.js";
import { firstJsonObject, MUSE_SPARK_OPEN_MODEL, SparkError, sparkChat, type ChatMessage, type ChatPart } from "./spark.js";

export const SYSTEM_PROMPT = [
  "You design a short 'what if' makeover video for one real building: a rooftop garden, greenery on the walls and evening light.",
  "Choose only from the menu and reply with exactly one JSON object, nothing else.",
  "Text fields contain no digits; the app shows every number itself from its measurements.",
  "Do not name brands, businesses or places, do not describe or identify people, and do not claim the roof can carry any load: this is a visual idea, not engineering advice.",
  "Fit the choices to the photo and the facts: a small roof gets planter clusters and no pergola; a tall building gets vines at the corners rather than over the whole face; a ground-floor shopfront may get an awning; window boxes only when the photo shows a regular grid of windows.",
  "Pick colours that suit the facade in the photo. Write the captions as light, curious English lines that start the viewer imagining.",
].join(" ");

export function buildDesignMessages(facts: DesignFacts, imageDataUrl?: string): ChatMessage[] {
  const text = [
    "Facts measured by the app (estimates from the photo and the map):",
    JSON.stringify(facts),
    "Menu (reply with this shape):",
    DESIGN_MENU,
  ].join("\n");
  const content: ChatPart[] = [{ type: "text", text }];
  if (imageDataUrl) content.push({ type: "image_url", image_url: { url: imageDataUrl } });
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content },
  ];
}

export async function designWithSpark(
  facts: DesignFacts,
  imageDataUrl: string | undefined,
  deps: { env?: EnvMap; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<{ plan: DesignPlan; notes: string[]; latencyMs: number; model: string }> {
  const reply = await sparkChat(buildDesignMessages(facts, imageDataUrl), {}, deps);
  let raw: unknown;
  try {
    raw = firstJsonObject(reply.text);
  } catch {
    // The answer can end up only in the reasoning when the budget ran out mid-way.
    try {
      raw = firstJsonObject(reply.reasoning.slice(reply.reasoning.lastIndexOf('{"title"') >= 0 ? reply.reasoning.lastIndexOf('{"title"') : 0));
    } catch {
      throw new SparkError(
        502,
        `the model reply has no JSON object (finish_reason ${reply.finishReason || "none"}, answer ${reply.text.length} characters, reasoning ${reply.reasoning.length} characters)`,
      );
    }
  }
  const { plan, notes } = parsePlan(raw, facts, "muse-spark-open");
  return { plan, notes, latencyMs: reply.latencyMs, model: MUSE_SPARK_OPEN_MODEL };
}
