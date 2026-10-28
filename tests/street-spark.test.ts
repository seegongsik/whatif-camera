import { beforeEach, describe, expect, it } from "vitest";
import { bannedTerms, cleanLine, localQuest, parseQuest, questPlaces, type QuestPlace } from "../src/street/quest.js";
import { parseSpotted, spotPlaces } from "../src/street/spotted.js";
import { syntheticStreet } from "../src/street/synthetic.js";
import { buildQuestMessages } from "../server/street-spark.js";
import { handleQuest, handleSigns } from "../server/routes.js";
import { resetLimitsForTests } from "../server/limits.js";

const street = syntheticStreet();
const places = questPlaces(street.shops);
const byKind = (kind: string) => places.find((p) => p.kind === kind)!;

function modelReply(content: string): typeof fetch {
  return (async () => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] })) as unknown as typeof fetch;
}

beforeEach(() => resetLimitsForTests());

describe("quest places and checks (SYNTHETIC street)", () => {
  it("keeps the nearest few of each kind within 2.5 km, with names for checking only", () => {
    expect(places.length).toBeGreaterThan(20);
    expect(places.every((p) => p.distanceM >= 0 && p.distanceM <= 2500)).toBe(true);
    const cafes = places.filter((p) => p.category === "cafe");
    expect(cafes.length).toBeLessThanOrEqual(8);
    // The first Morning Cup stands 10 m behind the camera; the next one is the nearest café ahead.
    expect(byKind("cafe").name).toBe("Morning Cup 2");
    expect(byKind("cafe").openingHours).toBe("Mo-Su 07:00-22:00");
  });

  it("never shows the model a place's name", () => {
    const [, user] = buildQuestMessages(places, "coffee", { localTime: "Sa 10:30" });
    const text = String(user.content);
    expect(text).toContain("Local time: Sa 10:30");
    expect(text).toContain('"kind":"cafe"');
    for (const p of places) expect(text).not.toContain(p.name);
  });

  it("bans business names and their first two words, not single common words", () => {
    expect(bannedTerms(["Night Owl Mart", "Starbucks", "Coffee", "Glow Lab"])).toEqual(["night owl mart", "night owl", "starbucks", "glow lab"]);
    const banned = bannedTerms(["Night Owl Mart", "Starbucks"]);
    expect(cleanLine("Let your skin glow a little", banned, "fallback")).toBe("Let your skin glow a little");
    expect(cleanLine("Grab a snack at Night Owl", banned, "fallback")).toBe("fallback");
    expect(cleanLine("A latte like Starbucks makes", banned, "fallback")).toBe("fallback");
    expect(cleanLine("Try 2 pastries", banned, "fallback")).toBe("fallback");
    expect(cleanLine(42, banned, "fallback")).toBe("fallback");
  });

  it("checks the model's quest: listed ids once, walking order, clean text", () => {
    const cafe = byKind("cafe");
    const shoes = byKind("shoes");
    const books = byKind("books");
    const quest = parseQuest(
      {
        title: "Slow Saturday stroll",
        stops: [
          { id: books.id, line: "Lose an hour among the shelves." },
          { id: "node/does-not-exist", line: "Nowhere." },
          { id: cafe.id, line: "Start with a Morning Cup latte." },
          { id: cafe.id, line: "Twice." },
          { id: shoes.id, line: "Try on 3 pairs." },
        ],
      },
      places,
      "coffee",
    );
    expect(quest.source).toBe("muse-spark-open");
    expect(quest.title).toBe("Slow Saturday stroll");
    expect(quest.stops.map((s) => s.id)).toEqual([cafe.id, shoes.id, books.id].sort((a, b) => places.find((p) => p.id === a)!.distanceM - places.find((p) => p.id === b)!.distanceM));
    const line = (id: string) => quest.stops.find((s) => s.id === id)!.line;
    expect(line(cafe.id)).toBe("Sit down with a coffee.");
    expect(line(shoes.id)).toBe("Have a look at the clothes.");
    expect(line(books.id)).toBe("Lose an hour among the shelves.");
    expect(() => parseQuest({ title: "x", stops: [{ id: cafe.id, line: "only one" }] }, places, "coffee")).toThrow(/at least two/);
  });

  it("picks a quest itself without the model", () => {
    const quest = localQuest(places, "evening")!;
    expect(quest.source).toBe("local");
    expect(quest.title).toBe("Evening out");
    const stops = quest.stops.map((s) => places.find((p) => p.id === s.id)!);
    expect(stops.map((p) => p.category)).toEqual(["food", "bar", "fun"]);
    for (let i = 1; i < stops.length; i += 1) expect(stops[i].distanceM).toBeGreaterThan(stops[i - 1].distanceM);
    expect(localQuest(places.filter((p) => p.category === "money"), "evening")).toBeNull();
  });
});

