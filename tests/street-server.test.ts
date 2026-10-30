import { beforeEach, describe, expect, it } from "vitest";
import { latLonToTile } from "../src/data/mvt.js";
import { clipLine, highwayOf, shopsFromTile, streetsFromTile } from "../src/street/tiles.js";
import { SYNTHETIC_CAPTURE, SYNTHETIC_STREET_NAME, syntheticShopsJson, syntheticWaysJson } from "../src/street/synthetic.js";
import { clearStreetCachesForTests, lookupStreet, MAX_PLACES, tilesAhead } from "../server/street-sources.js";
import { localFrame, toLatLon } from "../src/geo/enu.js";
import type { Shop } from "../src/street/osm.js";
import { handleStreet } from "../server/routes.js";
import { resetLimitsForTests } from "../server/limits.js";

// ----- A SYNTHETIC vector tile with a named road and two places, encoded here by hand (MVT 2.1) -----
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const key = (field: number, wire: number) => varint(field * 8 + wire);
const lenDelim = (field: number, bytes: number[]) => [...key(field, 2), ...varint(bytes.length), ...bytes];
const text = (s: string) => Array.from(new TextEncoder().encode(s));
const zz = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const packed = (field: number, nums: number[]) => lenDelim(field, nums.flatMap(varint));
const stringValue = (s: string) => lenDelim(1, text(s));

function lineGeometry(points: [number, number][]): number[] {
  const [x0, y0] = points[0];
  const out = [1 | (1 << 3), zz(x0), zz(y0), 2 | ((points.length - 1) << 3)];
  let cx = x0;
  let cy = y0;
  for (const [x, y] of points.slice(1)) {
    out.push(zz(x - cx), zz(y - cy));
    cx = x;
    cy = y;
  }
  return out;
}

const pointGeometry = (x: number, y: number) => [1 | (1 << 3), zz(x), zz(y)];

function layer(name: string, keys: string[], values: string[], features: { type: number; tags: number[]; geometry: number[] }[]): number[] {
  return [
    ...key(15, 0),
    ...varint(2),
    ...lenDelim(1, text(name)),
    ...features.flatMap((f) => lenDelim(2, [...packed(2, f.tags), ...key(3, 0), ...varint(f.type), ...packed(4, f.geometry)])),
    ...keys.flatMap((k) => lenDelim(3, text(k))),
    ...values.flatMap((v) => lenDelim(4, stringValue(v))),
    ...key(5, 0),
    ...varint(4096),
  ];
}

const origin = SYNTHETIC_CAPTURE.position;
const SYNTHETIC_STREET_ORIGIN_FOR_TESTS = { lat: 37.5, lon: 127.0 };
const t = latLonToTile(14, origin);
const tile = { x: Math.floor(t.x), y: Math.floor(t.y) };
const px = Math.round((t.x - tile.x) * 4096);
const py = Math.round((t.y - tile.y) * 4096);

function syntheticTile(): Uint8Array {
  const roads = layer(
    "transportation_name",
    ["name", "class"],
    ["Tile Street", "primary"],
    // North is up (smaller y): from 40 px south of the camera to past the tile's top edge.
    [{ type: 2, tags: [0, 0, 1, 1], geometry: lineGeometry([[px - 4, py + 40], [px - 4, -500]]) }],
  );
  const pois = layer(
    "poi",
    ["name", "class", "subclass"],
    ["Tile Cafe", "cafe", "Tile School", "school", "Tile Holdings", "company", "Tile Bikes", "bicycle_rental"],
    [
      { type: 1, tags: [0, 0, 1, 1, 2, 1], geometry: pointGeometry(px + 20, py - 200) },
      { type: 1, tags: [0, 2, 1, 3, 2, 3], geometry: pointGeometry(px - 20, py - 300) },
      // An office and a bike dock: not places to shop.
      { type: 1, tags: [0, 4, 1, 5, 2, 5], geometry: pointGeometry(px + 20, py - 400) },
      { type: 1, tags: [0, 6, 1, 7, 2, 7], geometry: pointGeometry(px - 20, py - 500) },
    ],
  );
  return new Uint8Array([...lenDelim(3, roads), ...lenDelim(3, pois)]);
}

