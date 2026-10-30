/**
 * The last street made from a photo, kept in this browser until a new photo
 * makes another: the street, Muse Spark's picks for it, and whether it came
 * from the live camera (then walking it follows the phone's position).
 * Opening the page again (or the browser reloading it after a tap out to a
 * place's Instagram) goes back to it. No photo is kept, and nothing here
 * leaves the phone.
 */
import type { Picks } from "./picks.js";
import type { StreetAhead } from "./street.js";

export type SavedStreet = {
  street: StreetAhead;
  picks?: Picks;
  /** ISO time the photo was taken. */
  savedAt: string;
  /** From the live camera: walking it follows the phone's GPS. */
  live: boolean;
};

const KEY = "whats-ahead:last-street";
/** A street with 400 places is a few hundred kilobytes; more than this is not kept. */
const MAX_CHARS = 2_000_000;

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Keeps the street; false when the browser has no room or no storage (a private window). */
export function saveStreet(saved: SavedStreet, storage: Storage | null = store()): boolean {
  try {
    const text = JSON.stringify(saved);
    if (!storage || text.length > MAX_CHARS) return false;
    storage.setItem(KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** Adds Muse Spark's picks to the kept street, when it is still the same street. */
export function savePicks(street: StreetAhead, picks: Picks, storage: Storage | null = store()): void {
  const saved = readSaved(storage);
  if (saved && saved.street.fetchedAt === street.fetchedAt && saved.street.name === street.name) saveStreet({ ...saved, picks }, storage);
}

export function readSaved(storage: Storage | null = store()): SavedStreet | null {
  try {
    const text = storage?.getItem(KEY);
    if (!text) return null;
    const saved = JSON.parse(text) as Partial<SavedStreet>;
    const street = saved.street;
    const ok =
      street !== undefined &&
      Array.isArray(street.route?.points) &&
      street.route.points.length >= 2 &&
      Array.isArray(street.shops) &&
      typeof street.origin?.lat === "number" &&
      typeof saved.savedAt === "string";
    return ok ? { street: street as StreetAhead, picks: saved.picks, savedAt: saved.savedAt!, live: saved.live === true } : null;
  } catch {
    return null;
  }
}

export function clearSaved(storage: Storage | null = store()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing kept, nothing to clear.
  }
}