describe("quest route (SYNTHETIC)", () => {
  const request = (body: unknown) => new Request("http://x/api/quest", { method: "POST", body: JSON.stringify(body) });

  it("checks the request, then says when there is no key", async () => {
    expect((await handleQuest(request({ theme: "party", places }), { env: {} })).status).toBe(400);
    expect((await handleQuest(request({ theme: "coffee", places: [] }), { env: {} })).status).toBe(400);
    const bad: (QuestPlace | Record<string, unknown>)[] = [...places.slice(0, 3), { ...places[3], distanceM: -5 }];
    expect((await handleQuest(request({ theme: "coffee", places: bad }), { env: {} })).status).toBe(400);
    const res = await handleQuest(request({ theme: "coffee", places }), { env: {} });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/picks the stops itself/);
  });

  it("returns the checked quest from the model", async () => {
    const cafe = byKind("cafe");
    const bakery = byKind("bakery");
    let sent: Record<string, unknown> | null = null;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: `{"title":"Warm start","stops":[{"id":"${bakery.id}","line":"Something fresh from the oven."},{"id":"${cafe.id}","line":"Settle in with a cup."}]}` } }],
      });
    }) as typeof fetch;
    const res = await handleQuest(request({ theme: "coffee", places, localTime: "Mo 09:15" }), { env: { BASETEN_API_KEY: "k" }, fetchImpl });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sent!.model).toBe("meta-models/muse-spark-open-1026");
    expect(JSON.stringify(sent!.messages)).not.toContain("Morning Cup");
    expect(body.quest.title).toBe("Warm start");
    // Put in walking order: the bakery comes first.
    expect(bakery.distanceM).toBeLessThan(cafe.distanceM);
    expect(body.quest.stops.map((s: { id: string }) => s.id)).toEqual([bakery.id, cafe.id]);
  });

  it("fails cleanly when the model's stops are not on the list", async () => {
    const res = await handleQuest(request({ theme: "lunch", places }), {
      env: { BASETEN_API_KEY: "k" },
      fetchImpl: modelReply('{"title":"Lunch","stops":[{"id":"node/1","line":"a"},{"id":"node/2","line":"b"}]}'),
    });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/at least two listed places/);
  });
});

describe("signs in the photo (SYNTHETIC)", () => {
  const spots = spotPlaces(street.shops);
  const image = "data:image/jpeg;base64,AAAA";
  const request = (body: unknown) => new Request("http://x/api/signs", { method: "POST", body: JSON.stringify(body) });

  it("lists the nearest places and checks the answer", () => {
    expect(spots.length).toBeGreaterThan(3);
    expect(spots.every((p) => p.distanceM <= 300)).toBe(true);
    const spotted = parseSpotted(
      { seen: [{ id: spots[0].id, where: "left" }, { id: spots[0].id, where: "right" }, { id: "node/9", where: "left" }, { id: spots[1].id, where: "up" }], view: "sideways" },
      spots,
    );
    expect(spotted).toEqual({ seen: [{ id: spots[0].id, where: "left" }, { id: spots[1].id, where: "middle" }], view: "unclear" });
  });

  it("checks the request, then sends the photo with the names", async () => {
    expect((await handleSigns(request({ image: "http://example.com/a.jpg", places: spots }), { env: {} })).status).toBe(400);
    expect((await handleSigns(request({ image, places: [] }), { env: {} })).status).toBe(400);
    expect((await handleSigns(request({ image, places: spots }), { env: {} })).status).toBe(503);
    let sent: { messages: { content: unknown }[] } | null = null;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: `{"seen":[{"id":"${spots[1].id}","where":"right"}],"view":"along"}` } }] });
    }) as typeof fetch;
    const res = await handleSigns(request({ image, places: spots }), { env: { BASETEN_API_KEY: "k" }, fetchImpl });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spotted).toEqual({ seen: [{ id: spots[1].id, where: "right" }], view: "along" });
    const user = JSON.stringify(sent!.messages[1].content);
    expect(user).toContain(spots[1].name);
    expect(user).toContain('"image_url"');
  });
});
