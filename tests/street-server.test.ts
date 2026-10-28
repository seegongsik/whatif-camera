import { beforeEach, describe, expect, it } from "vitest";
import { latLonToTile } from "../src/data/mvt.js";
import { clipLine, shopsFromTile, streetsFromTile } from "../src/street/tiles.js";
import { SYNTHETIC_CAPTURE, SYNTHETIC_STREET_NAME, syntheticShopsJson, syntheticWaysJson } from "../src/street/synthetic.js";
import { clearStreetCachesForTests, lookupStreet, tilesAhead } from "../server/street-sources.js";
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
    ["Tile Cafe", "cafe", "Tile School", "school"],
    [
      { type: 1, tags: [0, 0, 1, 1, 2, 1], geometry: pointGeometry(px + 20, py - 200) },
      { type: 1, tags: [0, 2, 1, 3, 2, 3], geometry: pointGeometry(px - 20, py - 300) },
    ],
  );
  return new Uint8Array([...lenDelim(3, roads), ...lenDelim(3, pois)]);
}

type Call = { url: string; body: string };

function fakeFetch(handler: (call: Call) => Response): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: decodeURIComponent(String(init?.body ?? "").replace(/^data=/, "")) };
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
  it("asks Overpass for the street beside the camera, the same street ahead, then its shops", async () => {
    const { fetchImpl, calls } = fakeFetch(({ body }) => {
      if (body.includes("out center tags")) return Response.json(syntheticShopsJson());
      return Response.json(syntheticWaysJson());
    });
    const street = await lookupStreet(origin, SYNTHETIC_CAPTURE.headingDeg, { fetchImpl, env: {} });
    expect(calls).toHaveLength(3);
    expect(calls[0].body).toContain("way(around:60,");
    expect(calls[1].body).toContain(`[name="${SYNTHETIC_STREET_NAME}"]`);
    expect(calls[2].body).toContain("nwr(around:65,");
    expect(street.name).toBe(SYNTHETIC_STREET_NAME);
    expect(street.source).toContain("overpass-api.de");
    expect(street.route.length).toBeCloseTo(5000, 3);
    expect(street.shops.length).toBeGreaterThan(80);
  });

  it("falls back to the map tiles when every Overpass server fails", async () => {
    const { fetchImpl, calls } = fakeFetch(({ url }) => {
      if (url.includes("interpreter")) return new Response("busy", { status: 504 });
      if (url.endsWith("/planet")) return Response.json({ tiles: ["https://tiles.example/{z}/{x}/{y}.pbf"] });
      if (url.includes(`/14/${tile.x}/${tile.y}.pbf`)) return new Response(new Blob([syntheticTile() as BlobPart]));
      return new Response(null, { status: 204 });
    });
    const street = await lookupStreet(origin, 0, { fetchImpl, env: {} });
    expect(calls.filter((c) => c.url.includes("interpreter"))).toHaveLength(2);
    expect(street.source).toContain("vector tiles");
    expect(street.name).toBe("Tile Street");
    expect(street.shops.map((s) => s.name)).toEqual(["Tile Cafe"]);
    expect(street.shops[0].side).toBe("right");
  });

  it("says when no street runs beside the camera", async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ elements: [] }));
    await expect(lookupStreet(origin, 0, { fetchImpl, env: {} })).rejects.toThrow(/No street runs beside you/);
  });

  it("checks the request before looking anything up", async () => {
    const response = await handleStreet(new Request("http://local/api/street?lat=37.5&lon=127"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "lat, lon and heading are required numbers" });
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

  it("covers a strip ahead of the camera", () => {
    const tiles = tilesAhead(origin, 0);
    expect(tiles.length).toBeGreaterThan(2);
    expect(tiles.length).toBeLessThanOrEqual(12);
    expect(tiles.some((x) => x.x === tile.x && x.y === tile.y)).toBe(true);
  });
});
