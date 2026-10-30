/**
 * Streets to fly down from the map alone, without a photo: a point near the
 * street, the direction to look and the street's name on the map (which
 * picks it out when the point is a little off). Starting points, not survey
 * marks. The list leads with the streets in the visitor's own part of the
 * world (from the device's time zone, which needs no permission), the
 * busiest of them first, and the nearest one is offered when no street is
 * found where someone stands.
 */
import type { LatLon } from "../geo/enu.js";

export type FamousStreet = {
  label: string;
  /** For a button that says where it goes in a few words. */
  short: string;
  /** The street and its city, for one line of a list. */
  name: string;
  city: string;
  lat: number;
  lon: number;
  headingDeg: number;
  street: string;
  /** Time zones whose visitors see this street first. */
  zones: string[];
};

/**
 * Streets the world knows by name, in the order a visitor who has not been
 * there would look for them; each checked on the deployment (2026-10-30)
 * for its street, its places and what Muse Spark picks along it. Seoul's
 * is kept last everywhere (no time zone moves it up).
 */
export const FAMOUS_STREETS: FamousStreet[] = [
  { label: "Fifth Avenue, New York (north from 42nd Street)", short: "Fifth Avenue, New York", name: "Fifth Avenue", city: "New York", lat: 40.7536, lon: -73.9807, headingDeg: 29, street: "5th Avenue", zones: ["America/New_York"] },
  { label: "Hollywood Boulevard, Los Angeles (east from La Brea Avenue)", short: "Hollywood Boulevard, Los Angeles", name: "Hollywood Boulevard", city: "Los Angeles", lat: 34.1016, lon: -118.3443, headingDeg: 90, street: "Hollywood Boulevard", zones: ["America/Los_Angeles"] },
  { label: "Market Street, San Francisco (south-west from Powell Street)", short: "Market Street, San Francisco", name: "Market Street", city: "San Francisco", lat: 37.785, lon: -122.4069, headingDeg: 232, street: "Market Street", zones: ["America/Los_Angeles"] },
  { label: "7th Avenue, New York (south from Times Square)", short: "7th Avenue, New York", name: "7th Avenue · Times Square", city: "New York", lat: 40.759, lon: -73.9848, headingDeg: 209, street: "7th Avenue", zones: ["America/New_York"] },
  { label: "Michigan Avenue, Chicago (north from the Art Institute)", short: "Michigan Avenue, Chicago", name: "Michigan Avenue", city: "Chicago", lat: 41.8797, lon: -87.6241, headingDeg: 0, street: "South Michigan Avenue", zones: ["America/Chicago"] },
  { label: "Oxford Street, London (west from Tottenham Court Road)", short: "Oxford Street, London", name: "Oxford Street", city: "London", lat: 51.5162, lon: -0.1305, headingDeg: 275, street: "Oxford Street", zones: ["Europe/London"] },
  { label: "Champs-Élysées, Paris (down from the Arc de Triomphe)", short: "Champs-Élysées, Paris", name: "Champs-Élysées", city: "Paris", lat: 48.8737, lon: 2.2965, headingDeg: 117, street: "Avenue des Champs-Élysées", zones: ["Europe/Paris"] },
  { label: "Chuo-dori, Ginza, Tokyo (north-east from Ginza 8-chome)", short: "Ginza, Tokyo", name: "Chuo-dori · Ginza", city: "Tokyo", lat: 35.666, lon: 139.7603, headingDeg: 35, street: "第一京浜", zones: ["Asia/Tokyo"] },
  { label: "Gangnam-daero, Seoul (north from Gangnam Station)", short: "Gangnam-daero, Seoul", name: "Gangnam-daero", city: "Seoul", lat: 37.4985, lon: 127.0274, headingDeg: 343, street: "강남대로", zones: [] },
];

/** The visitor's own zone first, then the rest of their continent (the zone's first part), then the others; each group in list order. */
export function orderForZone(streets: readonly FamousStreet[], zone: string | undefined): FamousStreet[] {
  const continent = zone?.split("/")[0];
  const rank = (s: FamousStreet) => (zone && s.zones.includes(zone) ? 0 : continent && s.zones.some((z) => z.split("/")[0] === continent) ? 1 : 2);
  return streets.map((s, i) => ({ s, i, r: rank(s) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.s);
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The famous street nearest a point, unless the point is already on it (within 300 m). */
export function nearestStreet(streets: readonly FamousStreet[], at: LatLon): FamousStreet | null {
  let best: FamousStreet | null = null;
  let bestM = Infinity;
  for (const s of streets) {
    const d = distanceM(at, s);
    if (d < bestM) {
      best = s;
      bestM = d;
    }
  }
  return best && bestM > 300 ? best : null;
}
