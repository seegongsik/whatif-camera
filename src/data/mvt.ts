/**
 * Building footprints from a Mapbox Vector Tile (spec 2.1), as served by
 * OpenMapTiles-schema tile servers: the "building" layer, polygons in tile
 * coordinates, and render_height. A small protobuf reader covers the few
 * message types the format uses.
 */
import type { LatLon } from "../geo/enu.js";
import type { FootprintRecord } from "./footprints.js";

class Reader {
  pos = 0;
  constructor(
    readonly buf: Uint8Array,
    readonly end = buf.length,
  ) {}

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new RangeError("truncated varint");
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return result;
      shift += 7;
      if (shift > 63) throw new RangeError("varint too long");
    }
  }

  bytes(): Uint8Array {
    const len = this.varint();
    if (this.pos + len > this.end) throw new RangeError("truncated field");
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  packed(): number[] {
    const len = this.varint();
    const stop = this.pos + len;
    const out: number[] = [];
    while (this.pos < stop) out.push(this.varint());
    return out;
  }

  fixed(size: 4 | 8): number {
    if (this.pos + size > this.end) throw new RangeError("truncated fixed field");
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, size);
    this.pos += size;
    return size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new RangeError(`unsupported wire type ${wire}`);
  }
}

export type Value = string | number | boolean;

function readValue(bytes: Uint8Array): Value | undefined {
  const r = new Reader(bytes);
  let value: Value | undefined;
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1 && wire === 2) value = new TextDecoder().decode(r.bytes());
    else if (field === 2 && wire === 5) value = r.fixed(4);
    else if (field === 3 && wire === 1) value = r.fixed(8);
    else if ((field === 4 || field === 5) && wire === 0) value = r.varint();
    else if (field === 6 && wire === 0) {
      const n = r.varint();
      value = n % 2 === 0 ? n / 2 : -(n + 1) / 2;
    } else if (field === 7 && wire === 0) value = r.varint() !== 0;
    else r.skip(wire);
  }
  return value;
}

type Feature = { type: number; tags: number[]; geometry: number[] };
type Layer = { name: string; extent: number; keys: string[]; values: (Value | undefined)[]; features: Feature[] };

function readFeature(bytes: Uint8Array): Feature {
  const r = new Reader(bytes);
  const f: Feature = { type: 0, tags: [], geometry: [] };
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 2 && wire === 2) f.tags = r.packed();
    else if (field === 3 && wire === 0) f.type = r.varint();
    else if (field === 4 && wire === 2) f.geometry = r.packed();
    else r.skip(wire);
  }
  return f;
}

function readLayer(bytes: Uint8Array): Layer {
  const r = new Reader(bytes);
  const layer: Layer = { name: "", extent: 4096, keys: [], values: [], features: [] };
  const raw: Uint8Array[] = [];
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field === 1 && wire === 2) layer.name = new TextDecoder().decode(r.bytes());
    else if (field === 2 && wire === 2) raw.push(r.bytes());
    else if (field === 3 && wire === 2) layer.keys.push(new TextDecoder().decode(r.bytes()));
    else if (field === 4 && wire === 2) layer.values.push(readValue(r.bytes()));
    else if (field === 5 && wire === 0) layer.extent = r.varint();
    else r.skip(wire);
  }
  layer.features = raw.map(readFeature);
  return layer;
}

export function readLayers(tile: Uint8Array): Layer[] {
  const r = new Reader(tile);
  const layers: Layer[] = [];
  while (r.pos < r.end) {
    const tag = r.varint();
    if (Math.floor(tag / 8) === 3 && tag % 8 === 2) layers.push(readLayer(r.bytes()));
    else r.skip(tag % 8);
  }
  return layers;
}

function zigzag(n: number): number {
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
}

