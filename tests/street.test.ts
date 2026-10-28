import { describe, expect, it } from "vitest";
import { localFrame, toLocal } from "../src/geo/enu.js";
import { categorize, shopFromTags, shopsFromOverpass, socialUrl, waysFromOverpass } from "../src/street/osm.js";
import { followRoute, matchStreet, placeOnRoute, simplify, type LocalWay } from "../src/street/route.js";
import { namedStreetQuery, piecesOf, shopsAlongQuery } from "../src/street/overpass.js";
import { buildStreetAhead } from "../src/street/street.js";
import {
  SYNTHETIC_CAPTURE,
  SYNTHETIC_STREET_NAME,
  SYNTHETIC_STREET_ORIGIN,
  syntheticShopsJson,
  syntheticWaysJson,
} from "../src/street/synthetic.js";

const frame = localFrame(SYNTHETIC_STREET_ORIGIN);
const ways = waysFromOverpass(syntheticWaysJson());
const shops = shopsFromOverpass(syntheticShopsJson());
const localWays: LocalWay[] = ways.map((w) => ({ ...w, points: w.points.map((p) => toLocal(frame, p)) }));

describe("OpenStreetMap shops", () => {
  it("keeps shops, restaurants and hotels, not parking or benches", () => {
    expect(categorize({ amenity: "cafe" })).toEqual({ category: "cafe", kind: "amenity=cafe" });
    expect(categorize({ shop: "shoes" })?.category).toBe("fashion");
    expect(categorize({ shop: "hardware" })?.category).toBe("shop");
    expect(categorize({ tourism: "hotel" })?.category).toBe("stay");
    expect(categorize({ amenity: "parking" })).toBeNull();
    expect(categorize({ shop: "vacant" })).toBeNull();
  });

  it("turns handles and links into Instagram and Facebook URLs, and nothing else", () => {
    expect(socialUrl("@cup.house", "instagram.com")).toBe("https://instagram.com/cup.house");
    expect(socialUrl("https://www.instagram.com/cup.house/", "instagram.com")).toBe("https://instagram.com/cup.house/");
    expect(socialUrl("https://evil.example/instagram.com", "instagram.com")).toBeUndefined();
    expect(socialUrl("not a handle!", "facebook.com")).toBeUndefined();
  });

  it("needs a name (or a brand) to show a shop", () => {
    expect(shopFromTags("node/1", { lat: 0, lon: 0 }, { shop: "bakery" })).toBeNull();
    expect(shopFromTags("node/2", { lat: 0, lon: 0 }, { shop: "bakery", brand: "Rise" })?.name).toBe("Rise");
  });

  it("reads ways with their nodes and shops from nodes and building centres (SYNTHETIC)", () => {
    expect(ways).toHaveLength(8);
    expect(ways[0].nodes).toHaveLength(3);
    expect(shops.some((s) => s.id === "way/950001")).toBe(true);
    expect(shops.find((s) => s.name === "Morning Cup")?.instagram).toBe("https://instagram.com/morningcup.synthetic");
  });
});

