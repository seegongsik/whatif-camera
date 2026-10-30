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

export const FAMOUS_STREETS: FamousStreet[] = [
  { label: "Gangnam-daero, Seoul (north from Gangnam Station)", short: "Gangnam-daero, Seoul", name: "Gangnam-daero", city: "Seoul", lat: 37.4985, lon: 127.0274, headingDeg: 343, street: "강남대로", zones: ["Asia/Seoul"] },
  { label: "Market Street, San Francisco (south-west from Powell Street)", short: "Market Street, San Francisco", name: "Market Street", city: "San Francisco", lat: 37.785, lon: -122.4069, headingDeg: 232, street: "Market Street", zones: ["America/Los_Angeles"] },
  { label: "Hollywood Boulevard, Los Angeles (east from Highland Avenue)", short: "Hollywood Boulevard, Los Angeles", name: "Hollywood Boulevard", city: "Los Angeles", lat: 34.1016, lon: -118.3387, headingDeg: 90, street: "Hollywood Boulevard", zones: ["America/Los_Angeles"] },
  { label: "University Avenue, Palo Alto (north-east from Emerson Street)", short: "University Avenue, Palo Alto", name: "University Avenue", city: "Palo Alto", lat: 37.4459, lon: -122.1617, headingDeg: 52, street: "University Avenue", zones: ["America/Los_Angeles"] },
  { label: "Fifth Avenue, New York (north from 42nd Street)", short: "Fifth Avenue, New York", name: "Fifth Avenue", city: "New York", lat: 40.7536, lon: -73.9807, headingDeg: 29, street: "5th Avenue", zones: ["America/New_York"] },
  { label: "7th Avenue, New York (south from Times Square)", short: "7th Avenue, New York", name: "7th Avenue · Times Square", city: "New York", lat: 40.759, lon: -73.9848, headingDeg: 209, street: "7th Avenue", zones: ["America/New_York"] },
  { label: "Robson Street, Vancouver (north-west from Burrard)", short: "Robson Street, Vancouver", name: "Robson Street", city: "Vancouver", lat: 49.2838, lon: -123.1233, headingDeg: 315, street: "Robson Street", zones: ["America/Vancouver"] },
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
