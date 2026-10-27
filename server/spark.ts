/**
 * Muse Spark Open served by Baseten through its OpenAI-compatible Chat
 * Completions API. The hackathon key works with the model id
 * `meta-models/muse-spark-open-1026` (see DECISIONS.md).
 */
import { resolveBasetenApiKey, type EnvMap } from "./keys.js";

export const BASETEN_API_BASE = "https://inference.baseten.co/v1";
export const MUSE_SPARK_OPEN_MODEL = "meta-models/muse-spark-open-1026";

export type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ChatPart[] };

export type ChatReply = { text: string; reasoning: string; finishReason: string; latencyMs: number };

export class SparkError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SparkError";
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function replyText(body: unknown): { text: string; reasoning: string; finishReason: string } {
  const root = asRecord(body);
  const choice = asRecord(Array.isArray(root?.choices) ? root.choices[0] : null);
  const message = asRecord(choice?.message);
  if (!message) throw new SparkError(502, "the model returned no message");
  const content = message.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((part) => {
        const p = asRecord(part);
        return p && typeof p.text === "string" ? p.text : "";
      })
      .join("");
  }
  // Reasoning models return their thinking separately (field name differs by server).
  const reasoning =
    typeof message.reasoning_content === "string"
      ? message.reasoning_content
      : typeof message.reasoning === "string"
        ? message.reasoning
        : "";
  return { text, reasoning, finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "" };
}

/**
 * Muse Spark Open always reasons before it answers, and the reasoning counts
 * against max_tokens, so the budget is generous and the effort is asked to
 * be low. A server that does not know reasoning_effort gets the request again
 * without it.
 */
export async function sparkChat(
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number; reasoningEffort?: "low" | "medium" | "high" } = {},
  deps: { env?: EnvMap; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
): Promise<ChatReply> {
  const key = resolveBasetenApiKey(deps.env ?? process.env);
  if (!key) throw new SparkError(503, "BASETEN_API_KEY is not configured");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const payload: Record<string, unknown> = {
    model: MUSE_SPARK_OPEN_MODEL,
    messages,
    max_tokens: options.maxTokens ?? 6000,
    temperature: options.temperature ?? 0.6,
    reasoning_effort: options.reasoningEffort ?? "low",
  };
  let last = { status: 502, message: "the model request failed" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = now();
    const response = await fetchImpl(`${BASETEN_API_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 75_000),
    });
    if (response.ok) {
      const parsed = replyText(await response.json());
      return { ...parsed, latencyMs: now() - started };
    }
    const text = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim();
    last = { status: response.status, message: text.length > 300 ? `${text.slice(0, 300)}…` : text || `HTTP ${response.status}` };
    if (response.status === 400 && "reasoning_effort" in payload && /reasoning/i.test(text)) {
      delete payload.reasoning_effort;
      continue;
    }
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw new SparkError(last.status, last.message);
}

/** The first balanced JSON object in a reply (fenced or bare). */
export function firstJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  if (start < 0) throw new SparkError(502, "the model reply has no JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          throw new SparkError(502, "the model reply has broken JSON");
        }
      }
    }
  }
  throw new SparkError(502, "the model reply ends inside a JSON object");
}
