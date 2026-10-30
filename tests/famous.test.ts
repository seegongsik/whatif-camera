import { describe, expect, it } from "vitest";
import { distanceM, FAMOUS_STREETS, nearestStreet, orderForZone } from "../src/street/famous.js";

describe("famous streets to fly down", () => {
  it("lead with the visitor's own part of the world, Seoul last everywhere", () => {
    expect(orderForZone(FAMOUS_STREETS, "America/Los_Angeles").slice(0, 3).map((s) => s.short)).toEqual([
      "Hollywood Boulevard, Los Angeles",
      "Market Street, San Francisco",
      "Fifth Avenue, New York",
    ]);
    // Same continent next: a visitor in Chicago sees Chicago, then the other American streets.
    const chicago = orderForZone(FAMOUS_STREETS, "America/Chicago").map((s) => s.short);
    expect(chicago[0]).toBe("Michigan Avenue, Chicago");
    expect(chicago.indexOf("Oxford Street, London")).toBeGreaterThan(chicago.indexOf("7th Avenue, New York"));
    expect(chicago.at(-1)).toBe("Gangnam-daero, Seoul");
    // In Korea, Tokyo comes first (the same continent) and Seoul still last.
    const seoul = orderForZone(FAMOUS_STREETS, "Asia/Seoul").map((s) => s.short);
    expect(seoul[0]).toBe("Ginza, Tokyo");
    expect(seoul.at(-1)).toBe("Gangnam-daero, Seoul");
    expect(orderForZone(FAMOUS_STREETS, "Europe/Paris")[0].short).toBe("Champs-Élysées, Paris");
    expect(orderForZone(FAMOUS_STREETS, undefined)).toEqual(FAMOUS_STREETS);
  });

  it("each have an id fit for a link", () => {
    const ids = FAMOUS_STREETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9-]{1,40}$/.test(id))).toBe(true);
  });

  it("offer the nearest one, unless you stand on it", () => {
    // Meta's campus in Menlo Park: Market Street in San Francisco is the nearest.
    expect(nearestStreet(FAMOUS_STREETS, { lat: 37.4848, lon: -122.1484 })?.short).toBe("Market Street, San Francisco");
    // A village in Korea: Gangnam-daero.
    expect(nearestStreet(FAMOUS_STREETS, { lat: 36.6, lon: 127.9 })?.short).toBe("Gangnam-daero, Seoul");
    expect(nearestStreet(FAMOUS_STREETS, { lat: 37.4986, lon: 127.0275 })).toBeNull();
    expect(distanceM({ lat: 37.7749, lon: -122.4194 }, { lat: 34.0522, lon: -118.2437 })).toBeGreaterThan(550_000);
    expect(distanceM({ lat: 37.7749, lon: -122.4194 }, { lat: 34.0522, lon: -118.2437 })).toBeLessThan(570_000);
  });
});
