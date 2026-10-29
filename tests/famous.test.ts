import { describe, expect, it } from "vitest";
import { distanceM, FAMOUS_STREETS, nearestStreet, orderForZone } from "../src/street/famous.js";

describe("famous streets to fly down", () => {
  it("lead with the visitor's own part of the world", () => {
    expect(orderForZone(FAMOUS_STREETS, "America/Los_Angeles").slice(0, 3).map((s) => s.short)).toEqual([
      "University Avenue, Palo Alto",
      "Market Street, San Francisco",
      "Hollywood Boulevard, Los Angeles",
    ]);
    // Same continent next: a visitor in Chicago sees the American streets before Seoul's.
    const chicago = orderForZone(FAMOUS_STREETS, "America/Chicago").map((s) => s.short);
    expect(chicago.indexOf("Gangnam-daero, Seoul")).toBe(chicago.length - 1);
    expect(orderForZone(FAMOUS_STREETS, "Asia/Seoul")[0].short).toBe("Gangnam-daero, Seoul");
    expect(orderForZone(FAMOUS_STREETS, undefined)).toEqual(FAMOUS_STREETS);
  });

  it("offer the nearest one, unless you stand on it", () => {
    // Meta's campus in Menlo Park: Palo Alto's University Avenue is the nearest.
    expect(nearestStreet(FAMOUS_STREETS, { lat: 37.4848, lon: -122.1484 })?.short).toBe("University Avenue, Palo Alto");
    // A village in Korea: Gangnam-daero.
    expect(nearestStreet(FAMOUS_STREETS, { lat: 36.6, lon: 127.9 })?.short).toBe("Gangnam-daero, Seoul");
    expect(nearestStreet(FAMOUS_STREETS, { lat: 37.4986, lon: 127.0275 })).toBeNull();
    expect(distanceM({ lat: 37.7749, lon: -122.4194 }, { lat: 34.0522, lon: -118.2437 })).toBeGreaterThan(550_000);
    expect(distanceM({ lat: 37.7749, lon: -122.4194 }, { lat: 34.0522, lon: -118.2437 })).toBeLessThan(570_000);
  });
});
