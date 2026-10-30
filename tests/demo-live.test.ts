// Opens every demo street on the deployment the way a visitor's page does: the
// street, then Muse Spark's picks along it, both by GET so the CDN keeps them.
// Run it after each deployment (a new one starts with an empty cache): the
// first visitor then finds every demo street waiting. Checks what a judge
// would see: the street, its places, landmarks that are places on it.
// Network only when asked: npm run check:demo (DEMO_LIVE=1, or DEMO_LIVE=<base URL>).
import { describe, expect, it } from "vitest";
import { FAMOUS_STREETS } from "../src/street/famous.js";
import type { Picks } from "../src/street/picks.js";
import type { StreetAhead } from "../src/street/street.js";

const live = process.env.DEMO_LIVE;
const base = live === "1" ? "https://whatif-camera.vercel.app" : live;

async function timed(url: string): Promise<{ res: Response; ms: number; cache: string }> {
  const started = Date.now();
  const res = await fetch(url);
  return { res, ms: Date.now() - started, cache: res.headers.get("x-vercel-cache") ?? "no CDN" };
}

describe.skipIf(!base)("demo streets on the deployment (live)", () => {
  it.each(FAMOUS_STREETS.map((s) => [s.short, s] as const))(
    "%s: the street, its places and Muse Spark's landmarks",
    async (_name, demo) => {
      const query = new URLSearchParams({ lat: String(demo.lat), lon: String(demo.lon), heading: String(demo.headingDeg), street: demo.street });
      const street = await timed(`${base}/api/street?${query}`);
      expect(street.res.status).toBe(200);
      const body = (await street.res.json()) as StreetAhead;
      expect(body.shops.length).toBeGreaterThan(50);
      const picks = await timed(`${base}/api/landmarks?demo=${demo.id}`);
      expect(picks.res.status).toBe(200);
      const answer = (await picks.res.json()) as { picks: Picks; latencyMs: number };
      const byId = new Map(body.shops.map((s) => [s.id, s]));
      const named = answer.picks.landmarks.map((l) => byId.get(l.id));
      // Every landmark is a place on the street the page shows, and there are enough to stop at.
      expect(named.every(Boolean)).toBe(true);
      expect(named.length).toBeGreaterThanOrEqual(3);
      // No web address standing in for a name (DECISIONS D36).
      expect(named.filter((s) => /\.(com|org|net)\b/i.test(s!.name))).toEqual([]);
      const list = answer.picks.landmarks.map((l) => `${byId.get(l.id)!.name} (${l.why})`).join(", ");
      console.log(
        `${demo.short}: street ${street.ms} ms (${street.cache}), ${body.shops.length} places, ${(body.route.length / 1000).toFixed(1)} km; ` +
          `picks ${picks.ms} ms (${picks.cache}, model ${(answer.latencyMs / 1000).toFixed(1)} s): ${list}`,
      );
    },
    90_000,
  );
});
