/**
 * Places the data puts somewhere they are not, left out of every street:
 * one in the wrong spot would light up as a landmark where it is not (and a
 * famous name is just what Muse Spark picks). Each is matched by its name
 * and where the data has it, within 100 m, so an entry holds across
 * Overture's monthly releases, whose row numbers change. Found by looking;
 * each says what is wrong.
 */
import type { LatLon } from "../geo/enu.js";
import { distanceM } from "./famous.js";

export type Misplaced = { name: string; at: LatLon; why: string };

export const MISPLACED: readonly Misplaced[] = [
  {
    name: "Palo Alto - Stanford Mall",
    at: { lat: 37.47486, lon: -122.13931 },
    why: "Overture (2026-10-21.0) has this shopping mall in East Palo Alto, 4.3 km up University Avenue; the Stanford Shopping Center stands about 4 km away, by El Camino Real.",
  },
];

const plain = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Whether the data has this place in a spot it is known not to be. */
export function misplaced(place: { name: string; point: LatLon }, list: readonly Misplaced[] = MISPLACED): boolean {
  const name = plain(place.name);
  return list.some((m) => plain(m.name) === name && distanceM(m.at, place.point) <= 100);
}
