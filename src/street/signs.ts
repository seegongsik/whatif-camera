/**
 * How each kind of place looks on the street: a colour and a short word.
 * No logos: names come from the map, colours from the kind of place.
 */
import type { ShopCategory } from "./osm.js";

export const CATEGORY_STYLE: Record<ShopCategory, { color: string; word: string; label: string }> = {
  food: { color: "#f4511e", word: "EAT", label: "Food" },
  cafe: { color: "#8d5b3e", word: "CAFE", label: "Cafés" },
  bar: { color: "#6a3fb5", word: "BAR", label: "Bars" },
  fashion: { color: "#d81b60", word: "STYLE", label: "Fashion" },
  grocery: { color: "#2e9d4a", word: "MART", label: "Groceries" },
  beauty: { color: "#e05297", word: "BEAUTY", label: "Beauty" },
  health: { color: "#00897b", word: "HEALTH", label: "Health" },
  money: { color: "#1e74d6", word: "BANK", label: "Banks" },
  fun: { color: "#f2a900", word: "FUN", label: "Fun" },
  stay: { color: "#3949ab", word: "STAY", label: "Stay" },
  shop: { color: "#546e7a", word: "SHOP", label: "Shops" },
};


/** "120 m" up to a kilometre, then "1.4 km". */
export function distanceText(m: number): string {
  if (m < 0) return "here";
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
