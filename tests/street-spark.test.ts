import { beforeEach, describe, expect, it } from "vitest";
import { bannedTerms, cleanLine, localQuest, nameCheck, parseQuest, questPlaces, type QuestPlace } from "../src/street/quest.js";
import { parseSpotted, spotPlaces } from "../src/street/spotted.js";
import { syntheticStreet } from "../src/street/synthetic.js";
import { buildQuestMessages, buildSignsMessages, SIGNS_BOXED_SYSTEM_PROMPT, SIGNS_SYSTEM_PROMPT } from "../server/street-spark.js";
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

  it("puts the places Muse Spark already named first, past the cap of their kind and the 2.5 km, in walking order", () => {
    const cafes = Array.from({ length: 12 }, (_, i) => ({ ...street.shops[0], id: `c${i}`, name: `Cafe ${i}`, category: "cafe" as const, s: 100 + i * 100 }));
    const museum = { ...street.shops[0], id: "far", name: "Far Museum", category: "fun" as const, s: 3700 };
    const list = questPlaces([...cafes, museum, { ...museum, id: "far2", s: 3900 }], 2500, new Set(["c11", "far"]));
    expect(list.map((p) => p.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c11", "far"]);
    expect(list.filter((p) => p.known).map((p) => p.id)).toEqual(["c11", "far"]);
  });

  it("shows the model the names, the street and the places it already named, and asks for no names back", () => {
    const listed = questPlaces(street.shops, 2500, new Set([byKind("books").id]));
    const [system, user] = buildQuestMessages(listed, "coffee", { localTime: "Sa 10:30", street: "Main Street", near: { lat: 37.49851, lon: 127.02744 } });
    const text = String(user.content);
    expect(text).toContain("Street: Main Street, near 37.50, 127.03.");
    expect(text).toContain("Local time: Sa 10:30");
    expect(text).toContain(`"name":"${byKind("cafe").name}"`);
    expect(text).toContain(`"id":"${byKind("books").id}","name":"${byKind("books").name}","kind":"books","side":"${byKind("books").side}","metresAhead":${byKind("books").distanceM},"known":true`);
    expect(text).not.toContain("37.4985");
    expect(system.content).toContain("not even the stop's own");
  });

  it("bans business names and their first two words, not single common words", () => {
    expect(bannedTerms(["Night Owl Mart", "Starbucks", "Coffee", "Glow Lab"])).toEqual(["night owl mart", "night owl", "starbucks", "glow lab"]);
    const check = nameCheck(["Night Owl Mart", "Starbucks"]);
    expect(cleanLine("Let your skin glow a little", check, "fallback")).toBe("Let your skin glow a little");
    expect(cleanLine("Grab a snack at Night Owl", check, "fallback")).toBe("fallback");
    expect(cleanLine("A latte like Starbucks makes", check, "fallback")).toBe("fallback");
    expect(cleanLine("Try 2 pastries", check, "fallback")).toBe("fallback");
    expect(cleanLine(42, check, "fallback")).toBe("fallback");
  });

  it("turns down a name the model brings, another script, and a line that opens with a listed name", () => {
    const check = nameCheck(["Tiffany & Co.", "The Metropolitan Museum of Art", "Glow Lab"]);
    expect(cleanLine("Peek into Tiffany's windows.", check, "fallback")).toBe("fallback");
    expect(cleanLine("Tiffany's windows glitter.", check, "fallback")).toBe("fallback");
    expect(cleanLine("Test-drive the newest iPhone.", check, "fallback")).toBe("fallback");
    expect(cleanLine("Wander the halls. Then look for Picasso.", check, "fallback")).toBe("fallback");
    expect(cleanLine("銀座でひと休み", check, "fallback")).toBe("fallback");
    expect(cleanLine("Wander the halls until the rain stops.", check, "fallback")).toBe("Wander the halls until the rain stops.");
    expect(cleanLine("Try the Italian-style pastries. I'd start here.", check, "fallback")).toBe("Try the Italian-style pastries. I'd start here.");
    expect(cleanLine("Let your skin glow a little", check, "fallback")).toBe("Let your skin glow a little");
    // A title may be in title case, but holds no word of a listed name.
    expect(cleanLine("Breakfast at Tiffany's", check, "fallback", 60, true)).toBe("fallback");
    expect(cleanLine("Metropolitan Rain Plan", check, "fallback", 60, true)).toBe("fallback");
    expect(cleanLine("Rainy Day Art Hop", check, "fallback", 60, true)).toBe("Rainy Day Art Hop");
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
    expect((await handleQuest(request({ theme: "coffee", places, near: { lat: 99, lon: 0 } }), { env: {} })).status).toBe(400);
    expect((await handleQuest(request({ theme: "coffee", places, street: "" }), { env: {} })).status).toBe(400);
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
    const sentPlaces = places.map((p) => (p.id === cafe.id ? { ...p, known: true } : p));
    const res = await handleQuest(request({ theme: "coffee", places: sentPlaces, localTime: "Mo 09:15", street: "Main Street", near: { lat: 37.5, lon: 127 } }), {
      env: { BASETEN_API_KEY: "k" },
      fetchImpl,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sent!.model).toBe("meta-models/muse-spark-open-1026");
    // The model reads the names (and which it named before); the page shows them from the map.
    const asked = String((sent!.messages as { content: string }[])[1].content);
    expect(asked).toContain("Morning Cup");
    expect(asked).toContain("Street: Main Street, near 37.50, 127.00.");
    expect(asked).toContain(`"name":"${cafe.name}","kind":"cafe","side":"${cafe.side}","metresAhead":${cafe.distanceM},"known":true`);
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

  it("takes a box number only when boxes were drawn and it is one of them", () => {
    const answer = {
      seen: [
        { id: spots[0].id, where: "left", box: 2 },
        { id: spots[1].id, where: "right", box: 9 },
        { id: spots[2].id, where: "middle", box: 0 },
        { id: spots[3].id, where: "middle", box: 1.5 },
      ],
      view: "along",
    };
    expect(parseSpotted(answer, spots, 3).seen).toEqual([
      { id: spots[0].id, where: "left", box: 2 },
      { id: spots[1].id, where: "right" },
      { id: spots[2].id, where: "middle" },
      { id: spots[3].id, where: "middle" },
    ]);
    // Without boxes on the photo a number means nothing.
    expect(parseSpotted(answer, spots).seen.every((x) => !("box" in x))).toBe(true);
  });

  it("asks as before without boxes, and with them says how many there are", () => {
    const [plainSystem, plainUser] = buildSignsMessages(spots, image);
    expect(plainSystem.content).toBe(SIGNS_SYSTEM_PROMPT);
    expect(JSON.stringify(plainUser.content)).not.toContain("box");
    const [boxedSystem, boxedUser] = buildSignsMessages(spots, image, 7);
    expect(boxedSystem.content).toBe(SIGNS_BOXED_SYSTEM_PROMPT);
    expect(SIGNS_BOXED_SYSTEM_PROMPT).toContain("read names anywhere in the photo, inside a box or not");
    expect(JSON.stringify(boxedUser.content)).toContain("The photo has 7 numbered boxes around signs.");
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

  it("passes the boxes on and keeps the number of the box a name was read in", async () => {
    for (const boxes of [-1, 13, 1.5, "3"]) {
      expect((await handleSigns(request({ image, places: spots, boxes }), { env: { BASETEN_API_KEY: "k" } })).status).toBe(400);
    }
    let sent: { messages: { content: unknown }[] } | null = null;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: `{"seen":[{"id":"${spots[0].id}","where":"left","box":3}],"view":"along"}` } }] });
    }) as typeof fetch;
    const res = await handleSigns(request({ image, places: spots, boxes: 4 }), { env: { BASETEN_API_KEY: "k" }, fetchImpl });
    expect(res.status).toBe(200);
    expect((await res.json()).spotted).toEqual({ seen: [{ id: spots[0].id, where: "left", box: 3 }], view: "along" });
    expect(sent!.messages[0].content).toBe(SIGNS_BOXED_SYSTEM_PROMPT);
  });
});