/** Polygon rings in tile coordinates; exterior rings come out with positive area (clockwise with y down). */
export function polygonRings(geometry: number[]): { x: number; y: number }[][] {
  const rings: { x: number; y: number }[][] = [];
  let ring: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  while (i < geometry.length) {
    const command = geometry[i++];
    const id = command & 0x7;
    const count = Math.floor(command / 8);
    if (id === 1 || id === 2) {
      for (let k = 0; k < count && i + 1 < geometry.length; k += 1) {
        x += zigzag(geometry[i++]);
        y += zigzag(geometry[i++]);
        if (id === 1) ring = [{ x, y }];
        else ring.push({ x, y });
      }
    } else if (id === 7) {
      if (ring.length >= 3) rings.push(ring);
      ring = [];
    } else break;
  }
  return rings;
}

function ringArea(ring: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function tileToLatLon(z: number, tx: number, ty: number, px: number, py: number, extent: number): LatLon {
  const n = 2 ** z;
  const xf = (tx + px / extent) / n;
  const yf = (ty + py / extent) / n;
  return { lon: xf * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * yf))) * 180) / Math.PI };
}

/** Fractional tile coordinates of a point. */
export function latLonToTile(z: number, p: LatLon): { x: number; y: number } {
  const n = 2 ** z;
  const lat = (p.lat * Math.PI) / 180;
  return {
    x: ((p.lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  };
}

/** One feature of a named layer, with its properties decoded. */
export type TileFeature = { type: number; props: Record<string, Value | undefined>; geometry: number[] };

export function layerFeatures(tile: Uint8Array, name: string): { extent: number; features: TileFeature[] } | null {
  const layer = readLayers(tile).find((l) => l.name === name);
  if (!layer) return null;
  const features = layer.features.map((f) => {
    const props: Record<string, Value | undefined> = {};
    for (let k = 0; k + 1 < f.tags.length; k += 2) props[layer.keys[f.tags[k]]] = layer.values[f.tags[k + 1]];
    return { type: f.type, props, geometry: f.geometry };
  });
  return { extent: layer.extent, features };
}

/** Line strings (type 2) or points (type 1) of a feature, in tile coordinates. */
export function geometryParts(geometry: number[]): { x: number; y: number }[][] {
  const parts: { x: number; y: number }[][] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  while (i < geometry.length) {
    const command = geometry[i++];
    const id = command & 0x7;
    const count = Math.floor(command / 8);
    if (id === 1 || id === 2) {
      for (let k = 0; k < count && i + 1 < geometry.length; k += 1) {
        x += zigzag(geometry[i++]);
        y += zigzag(geometry[i++]);
        if (id === 1) parts.push([{ x, y }]);
        else parts[parts.length - 1]?.push({ x, y });
      }
    } else if (id !== 7) break;
  }
  return parts;
}

/** render_height the OpenMapTiles schema fills in when a building has no height or levels in OpenStreetMap. */
export const TILE_DEFAULT_HEIGHT_M = 5;

/** Building footprints of the "building" layer of one tile; multipolygon parts become separate records. */
export function buildingsFromTile(tile: Uint8Array, z: number, tx: number, ty: number): FootprintRecord[] {
  const layer = readLayers(tile).find((l) => l.name === "building");
  if (!layer) return [];
  const out: FootprintRecord[] = [];
  layer.features.forEach((f, index) => {
    if (f.type !== 3) return;
    const props: Record<string, Value | undefined> = {};
    for (let k = 0; k + 1 < f.tags.length; k += 2) props[layer.keys[f.tags[k]]] = layer.values[f.tags[k + 1]];
    // OpenMapTiles writes 5 m when OpenStreetMap has neither height nor levels: that is "unknown".
    const raw = props.render_height;
    const height = typeof raw === "number" && raw > 0 && raw !== TILE_DEFAULT_HEIGHT_M ? raw : undefined;
    let part = 0;
    for (const ring of polygonRings(f.geometry)) {
      if (ringArea(ring) <= 0) continue;
      out.push({
        id: `tile/${z}/${tx}/${ty}/${index}/${part}`,
        ring: ring.map((p) => tileToLatLon(z, tx, ty, p.x, p.y, layer.extent)),
        tags: height !== undefined ? { tileHeightM: height } : {},
      });
      part += 1;
    }
  });
  return out;
}
