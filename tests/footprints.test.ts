import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildingsFromTile, latLonToTile, polygonRings, tileToLatLon } from "../src/data/mvt.js";
import { clearFootprintCachesForTests, lookupFootprints, overpassUrls } from "../server/footprint-sources.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/overpass-synthetic.json", import.meta.url), "utf8"));
const center = { lat: 37.5, lon: 127.0 };

// ----- A SYNTHETIC vector tile, encoded here by hand (MVT 2.1 wire format) -----
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

function geometry(rings: [number, number][][]): number[] {
  const out: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const ring of rings) {
    const [x0, y0] = ring[0];
    out.push(1 | (1 << 3), zz(x0 - cx), zz(y0 - cy));
    cx = x0;
    cy = y0;
    out.push(2 | ((ring.length - 1) << 3));
    for (const [x, y] of ring.slice(1)) {
      out.push(zz(x - cx), zz(y - cy));
      cx = x;
      cy = y;
    }
    out.push(7 | (1 << 3));
  }
  return out;
}

/** One "building" layer; each feature is [rings, render_height value index or -1]. */
function tileBytes(features: { rings: [number, number][][]; height?: number }[]): Uint8Array {
  const values = features.filter((f) => f.height !== undefined).map((f) => f.height as number);
  const layer: number[] = [...lenDelim(1, text("building"))];
  let v = 0;
  for (const f of features) {
    const tags = f.height !== undefined ? [0, v++] : [];
    layer.push(...lenDelim(2, [...packed(2, tags), ...key(3, 0), ...varint(3), ...packed(4, geometry(f.rings))]));
  }
  layer.push(...lenDelim(3, text("render_height")));
  for (const h of values) layer.push(...lenDelim(4, [...key(5, 0), ...varint(h)]));
  layer.push(...key(5, 0), ...varint(4096), ...key(15, 0), ...varint(2));
  return new Uint8Array(lenDelim(3, layer));
}

const t = latLonToTile(14, center);
const tx = Math.floor(t.x);
const ty = Math.floor(t.y);
const px = Math.round((t.x - tx) * 4096);
const py = Math.round((t.y - ty) * 4096);
const square = (cx: number, cy: number, r: number): [number, number][] => [
  [cx - r, cy - r],
  [cx + r, cy - r],
  [cx + r, cy + r],
  [cx - r, cy + r],
];

describe("vector tiles (SYNTHETIC tile)", () => {
  it("round-trips tile and geographic coordinates", () => {
    const p = tileToLatLon(14, tx, ty, px, py, 4096);
    expect(p.lat).toBeCloseTo(center.lat, 4);
    expect(p.lon).toBeCloseTo(center.lon, 4);
  });

  it("reads exterior rings, skips holes and splits multipolygons", () => {
    const hole = square(px, py, 10).reverse();
    const tile = tileBytes([
      { rings: [square(px, py, 40), hole, square(px + 200, py, 20)], height: 21 },
      { rings: [square(px - 300, py, 30)] },
    ]);
    const buildings = buildingsFromTile(tile, 14, tx, ty);
    expect(buildings).toHaveLength(3);
    expect(buildings[0].tags.tileHeightM).toBe(21);
    expect(buildings[2].tags.tileHeightM).toBeUndefined();
    const lats = buildings[0].ring.map((p) => p.lat);
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(0);
  });

  it("decodes command integers with counts above one", () => {
    const rings = polygonRings(geometry([square(5, 5, 4)]));
    expect(rings[0]).toEqual([
      { x: 1, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: 9 },
      { x: 1, y: 9 },
    ]);
  });
});

describe("footprint sources", () => {
  beforeEach(() => clearFootprintCachesForTests());

  it("lists configured Overpass URLs before the defaults, HTTPS only", () => {
    const urls = overpassUrls({ OVERPASS_URLS: "https://a.example/api/interpreter, http://plain.example/x" });
    expect(urls[0]).toBe("https://a.example/api/interpreter");
    expect(urls).not.toContain("http://plain.example/x");
    expect(urls).toContain("https://overpass-api.de/api/interpreter");
  });

  it("moves on to the next Overpass server when one is full or times out", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push(String(url));
      if (String(url).includes("overpass-api.de")) return new Response("server at capacity", { status: 502 });
      return Response.json(fixture);
    }) as typeof fetch;
    const set = await lookupFootprints(center, 150, { env: {}, fetchImpl });
    expect(seen).toHaveLength(2);
    expect(set.source).toContain("overpass.private.coffee");
    expect(set.buildings).toHaveLength(3);
  });

  it("treats a 200 with a timeout remark and no elements as a failure", async () => {
    const fetchImpl = (async (url: string | URL | Request) =>
      String(url).includes("overpass-api.de")
        ? Response.json({ remark: "runtime error: Query timed out", elements: [] })
        : Response.json(fixture)) as typeof fetch;
    const set = await lookupFootprints(center, 150, { env: {}, fetchImpl });
    expect(set.source).toContain("overpass.private.coffee");
  });

  it("falls back to vector tiles when every Overpass server fails", async () => {
    const tile = tileBytes([{ rings: [square(px, py - 60, 30)], height: 15 }, { rings: [square(px + 3000, py, 30)] }]);
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("interpreter")) return new Response("busy", { status: 504 });
      if (u === "https://tiles.openfreemap.org/planet") return Response.json({ tiles: ["https://tiles.example/v1/{z}/{x}/{y}.pbf"] });
      if (u.startsWith("https://tiles.example/v1/14/")) return new Response(tile.slice().buffer);
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    const set = await lookupFootprints(center, 150, { env: {}, fetchImpl });
    expect(set.source).toContain("vector tiles");
    expect(set.attribution).toContain("OpenStreetMap");
    // The far square (3000 units, over a kilometre away) is dropped.
    expect(set.buildings).toHaveLength(1);
    expect(set.buildings[0].tags.tileHeightM).toBe(15);
  });

  it("names every source that failed", async () => {
    const fetchImpl = (async () => new Response("busy", { status: 504 })) as unknown as typeof fetch;
    await expect(lookupFootprints(center, 150, { env: {}, fetchImpl })).rejects.toThrow(/overpass-api\.de: 504.*overpass\.private\.coffee: 504.*tiles: TileJSON 504/);
  });
});
