/**
 * Overture Maps places along a street. The release's Parquet files sit in a
 * public bucket; server/data/overture-places.ts says which row groups hold
 * places inside which box, so only the row groups that meet the street are
 * read, with range requests, and only the columns the street needs. Each
 * file's footer is cached per server instance.
 */
import zlib from "node:zlib";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects, type FileMetaData } from "hyparquet";
import type { Box } from "../src/street/overpass.js";
import type { Shop } from "../src/street/osm.js";
import { shopFromOverture, type OvertureRow } from "../src/street/overture.js";
import { OVERTURE_PLACES, type OverturePlacesIndex } from "./data/overture-places.js";

/** Columns read for each place; the rest (addresses, phones, sources, geometry, …) are never fetched. */
export const OVERTURE_COLUMNS = ["names", "basic_category", "taxonomy", "confidence", "websites", "socials", "brand", "bbox", "operating_status"];
/** A long street through a dense city meets a few dozen row groups; never read more than this. */
export const MAX_GROUPS = 40;
const READ_TIMEOUT_MS = 20_000;

export type GroupRef = { file: number; group: number; rowStart: number; rowEnd: number };

/** Row groups whose box meets any of the boxes, nearest the first box first. */
export function groupsFor(index: OverturePlacesIndex, boxes: Box[]): GroupRef[] {
  const out: (GroupRef & { order: number })[] = [];
  index.files.forEach((f, file) => {
    let rowStart = 0;
    for (let i = 0; i + 4 < f.groups.length; i += 5) {
      const [rows, west, south, east, north] = f.groups.slice(i, i + 5);
      const order = boxes.findIndex((b) => west <= b.east && east >= b.west && south <= b.north && north >= b.south);
      if (order >= 0) out.push({ file, group: i / 5, rowStart, rowEnd: rowStart + rows, order });
      rowStart += rows;
    }
  });
  return out
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_GROUPS)
    .map(({ order: _order, ...ref }) => ref);
}

const inside = (boxes: Box[], lat: number, lon: number) => boxes.some((b) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east);

export type ReadGroup = (ref: GroupRef) => Promise<OvertureRow[]>;

/** Node's own zstd (Node 22.15 and later); Overture's files are zstd-compressed. */
function zstd(input: Uint8Array): Uint8Array {
  const out = zlib.zstdDecompressSync(input);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

const footers = new Map<string, Promise<FileMetaData>>();

/** Reads one row group's places from the bucket. */
export function bucketReader(index: OverturePlacesIndex = OVERTURE_PLACES, fetchImpl?: typeof fetch): ReadGroup {
  if (typeof zlib.zstdDecompressSync !== "function") throw new Error("this Node.js has no zstd (needs 22.15 or later)");
  return async (ref) => {
    const f = index.files[ref.file];
    const url = index.base + f.key;
    const file = await asyncBufferFromUrl({ url, byteLength: f.size, requestInit: { signal: AbortSignal.timeout(READ_TIMEOUT_MS) }, fetch: fetchImpl });
    let metadata = footers.get(url);
    if (!metadata) {
      metadata = parquetMetadataAsync(file);
      footers.set(url, metadata);
      metadata.catch(() => footers.delete(url));
    }
    return (await parquetReadObjects({
      file,
      metadata: await metadata,
      columns: OVERTURE_COLUMNS,
      rowStart: ref.rowStart,
      rowEnd: ref.rowEnd,
      compressors: { ZSTD: zstd },
    })) as OvertureRow[];
  };
}

/** Places from the row groups that meet the boxes, kept when they fall inside one; read a few groups at a time. */
export async function overturePlaces(boxes: Box[], read: ReadGroup, index: OverturePlacesIndex = OVERTURE_PLACES): Promise<{ shops: Shop[]; groups: number }> {
  const refs = groupsFor(index, boxes);
  const shops: Shop[] = [];
  for (let i = 0; i < refs.length; i += 6) {
    const batch = refs.slice(i, i + 6);
    const rows = await Promise.all(batch.map((ref) => read(ref)));
    batch.forEach((ref, k) => {
      rows[k].forEach((row, r) => {
        const lat = row.bbox?.ymin;
        const lon = row.bbox?.xmin;
        if (typeof lat !== "number" || typeof lon !== "number" || !inside(boxes, lat, lon)) return;
        const shop = shopFromOverture(`ovt/${ref.file}/${ref.group}/${r}`, row);
        if (shop) shops.push(shop);
      });
    });
  }
  return { shops, groups: refs.length };
}

export function clearOvertureCachesForTests(): void {
  footers.clear();
}
