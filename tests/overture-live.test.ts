// Reads real Overture places for a stretch of Gangnam-daero from the public bucket.
// Network only when asked: OVERTURE_LIVE=1 npx vitest run tests/overture-live.test.ts
import { describe, expect, it } from "vitest";
import { boxAround, piecesOf } from "../src/street/overpass.js";
import { bucketReader, overturePlaces } from "../server/overture.js";

const GANGNAM_DAERO = [
  { lat: 37.498353, lon: 127.027553 },
  { lat: 37.502649, lon: 127.025535 },
  { lat: 37.507075, lon: 127.023379 },
  { lat: 37.511973, lon: 127.021008 },
  { lat: 37.516411, lon: 127.01957 },
  { lat: 37.52164, lon: 127.01795 },
  { lat: 37.525533, lon: 127.014651 },
  { lat: 37.530302, lon: 127.010182 },
  { lat: 37.535373, lon: 127.006239 },
  { lat: 37.539056, lon: 127.004277 },
];

/** Fifth Avenue from 42nd Street, 5 km at the grid's 29°. */
const FIFTH_AVENUE = Array.from({ length: 11 }, (_, i) => ({ lat: 40.7536 + (i * 0.003929), lon: -73.9807 + i * 0.002874 }));

describe.skipIf(!process.env.OVERTURE_LIVE)("Overture places from the bucket (live)", () => {
  it.each([
    ["Gangnam-daero", GANGNAM_DAERO],
    ["Fifth Avenue", FIFTH_AVENUE],
  ])("reads the places along %s", async (_name, line) => {
    const boxes = piecesOf(line, 250).map((p) => boxAround(p, 65));
    const started = Date.now();
    const { shops, groups } = await overturePlaces(boxes, bucketReader());
    const ms = Date.now() - started;
    const facebook = shops.filter((s) => s.facebook).length;
    const website = shops.filter((s) => s.website).length;
    const byCategory: Record<string, number> = {};
    for (const s of shops) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
    console.log({ ms, groups, shops: shops.length, facebook, website, byCategory, sample: shops.slice(0, 12).map((s) => `${s.name} · ${s.kind} · ${s.confidence?.toFixed(2)}`) });
    expect(shops.length).toBeGreaterThan(50);
  }, 120_000);
});
