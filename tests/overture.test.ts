import { describe, expect, it } from "vitest";
import { categoryForOverture, shopFromOverture, shopRank, webLink, type OvertureRow } from "../src/street/overture.js";
import { groupsFor, overturePlaces, type GroupRef } from "../server/overture.js";
import type { OverturePlacesIndex } from "../server/data/overture-places.js";

// SYNTHETIC rows in the shape Overture's Parquet files give them.
const row = (over: Partial<OvertureRow> = {}): OvertureRow => ({
  names: { primary: "Corner Noodles" },
  basic_category: "restaurant",
  taxonomy: { primary: "korean_restaurant" },
  confidence: 0.8,
  websites: ["https://corner.example/"],
  socials: ["https://www.facebook.com/1234", "https://www.instagram.com/corner.example"],
  brand: null,
  bbox: { xmin: 127.0001, ymin: 37.5002 },
  operating_status: null,
  ...over,
});

describe("Overture places (SYNTHETIC rows)", () => {
  it("keeps street-level kinds and leaves offices, schools and hospitals out", () => {
    expect(categoryForOverture("coffee_shop")).toEqual({ category: "cafe", kind: "category=coffee_shop" });
    expect(categoryForOverture("restaurant", "korean_restaurant")).toEqual({ category: "food", kind: "category=korean_restaurant" });
    expect(categoryForOverture("restaurant", "<script>")?.kind).toBe("category=restaurant");
    for (const left of ["professional_service", "corporate_or_business_office", "hospital", "specialty_school", "real_estate_service", "atm", null, 7]) {
      expect(categoryForOverture(left)).toBeNull();
    }
  });

  it("turns a row into a shop with its Facebook page, Instagram and website", () => {
    const shop = shopFromOverture("ovt/1/2/3", row())!;
    expect(shop).toMatchObject({
      id: "ovt/1/2/3",
      name: "Corner Noodles",
      category: "food",
      kind: "category=korean_restaurant",
      cuisine: "korean",
      point: { lat: 37.5002, lon: 127.0001 },
      website: "https://corner.example/",
      facebook: "https://www.facebook.com/1234",
      instagram: "https://www.instagram.com/corner.example",
      confidence: 0.8,
    });
  });

  it("leaves out unnamed, closed, unlikely and unplaced rows, and links that are not web links", () => {
    expect(shopFromOverture("a", row({ names: { primary: " " } }))).toBeNull();
    expect(shopFromOverture("b", row({ operating_status: "permanently_closed" }))).toBeNull();
    expect(shopFromOverture("c", row({ confidence: 0.3 }))).toBeNull();
    expect(shopFromOverture("d", row({ bbox: null }))).toBeNull();
    const odd = shopFromOverture("e", row({ websites: ["javascript:alert(1)"], socials: ["https://facebook.com.evil.example/x"] }))!;
    expect(odd.website).toBeUndefined();
    expect(odd.facebook).toBeUndefined();
    expect(webLink("http://example.org/a")).toBe("http://example.org/a");
    expect(webLink("https://m.facebook.com/x", "facebook.com")).toBe("https://m.facebook.com/x");
  });

  it("ranks by confidence, then links", () => {
    const a = shopFromOverture("a", row({ confidence: 0.9, socials: [], websites: [] }))!;
    const b = shopFromOverture("b", row({ confidence: 0.85 }))!;
    expect(shopRank(b)).toBeGreaterThan(shopRank(a));
  });
});

describe("reading Overture row groups (SYNTHETIC index)", () => {
  const index: OverturePlacesIndex = {
    release: "SYNTHETIC",
    base: "https://bucket.example/",
    files: [
      // rows, west, south, east, north
      { key: "a.parquet", size: 1, groups: [10, 126.9, 37.4, 127.1, 37.6, 20, 0, 0, 1, 1] },
      { key: "b.parquet", size: 1, groups: [5, -74, 40.7, -73.9, 40.8, 7, 127.002, 37.502, 127.01, 37.51] },
    ],
  };
  const box = { south: 37.499, west: 126.999, north: 37.501, east: 127.001 };

  it("finds the row groups whose box meets the street's, with their rows", () => {
    expect(groupsFor(index, [box])).toEqual([{ file: 0, group: 0, rowStart: 0, rowEnd: 10 }]);
    const wide = { south: 37.49, west: 126.99, north: 37.505, east: 127.005 };
    expect(groupsFor(index, [wide]).map((g) => `${g.file}/${g.group}/${g.rowStart}-${g.rowEnd}`)).toEqual(["0/0/0-10", "1/1/5-12"]);
  });

  it("keeps only the places inside the boxes", async () => {
    const read = async (ref: GroupRef): Promise<OvertureRow[]> =>
      ref.file === 0 ? [row(), row({ names: { primary: "Far" }, bbox: { xmin: 127.05, ymin: 37.55 } }), row({ basic_category: "professional_service" })] : [];
    const { shops, groups } = await overturePlaces([box], read, index);
    expect(groups).toBe(1);
    expect(shops.map((s) => `${s.id} ${s.name}`)).toEqual(["ovt/0/0/0 Corner Noodles"]);
  });
});
