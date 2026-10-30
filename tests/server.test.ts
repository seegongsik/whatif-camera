import { beforeEach, describe, expect, it } from "vitest";
import { handleQuest, handleStatus } from "../server/routes.js";
import { resetLimitsForTests } from "../server/limits.js";
import { firstJsonObject } from "../server/spark.js";
import { questPlaces } from "../src/street/quest.js";
import { syntheticStreet } from "../src/street/synthetic.js";

const places = questPlaces(syntheticStreet().shops);
const askQuest = (fetchImpl: typeof fetch) =>
  handleQuest(new Request("http://x/api/quest", { method: "POST", body: JSON.stringify({ theme: "coffee", places }) }), { env: { BASETEN_API_KEY: "k" }, fetchImpl });

beforeEach(() => resetLimitsForTests());

describe("routes", () => {
  it("reports which keys exist without revealing them", async () => {
    const res = await handleStatus(new Request("http://x/api/status"), { env: { BASETEN_API_KEY: "secret-value" } });
    const body = await res.json();
    expect(body).toEqual({ ok: true, basetenApiKeyConfigured: true, modelApiKeyConfigured: false });
    expect(JSON.stringify(body)).not.toContain("secret-value");
  });
});

describe("the Muse Spark client (SYNTHETIC street)", () => {
  it("says why when the reasoning used up the budget and no answer came", async () => {
    const fetchImpl = (async () =>
      Response.json({
        choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "Let me think about the street... ".repeat(40) } }],
      })) as unknown as typeof fetch;
    const res = await askQuest(fetchImpl);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/finish_reason length, answer 0 characters, reasoning \d+ characters/);
  });

  it("asks again without reasoning_effort when the server does not know it", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if ("reasoning_effort" in body) return new Response('{"error":"unknown field reasoning_effort"}', { status: 400 });
      const stops = places.slice(0, 2).map((p) => ({ id: p.id, line: "Have a look around." }));
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "Warm start", stops }) } }] });
    }) as typeof fetch;
    const res = await askQuest(fetchImpl);
    expect(res.status).toBe(200);
    expect(bodies).toHaveLength(2);
    expect("reasoning_effort" in bodies[1]).toBe(false);
    expect((await res.json()).quest.title).toBe("Warm start");
  });

  it("finds the first JSON object even with braces inside strings", () => {
    expect(firstJsonObject('note {"a":"}{","b":{"c":1}} tail')).toEqual({ a: "}{", b: { c: 1 } });
  });
});
