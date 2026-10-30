import { beforeEach, describe, expect, it } from "vitest";
import type { ShopAhead } from "../src/street/ahead.js";
import type { ShopCategory } from "../src/street/osm.js";
import { knownIds, landmarksFrom, mergePicks, parsePicks, pickCandidates, PICK_MAX_PLACES, type PickPlace } from "../src/street/picks.js";
import { pickLandmarks } from "../src/street/show-plan.js";
import { syntheticStreet } from "../src/street/synthetic.js";
import { buildPicksMessages, resetPicksCacheForTests } from "../server/street-spark.js";
import { handleLandmarks } from "../server/routes.js";
import { resetLimitsForTests } from "../server/limits.js";

let nextId = 1;
function shop(s: number, name: string, category: ShopCategory, kind: string, extra: Partial<ShopAhead> = {}): ShopAhead {
  return { id: `p${nextId++}`, name, category, kind: `category=${kind}`, point: { lat: 0, lon: 0 }, s, offset: 15, side: "right", confidence: 0.9, ...extra };
}

const request = (body: unknown) => new Request("http://x/api/landmarks", { method: "POST", body: JSON.stringify(body) });

function modelReply(content: string, calls: { n: number }): typeof fetch {
  return (async () => {
    calls.n += 1;
    return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetLimitsForTests();
  resetPicksCacheForTests();
});

describe("places to pick from", () => {
  it("lists every place of a short street, in order along it, with its chip (SYNTHETIC)", () => {
    const street = syntheticStreet();
    const places = pickCandidates(street.shops, street.route.length, street.name);
    const along = street.shops.filter((s) => s.s >= -10 && s.s <= street.route.length);
    expect(places).toHaveLength(Math.min(along.length, PICK_MAX_PLACES));
    expect(places.every((p, i) => i === 0 || places[i - 1].distanceM <= p.distanceM)).toBe(true);
    expect(places.every((p) => p.distanceM >= 0 && !p.kind.includes("=") && p.name.length <= 80)).toBe(true);
  });

  it("keeps a busy street to the cap, with the best of every chip on it", () => {
    const shops: ShopAhead[] = [];
    for (let i = 0; i < 300; i += 1) shops.push(shop(i * 15, `Boutique ${i}`, "fashion", "clothing_store", { brand: "Chain" }));
    for (let i = 0; i < 40; i += 1) shops.push(shop(i * 100 + 7, `Diner ${i}`, "food", "restaurant"));
    shops.push(shop(2500, "Old Grill", "food", "steakhouse", { confidence: 0.99, website: "https://x" }));
    const places = pickCandidates(shops, 5000, "Main Street");
    expect(places.length).toBe(PICK_MAX_PLACES);
    expect(places.filter((p) => p.group === "food").length).toBeGreaterThanOrEqual(4);
    expect(places.some((p) => p.name === "Old Grill")).toBe(true);
  });
});

describe("the model's picks", () => {
  const places: PickPlace[] = [
    { id: "ovt/a1", name: "City Museum", kind: "museum", group: "fun", side: "left", distanceM: 100 },
    { id: "ovt/b2", name: "Old Grill", kind: "steakhouse", group: "food", side: "right", distanceM: 300 },
    { id: "ovt/c3", name: "Corner Cafe", kind: "cafe", group: "cafe", side: "left", distanceM: 900 },
  ];

  it("shows the model names and numbers, never ids, and the place only to the kilometre", () => {
    const [system, user] = buildPicksMessages(places, { street: "Main Street", near: { lat: 37.49851, lon: 127.02744 } });
    expect(system.content).toContain("most recognisable first");
    // A famous brand's everyday branch (a coffee chain on every corner) is not what a street is known for.
    expect(system.content).toContain("A chain's everyday branch is never a landmark");
    const text = String(user.content);
    expect(text).toContain("Street: Main Street, near 37.50, 127.03.");
    expect(text).toContain("1|City Museum|museum|fun|100|left");
    expect(text).toContain("2|Old Grill|steakhouse|food|300|right");
    expect(text).not.toContain("ovt/");
    expect(text).not.toContain("37.4985");
  });

  it("keeps list numbers in range, each place once, a chip's own kind only, and reasons from the menu", () => {
    const picks = parsePicks(
      {
        landmarks: [{ n: 1, why: "iconic" }, { n: 1, why: "historic" }, { n: 9, why: "iconic" }, { n: "2", why: "the best steak in town" }, 3],
        best: { food: [2, 2, 1], cafe: ["3"], spa: [1], bar: "2" },
      },
      places,
    );
    expect(picks.landmarks).toEqual([
      { id: "ovt/a1", why: "iconic" },
      { id: "ovt/b2", why: "well_known" },
      { id: "ovt/c3", why: "well_known" },
    ]);
    expect(picks.best).toEqual({ food: ["ovt/b2"], cafe: ["ovt/c3"] });
    expect(() => parsePicks([1, 2], places)).toThrow();
    expect(parsePicks({}, places)).toEqual({ landmarks: [], best: {} });
  });
});

describe("landmarks from the picks", () => {
  const a = shop(100, "A", "fun", "museum");
  const b = shop(180, "B", "fashion", "clothing_store");
  const c = shop(1200, "C", "food", "restaurant");
  const d = shop(2600, "D", "fun", "theatre");
  const e = shop(4000, "E", "stay", "hotel");

  it("keep the model's order of importance, spaced along the street, then top up from the map's ranking", () => {
    // B is the model's first; A stands 80 m from it, so it gives way.
    expect(mergePicks([b, a, c], [d, e], 8, 3).map((s) => s.name)).toEqual(["B", "C", "D"]);
    expect(mergePicks([b, a, c, d, e], [], 3, 3).map((s) => s.name)).toEqual(["B", "C", "D"]);
    expect(mergePicks([], [d, e, a], 8, 3).map((s) => s.name)).toEqual(["A", "D", "E"]);
  });

  it("count only the model's landmarks as known to a quest, not a chip's everyday branch", () => {
    expect([...knownIds({ landmarks: [{ id: "museum", why: "culture" }], best: { cafe: ["coffee-chain"] } })]).toEqual(["museum"]);
  });

  it("map the model's ids to the street's places and leave the rest to the map", () => {
    const shops = [a, b, c, d, e];
    const rules = pickLandmarks(shops, 5000);
    const landmarks = landmarksFrom({ landmarks: [{ id: e.id, why: "iconic" }, { id: "gone", why: "iconic" }], best: {} }, shops, rules, 5000);
    expect(landmarks).toContain(e);
    expect(landmarks.length).toBeGreaterThanOrEqual(3);
  });
});

describe("landmarks route", () => {
  const street = syntheticStreet();
  const places = pickCandidates(street.shops, street.route.length, street.name).slice(0, 20);

  it("checks the request, then says when there is no key", async () => {
    expect((await handleLandmarks(request({ places: [] }), { env: {} })).status).toBe(400);
    expect((await handleLandmarks(request({ places: [{ ...places[0], group: "spa" }] }), { env: {} })).status).toBe(400);
    expect((await handleLandmarks(request({ places: [places[0], places[0]] }), { env: {} })).status).toBe(400);
    expect((await handleLandmarks(request({ places, near: { lat: 99, lon: 0 } }), { env: {} })).status).toBe(400);
    expect((await handleLandmarks(request({ places }), { env: {} })).status).toBe(503);
  });

  it("answers a demo street by GET, for the CDN to keep, and only a demo street", async () => {
    expect((await handleLandmarks(new Request("http://x/api/landmarks?demo=nowhere"), { env: {} })).status).toBe(400);
    const off = await handleLandmarks(new Request("http://x/api/landmarks?demo=fifth-avenue"), { env: {} });
    expect(off.status).toBe(503);
    // A failure is never kept by the CDN.
    expect(off.headers.get("Cache-Control")).toBe("no-store");
    expect((await handleLandmarks(new Request("http://x/api/landmarks", { method: "PUT" }), { env: {} })).status).toBe(405);
  });

  it("answers with ids from the list, and the same street again from the cache", async () => {
    const calls = { n: 0 };
    const fetchImpl = modelReply('{"landmarks":[{"n":2,"why":"historic"},{"n":40,"why":"iconic"}],"best":{}}', calls);
    const body = { places, street: street.name, near: { lat: 37.5, lon: 127 } };
    const first = await handleLandmarks(request(body), { env: { BASETEN_API_KEY: "k" }, fetchImpl });
    expect(first.status).toBe(200);
    const answer = await first.json();
    expect(answer.picks.landmarks).toEqual([{ id: places[1].id, why: "historic" }]);
    expect(answer.cached).toBe(false);
    const again = await (await handleLandmarks(request(body), { env: { BASETEN_API_KEY: "k" }, fetchImpl })).json();
    expect(again.cached).toBe(true);
    expect(calls.n).toBe(1);
  });
});