type Call = { url: string; body: string; signal?: AbortSignal };

function fakeFetch(handler: (call: Call) => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: decodeURIComponent(String(init?.body ?? "").replace(/^data=/, "")), signal: init?.signal ?? undefined };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  clearStreetCachesForTests();
  resetLimitsForTests();
});

describe("street lookup (SYNTHETIC)", () => {
  it("asks Overpass for the street beside the camera, the same street ahead, then its shops (Overture off)", async () => {
    const { fetchImpl, calls } = fakeFetch(({ body }) => {
      if (body.includes("out center tags")) return Response.json(syntheticShopsJson());
      return Response.json(syntheticWaysJson());
    });
    const street = await lookupStreet(origin, SYNTHETIC_CAPTURE.headingDeg, { fetchImpl, env: { OVERTURE_PLACES: "off", FOOTPRINT_TILES: "off" } });
    expect(calls).toHaveLength(3);
    expect(calls[0].body).toContain("way(around:130,");
    expect(calls[1].body).toContain(`[name="${SYNTHETIC_STREET_NAME}"]`);
    expect(calls[2].body).toContain("nwr[shop](");
    expect(street.name).toBe(SYNTHETIC_STREET_NAME);
    expect(street.source).toContain("overpass-api.de");
    expect(street.route.length).toBeCloseTo(5000, 3);
    expect(street.shops.length).toBeGreaterThan(80);
  });

  it("takes the street from the map tiles first, without asking Overpass", async () => {
    const { fetchImpl, calls } = fakeFetch(({ url }) => {
      if (url.includes("interpreter")) return new Response("busy", { status: 504 });
      if (url.endsWith("/planet")) return Response.json({ tiles: ["https://tiles.example/{z}/{x}/{y}.pbf"] });
      if (url.includes(`/14/${tile.x}/${tile.y}.pbf`)) return new Response(new Blob([syntheticTile() as BlobPart]));
      return new Response(null, { status: 204 });
    });
    const street = await lookupStreet(origin, 0, { fetchImpl, env: { OVERTURE_PLACES: "off" } });
    expect(calls.filter((c) => c.url.includes("interpreter"))).toHaveLength(0);
    expect(street.source).toContain("vector tiles");
    expect(street.name).toBe("Tile Street");
    expect(street.shops.map((s) => s.name)).toEqual(["Tile Cafe"]);
    expect(street.shops[0].side).toBe("right");
    expect(street.notes).toBeUndefined();
  });

  it("asks Overpass when the tiles are down, and says why", async () => {
    const { fetchImpl, calls } = fakeFetch(({ url, body }) => {
      if (url.endsWith("/planet")) return new Response("down", { status: 500 });
      return body.includes("out center tags") ? Response.json(syntheticShopsJson()) : Response.json(syntheticWaysJson());
    });
    const street = await lookupStreet(origin, SYNTHETIC_CAPTURE.headingDeg, { fetchImpl, env: { OVERTURE_PLACES: "off" } });
    expect(calls.filter((c) => c.url.includes("interpreter"))).toHaveLength(3);
    expect(street.name).toBe(SYNTHETIC_STREET_NAME);
    expect(street.source).toContain("Overpass API");
    expect(street.notes).toEqual(["tiles: TileJSON 500"]);
  });

  it("says when the tiles have no named street there and Overpass is busy", async () => {
    const { fetchImpl } = fakeFetch(({ url }) => {
      if (url.includes("interpreter")) return new Response("busy", { status: 504 });
      if (url.endsWith("/planet")) return Response.json({ tiles: ["https://tiles.example/{z}/{x}/{y}.pbf"] });
      if (url.includes(`/14/${tile.x}/${tile.y}.pbf`)) return new Response(new Blob([syntheticTile() as BlobPart]));
      return new Response(null, { status: 204 });
    });
    // Looking east, across the only road in the tile.
    await expect(lookupStreet(origin, 90, { fetchImpl, env: { OVERTURE_PLACES: "off" } })).rejects.toThrow(/No named street runs beside you .*Overpass did not answer .*504 busy/);
  });

  it("gives Overpass only a few seconds when the tiles answered without a street", { timeout: 12_000 }, async () => {
    const { fetchImpl } = fakeFetch(({ url, signal }) => {
      // An Overpass server that never answers: only the time limit ends the wait.
      if (url.includes("interpreter")) return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      if (url.endsWith("/planet")) return Response.json({ tiles: ["https://tiles.example/{z}/{x}/{y}.pbf"] });
      if (url.includes(`/14/${tile.x}/${tile.y}.pbf`)) return new Response(new Blob([syntheticTile() as BlobPart]));
      return new Response(null, { status: 204 });
    });
    const started = Date.now();
    await expect(lookupStreet(origin, 90, { fetchImpl, env: { OVERTURE_PLACES: "off" } })).rejects.toThrow(/No named street runs beside you/);
    expect(Date.now() - started).toBeLessThan(7000);
  });

  it("takes the named street when the starting point is a little off", async () => {
    const { fetchImpl } = fakeFetch(({ body }) => (body.includes("out center tags") ? Response.json(syntheticShopsJson()) : Response.json(syntheticWaysJson())));
    // 70 m east of the avenue.
    const off = { lat: origin.lat, lon: origin.lon + 70 / (111_320 * Math.cos((origin.lat * Math.PI) / 180)) };
    const street = await lookupStreet(off, 4, { fetchImpl, env: { OVERTURE_PLACES: "off", FOOTPRINT_TILES: "off" } }, "synthetic avenue");
    expect(street.name).toBe(SYNTHETIC_STREET_NAME);
    expect(street.streetDistanceM).toBeGreaterThan(70);
    expect(street.notes).toBeUndefined();
  });

  it("takes the places from Overture: the street from Overpass, its shops left unasked", async () => {
    const { fetchImpl, calls } = fakeFetch(({ body }) => (body.includes("out center tags") ? Response.json(syntheticShopsJson()) : Response.json(syntheticWaysJson())));
    const frame = localFrame(SYNTHETIC_STREET_ORIGIN_FOR_TESTS);
    // SYNTHETIC places: 600 on alternate sides of the avenue's first kilometre (before its bend), and one far off it.
    const places: Shop[] = Array.from({ length: 600 }, (_, i) => ({
      id: `ovt/0/0/${i}`,
      name: `Place ${i}`,
      category: "food",
      kind: "category=restaurant",
      point: toLatLon(frame, { x: i % 2 === 0 ? 15 : -15, y: 5 + i * 1.6 }),
      confidence: i % 3 === 0 ? 0.95 : 0.6,
      ...(i % 4 === 0 ? { facebook: `https://www.facebook.com/${1000 + i}` } : {}),
    }));
    places.push({ id: "ovt/0/0/far", name: "Far Place", category: "cafe", kind: "category=cafe", point: toLatLon(frame, { x: 400, y: 300 }) });
    let asked = 0;
    const street = await lookupStreet(origin, SYNTHETIC_CAPTURE.headingDeg, {
      fetchImpl,
      env: { FOOTPRINT_TILES: "off" },
      places: async (boxes) => {
        asked = boxes.length;
        return places;
      },
    });
    const overpass = calls.filter((c) => c.body.length > 0);
    expect(overpass).toHaveLength(2);
    expect(overpass.some((c) => c.body.includes("out center tags"))).toBe(false);
    // A box per 250 m of the street: 5 km ahead and 20 m behind.
    expect(asked).toBe(21);
    expect(street.source).toContain("places: Overture Maps (release 2026-10-21.0)");
    expect(street.attribution).toContain("Overture Maps Foundation");
    expect(street.shops.every((s) => s.id.startsWith("ovt/0/0/") && s.id !== "ovt/0/0/far")).toBe(true);
    // Fewer than a street keeps: every one of them, in order along the street.
    expect(MAX_PLACES).toBeGreaterThan(600);
    expect(street.shops).toHaveLength(600);
    expect(street.placesFound).toBeUndefined();
    expect(street.shops.every((s, i) => i === 0 || s.s >= street.shops[i - 1].s)).toBe(true);
    expect(street.notes).toBeUndefined();
  });

  it("falls back to the map's places when Overture cannot answer", async () => {
    const { fetchImpl } = fakeFetch(({ url, body }) => {
      if (body.length > 0) return Response.json(syntheticWaysJson());
      if (url.endsWith("/planet")) return Response.json({ tiles: ["https://tiles.example/{z}/{x}/{y}.pbf"] });
      if (url.includes(`/14/${tile.x}/${tile.y}.pbf`)) return new Response(new Blob([syntheticTile() as BlobPart]));
      return new Response(null, { status: 204 });
    });
    const street = await lookupStreet(origin, SYNTHETIC_CAPTURE.headingDeg, {
      fetchImpl,
      env: {},
      places: async () => {
        throw new Error("bucket unreachable");
      },
    });
    // The street and its places both from the tiles.
    expect(street.name).toBe("Tile Street");
    expect(street.shops.map((s) => s.name)).toEqual(["Tile Cafe"]);
    expect(street.source).toBe("OpenStreetMap via OpenFreeMap vector tiles");
    expect(street.notes).toEqual(["overture: bucket unreachable"]);
  });

  it("says when no street runs beside the camera", async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ elements: [] }));
    await expect(lookupStreet(origin, 0, { fetchImpl, env: {} })).rejects.toThrow(/No street runs beside you/);
  });

  it("checks the request before looking anything up", async () => {
    const response = await handleStreet(new Request("http://local/api/street?lat=37.5&lon=127"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "lat, lon and heading are required numbers" });
    expect((await handleStreet(new Request("http://local/api/street?lat=37.5&lon=127&heading=0&street=%20"))).status).toBe(400);
  });
});

