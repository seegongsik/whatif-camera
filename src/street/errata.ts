/**
 * What the data gets wrong about a place, put right: a place it puts
 * somewhere it is not is left out of every street (in the wrong spot it
 * would light up as a landmark where it is not, and a famous name is just
 * what Muse Spark picks), and a place it names by a web address gets its
 * name. Each is matched by its name and where the data has it, within
 * 100 m, so an entry holds across Overture's monthly releases, whose row
 * numbers change. Found by looking; each says what is wrong.
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
  {
    name: "San Francisco Museum of Modern Art",
    at: { lat: 37.78347, lon: -122.40897 },
    why: "Overture (2026-10-21.0) has the museum on Market Street, 250 m south-west of Powell Street, about 700 m from where it stands on Third Street; Muse Spark picked it as iconic on the Market Street demo.",
  },
];

export type Misnamed = { name: string; at: LatLon; as: string; why: string };

export const MISNAMED: readonly Misnamed[] = [
  {
    name: "graumanschinese.org",
    at: { lat: 34.10176, lon: -118.34105 },
    as: "TCL Chinese Theatre",
    why: "Overture (2026-10-21.0) names the theatre on Hollywood Boulevard by its web address; Muse Spark picked it as iconic and the show wrote the address.",
  },
];

const plain = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const matches = (entry: { name: string; at: LatLon }, place: { name: string; point: LatLon }) =>
  plain(entry.name) === plain(place.name) && distanceM(entry.at, place.point) <= 100;

/** Whether the data has this place in a spot it is known not to be. */
export function misplaced(place: { name: string; point: LatLon }, list: readonly Misplaced[] = MISPLACED): boolean {
  return list.some((m) => matches(m, place));
}

/** The place under its own name, where the data is known to name it wrongly; otherwise the same place. */
export function rightName<T extends { name: string; point: LatLon }>(place: T, list: readonly Misnamed[] = MISNAMED): T {
  const entry = list.find((m) => matches(m, place));
  return entry ? { ...place, name: entry.as } : place;
}
