import { describe, expect, it } from "vitest";
import { geometryParts, latLonToTile, layerFeatures, tileToLatLon } from "../src/data/mvt.js";
import { overpassUrls } from "../server/upstream.js";

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

/** A line: MoveTo its first point, one LineTo with a count for the rest. */
function lineGeometry(points: [number, number][]): number[] {
  const [x0, y0] = points[0];
  const out = [1 | (1 << 3), zz(x0), zz(y0), 2 | ((points.length - 1) << 3)];
  let [cx, cy] = [x0, y0];
  for (const [x, y] of points.slice(1)) {
    out.push(zz(x - cx), zz(y - cy));
    [cx, cy] = [x, y];
  }
  return out;
}

/** One layer of line features, each with a "name" property. */
function tileBytes(name: string, features: { name: string; points: [number, number][] }[]): Uint8Array {
  const layer: number[] = [...lenDelim(1, text(name))];
  features.forEach((f, i) => layer.push(...lenDelim(2, [...packed(2, [0, i]), ...key(3, 0), ...varint(2), ...packed(4, lineGeometry(f.points))])));
  layer.push(...lenDelim(3, text("name")));
  for (const f of features) layer.push(...lenDelim(4, lenDelim(1, text(f.name))));
  layer.push(...key(5, 0), ...varint(4096), ...key(15, 0), ...varint(2));
  return new Uint8Array(lenDelim(3, layer));
}

describe("vector tiles (SYNTHETIC tile)", () => {
  it("round-trips tile and geographic coordinates", () => {
    const t = latLonToTile(14, center);
    const p = tileToLatLon(14, Math.floor(t.x), Math.floor(t.y), Math.round((t.x - Math.floor(t.x)) * 4096), Math.round((t.y - Math.floor(t.y)) * 4096), 4096);
    expect(p.lat).toBeCloseTo(center.lat, 4);
    expect(p.lon).toBeCloseTo(center.lon, 4);
  });

  it("reads a layer's features with their properties, and lines whose commands repeat", () => {
    const tile = tileBytes("transportation_name", [
      { name: "Main Street", points: [[10, 10], [200, 10], [400, 30]] },
      { name: "Side Lane", points: [[50, 50], [50, 300]] },
    ]);
    const layer = layerFeatures(tile, "transportation_name")!;
    expect(layer.extent).toBe(4096);
    expect(layer.features.map((f) => f.props.name)).toEqual(["Main Street", "Side Lane"]);
    expect(geometryParts(layer.features[0].geometry)).toEqual([
      [
        { x: 10, y: 10 },
        { x: 200, y: 10 },
        { x: 400, y: 30 },
      ],
    ]);
    expect(layerFeatures(tile, "poi")).toBeNull();
  });
});

describe("the services the street reads", () => {
  it("lists configured Overpass URLs before the defaults, HTTPS only", () => {
    const urls = overpassUrls({ OVERPASS_URLS: "https://a.example/api/interpreter, http://plain.example/x" });
    expect(urls[0]).toBe("https://a.example/api/interpreter");
    expect(urls).not.toContain("http://plain.example/x");
    expect(urls).toContain("https://overpass-api.de/api/interpreter");
  });
});
