import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { buildOverpassQuery, parseLengthTag, parseOverpass } from "../src/data/overpass.js";
import { localFrame } from "../src/geo/enu.js";
import { toLocalFootprints } from "../src/data/footprints.js";
import { handleDesign, handleFootprints, handleStatus } from "../server/routes.js";
import { clearFootprintCacheForTests } from "../server/overpass-client.js";
import { resetLimitsForTests } from "../server/limits.js";
import { firstJsonObject } from "../server/spark.js";
import { buildDesignMessages } from "../server/design.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/overpass-synthetic.json", import.meta.url), "utf8"));
const center = { lat: 37.5, lon: 127.0 };

describe("overpass parsing (SYNTHETIC fixture)", () => {
  it("keeps closed building ways and closed outer rings, with tags", () => {
    const set = parseOverpass(fixture, { center, radiusM: 150, fetchedAt: "2026-10-27T00:00:00Z" });
    expect(set.buildings.map((b) => b.id)).toEqual(["way/1001", "way/1002", "relation/2001/0"]);
    const apartments = set.buildings[0];
    expect(apartments.ring).toHaveLength(4);
    expect(apartments.tags).toEqual({ kind: "apartments", levels: 6, heightM: 18.5 });
    expect(set.buildings[1].tags.heightM).toBeCloseTo(12.192, 3);
    expect(set.buildings[2].tags).toEqual({ kind: "retail", levels: 2 });
    expect(set.attribution).toContain("OpenStreetMap");
  });

  it("turns the rings into counter-clockwise local polygons with areas", () => {
    const set = parseOverpass(fixture, { center, radiusM: 150, fetchedAt: "2026-10-27T00:00:00Z" });
    const local = toLocalFootprints(set, localFrame(center));
    const a = local.find((f) => f.id === "way/1001")!;
    // 0.0002° of longitude by 0.00012° of latitude at 37.5° N.
    expect(a.areaM2).toBeGreaterThan(17.6 * 13.2 * 0.98);
    expect(a.areaM2).toBeLessThan(17.8 * 13.4 * 1.02);
  });

  it("reads lengths in metres and feet, and rejects words", () => {
    expect(parseLengthTag("12")).toBe(12);
    expect(parseLengthTag("12.5 m")).toBe(12.5);
    expect(parseLengthTag("40 ft")).toBeCloseTo(12.192);
    expect(parseLengthTag("tall")).toBeUndefined();
  });

  it("asks for ways and multipolygons around the point", () => {
    const q = buildOverpassQuery(center, 150);
    expect(q).toContain('way["building"](around:150,37.500000,127.000000)');
    expect(q).toContain("out tags geom;");
  });
});

describe("routes", () => {
  beforeEach(() => {
    clearFootprintCacheForTests();
    resetLimitsForTests();
  });

  it("reports which keys exist without revealing them", async () => {
    const res = await handleStatus(new Request("http://x/api/status"), { env: { BASETEN_API_KEY: "secret-value" } });
    const body = await res.json();
    expect(body).toEqual({ ok: true, basetenApiKeyConfigured: true, modelApiKeyConfigured: false });
    expect(JSON.stringify(body)).not.toContain("secret-value");
  });

  it("validates footprint queries", async () => {
    const res = await handleFootprints(new Request("http://x/api/footprints?lat=95&lon=0"), { env: {} });
    expect(res.status).toBe(400);
  });

  it("fetches and parses footprints once, then serves the cache", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      expect(String(init?.body)).toContain("data=");
      return Response.json(fixture);
    }) as typeof fetch;
    const url = "http://x/api/footprints?lat=37.5&lon=127&radius=150";
    const first = await handleFootprints(new Request(url), { env: {}, fetchImpl });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.buildings).toHaveLength(3);
    await handleFootprints(new Request(url), { env: {}, fetchImpl });
    expect(calls).toBe(1);
  });

  it("passes an Overpass failure through as a gateway error", async () => {
    const fetchImpl = (async () => new Response("busy", { status: 504 })) as unknown as typeof fetch;
    const res = await handleFootprints(new Request("http://x/api/footprints?lat=37.5&lon=127"), { env: {}, fetchImpl });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("504");
  });

  const facts = {
    heightM: 18.6,
    floors: 6,
    roofAreaM2: 216,
    widthM: 18,
    depthM: 12,
    mainFacadeFacing: "south",
    hemisphere: "north",
  };

  it("says when the design model has no key, so the page uses its local plan", async () => {
    const res = await handleDesign(
      new Request("http://x/api/design", { method: "POST", body: JSON.stringify({ facts }) }),
      { env: {} },
    );
    expect(res.status).toBe(503);
  });

  it("turns a model reply into a checked plan", async () => {
    const reply = {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              'Here you go:\n```json\n{"title":"Sky garden 2027","captions":["What if 6 floors bloomed?"],' +
              '"palette":{"accent":"#AA5500","wood":"not a colour"},"roof":{"deck":true,"planters":"edge","trees":11,' +
              '"pergola":true,"seating":true,"stringLights":true},"facade":{"vines":"everywhere","windowBoxes":false,' +
              '"awning":false,"washLights":true},"rationale":"Big flat roof."}\n```',
          },
        },
      ],
    };
    let sent: Record<string, unknown> | null = null;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json(reply);
    }) as typeof fetch;
    const res = await handleDesign(
      new Request("http://x/api/design", {
        method: "POST",
        body: JSON.stringify({ facts, image: "data:image/jpeg;base64,AAAA" }),
      }),
      { env: { BASETEN_API_KEY: "k" }, fetchImpl },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sent!.model).toBe("meta-models/muse-spark-open-1026");
    expect(body.plan.source).toBe("muse-spark-open");
    // Digits are stripped from text; numbers on screen come from the spec.
    expect(body.plan.title).toBe("Sky garden");
    expect(body.plan.captions[0]).toBe("What if floors bloomed?");
    expect(body.plan.palette.accent).toBe("#aa5500");
    expect(body.plan.palette.wood).toBe("#b07a4a");
    expect(body.plan.roof.trees).toBe(6);
    expect(body.plan.facade.vines).toBe("corners");
  });

  it("rejects an oversized or non-image upload", async () => {
    const res = await handleDesign(
      new Request("http://x/api/design", { method: "POST", body: JSON.stringify({ facts, image: "http://example.com/a.jpg" }) }),
      { env: { BASETEN_API_KEY: "k" } },
    );
    expect(res.status).toBe(400);
  });
});

describe("model reply helpers", () => {
  it("finds the first JSON object even with braces inside strings", () => {
    expect(firstJsonObject('note {"a":"}{","b":{"c":1}} tail')).toEqual({ a: "}{", b: { c: 1 } });
  });

  it("sends the photo with the facts", () => {
    const messages = buildDesignMessages(
      {
        heightM: 10,
        floors: 3,
        roofAreaM2: 80,
        widthM: 10,
        depthM: 8,
        mainFacadeFacing: "east",
        hemisphere: "north",
      },
      "data:image/jpeg;base64,AAAA",
    );
    const user = messages[1];
    expect(Array.isArray(user.content) && user.content.some((p) => p.type === "image_url")).toBe(true);
  });
});