describe("the street ahead (SYNTHETIC)", () => {
  it("matches the avenue the camera looks along, and no street when it faces a wall", () => {
    const m = matchStreet(localWays, 4);
    expect(m).not.toBeNull();
    expect(localWays[m!.way].name).toBe(SYNTHETIC_STREET_NAME);
    expect(m!.forward).toBe(true);
    expect(m!.distanceM).toBeCloseTo(0, 6);
    expect(matchStreet(localWays, 75)).toBeNull();
    expect(matchStreet(localWays, 184)?.forward).toBe(false);
  });

  it("widens the search when the GPS fix is off the street, and takes a named street first", () => {
    const from = (dx: number): LocalWay[] => localWays.map((w) => ({ ...w, points: w.points.map((p) => ({ x: p.x - dx, y: p.y })) }));
    // 90 m east of the avenue: beyond the near radius, inside the wide one.
    const m = matchStreet(from(90), 4);
    expect(localWays[m!.way].name).toBe(SYNTHETIC_STREET_NAME);
    expect(m!.distanceM).toBeCloseTo(90, 6);
    expect(matchStreet(from(150), 4)).toBeNull();
    // Two parallel streets: the nearer one, unless the name given says otherwise.
    const parallel: LocalWay[] = [
      { id: "a", name: "A Street", highway: "primary", points: [{ x: -60, y: -100 }, { x: -60, y: 400 }] },
      { id: "b", name: "B Street", highway: "primary", points: [{ x: 40, y: -100 }, { x: 40, y: 400 }] },
    ];
    expect(parallel[matchStreet(parallel, 0)!.way].name).toBe("B Street");
    expect(parallel[matchStreet(parallel, 0, "a street")!.way].name).toBe("A Street");
    expect(parallel[matchStreet(parallel, 0, "C Street")!.way].name).toBe("B Street");
  });

  it("asks Overpass with boxes: around the camera for the named street, every 250 m along it for shops", () => {
    // 5.3 km each way: 0.0476° of latitude, 0.0600° of longitude at 37.5° N.
    expect(namedStreetQuery({ lat: 37.5, lon: 127 }, "name", 'Main "Street"', 5300)).toContain('way[highway][name="Main \\"Street\\""](37.452390,126.939988,37.547610,127.060012)');
    const line = [
      { lat: 37.5, lon: 127 },
      { lat: 37.545, lon: 127 },
    ];
    const pieces = piecesOf(line, 250);
    expect(pieces).toHaveLength(21);
    expect(pieces[0][1].lat - pieces[0][0].lat).toBeCloseTo(250 / 111_320, 9);
    const query = shopsAlongQuery(line, 65);
    expect(query.match(/nwr\[/g)).toHaveLength(21 * 4);
    expect(query).not.toContain("around");
  });

  it("follows the avenue through its bend instead of the side road that carries straight on", () => {
    const route = followRoute(localWays, matchStreet(localWays, 4)!, 5000);
    expect(route.wayIds).toEqual(["way/101", "way/102", "way/103", "way/104", "way/105"]);
    expect(route.length).toBeCloseTo(5000, 6);
    expect(route.along[0]).toBeCloseTo(-20, 6);
    // 3.8 km past the bend the avenue runs 20° east of north.
    const end = route.points[route.points.length - 1];
    expect(end.x).toBeGreaterThan(1000);
  });

  it("stops where the street ends", () => {
    const route = followRoute(localWays, matchStreet(localWays, 4)!, 10_000);
    expect(route.length).toBeCloseTo(1200 + 4400, 3);
  });

  it("places a point by distance ahead and side of the street", () => {
    const route = followRoute(localWays, matchStreet(localWays, 4)!, 5000);
    const right = placeOnRoute(route, { x: 20, y: 500 });
    expect(right!.s).toBeCloseTo(500, 6);
    expect(right!.offset).toBeCloseTo(20, 6);
    expect(placeOnRoute(route, { x: -15, y: 900 })!.offset).toBeCloseTo(-15, 6);
    expect(placeOnRoute(route, { x: 0, y: -300 })).toBeNull();
  });

  it("lists the shops along the street in order, once each, and leaves out the far one", () => {
    const street = buildStreetAhead({
      origin: SYNTHETIC_CAPTURE.position,
      headingDeg: SYNTHETIC_CAPTURE.headingDeg,
      ways,
      shops,
      source: "SYNTHETIC",
      attribution: "SYNTHETIC",
      fetchedAt: "2026-10-28T00:00:00Z",
      synthetic: true,
    })!;
    expect(street.name).toBe(SYNTHETIC_STREET_NAME);
    expect(street.streetDistanceM).toBeCloseTo(6, 3);
    const s = street.shops.map((x) => x.s);
    expect(s).toEqual([...s].sort((a, b) => a - b));
    expect(street.shops.filter((x) => x.name === "Morning Cup")).toHaveLength(1);
    expect(street.shops.find((x) => x.name === "Morning Cup")!.website).toBe("https://example.org");
    expect(street.shops.some((x) => x.name === "Far Away Flowers")).toBe(false);
    expect(street.shops[0].side).toBe("right");
    expect(street.shops[1].side).toBe("left");
    expect(Math.max(...s)).toBeLessThanOrEqual(5000);
    // Every 60 m, alternating sides, from 10 m behind to 5 km ahead (the camera stands 6 m east of the line).
    expect(street.shops.length).toBeGreaterThan(80);
  });

  it("simplifies a polyline without moving it more than the tolerance", () => {
    const line = Array.from({ length: 101 }, (_, i) => ({ x: i * 10, y: Math.sin(i / 3) * 0.5 }));
    const simple = simplify(line, 1);
    expect(simple.length).toBe(2);
    expect(simplify(line, 0.1).length).toBeGreaterThan(10);
  });
});