describe("street tiles (SYNTHETIC)", () => {
  it("cuts roads at the tile edge and skips places that are not shops", () => {
    const bytes = syntheticTile();
    const roads = streetsFromTile(bytes, 14, tile.x, tile.y);
    expect(roads).toHaveLength(1);
    expect(roads[0].points[1].lat).toBeGreaterThan(origin.lat);
    const shops = shopsFromTile(bytes, 14, tile.x, tile.y);
    expect(shops.map((s) => s.name)).toEqual(["Tile Cafe"]);
    expect(clipLine([{ x: -10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 200 }], 100)).toEqual([
      [{ x: 0, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 100 }],
    ]);
  });

  it("takes a pedestrian shopping street as a street, and leaves other paths out", () => {
    const roads = layer(
      "transportation_name",
      ["name", "class", "subclass"],
      ["Tile Promenade", "path", "pedestrian", "Tile Trail", "footway"],
      [
        { type: 2, tags: [0, 0, 1, 1, 2, 2], geometry: lineGeometry([[px, py + 40], [px, -500]]) },
        { type: 2, tags: [0, 3, 1, 1, 2, 4], geometry: lineGeometry([[px + 30, py + 40], [px + 30, -500]]) },
      ],
    );
    const found = streetsFromTile(new Uint8Array(lenDelim(3, roads)), 14, tile.x, tile.y);
    expect(found.map((r) => [r.name, r.highway])).toEqual([["Tile Promenade", "pedestrian"]]);
    expect(highwayOf("minor", "residential")).toBe("residential");
    expect(highwayOf("path", "cycleway")).toBe("");
  });

  it("covers a strip ahead of the camera", () => {
    const tiles = tilesAhead(origin, 0);
    expect(tiles.length).toBeGreaterThan(2);
    expect(tiles.length).toBeLessThanOrEqual(12);
    expect(tiles.some((x) => x.x === tile.x && x.y === tile.y)).toBe(true);
  });
});
