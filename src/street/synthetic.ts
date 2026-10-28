/**
 * A SYNTHETIC street for tests and the demo button: an avenue that bends
 * after 1.2 km while a side road carries straight on, cross streets, and
 * invented shops on both sides. It comes out in the Overpass API's JSON
 * shape, so the same parsing and routing run on it as on the real map.
 * Names are invented; none is a real business.
 */
import { localFrame, toLatLon, type EN, type LatLon } from "../geo/enu.js";
import { shopsFromOverpass, waysFromOverpass } from "./osm.js";
import { buildStreetAhead, type StreetAhead } from "./street.js";

export const SYNTHETIC_STREET_ORIGIN: LatLon = { lat: 37.5, lon: 127.0 };
export const SYNTHETIC_STREET_NAME = "Synthetic Avenue";

type Way = { id: number; tags: Record<string, string>; nodes: number[] };

const frame = localFrame(SYNTHETIC_STREET_ORIGIN);
const nodePoints = new Map<number, EN>();
let nextNode = 1;

function node(p: EN): number {
  const id = nextNode++;
  nodePoints.set(id, p);
  return id;
}

/** Bearing 20° east of north after the bend. */
const BEND = { x: 0, y: 1200 };
const dir2 = { x: Math.sin((20 * Math.PI) / 180), y: Math.cos((20 * Math.PI) / 180) };
const along2 = (m: number): EN => ({ x: BEND.x + dir2.x * m, y: BEND.y + dir2.y * m });

const nStart = node({ x: 0, y: -400 });
const nCross1 = node({ x: 0, y: 300 });
const nCross2 = node({ x: 0, y: 800 });
const nBend = node(BEND);
const nMid = node(along2(1500));
const nEnd = node(along2(4400));

const ways: Way[] = [
  { id: 101, tags: { highway: "primary", name: SYNTHETIC_STREET_NAME }, nodes: [nStart, node({ x: 0, y: 0 }), nCross1] },
  { id: 102, tags: { highway: "primary", name: SYNTHETIC_STREET_NAME }, nodes: [nCross1, node({ x: 0, y: 550 }), nCross2] },
  { id: 103, tags: { highway: "primary", name: SYNTHETIC_STREET_NAME }, nodes: [nCross2, nBend] },
  { id: 104, tags: { highway: "primary", name: SYNTHETIC_STREET_NAME }, nodes: [nBend, node(along2(700)), nMid] },
  { id: 105, tags: { highway: "primary", name: SYNTHETIC_STREET_NAME }, nodes: [nMid, nEnd] },
  // Carries straight on at the bend: the route must stay on the avenue instead.
  { id: 201, tags: { highway: "secondary", name: "Side Road" }, nodes: [nBend, node({ x: 0, y: 2000 })] },
  { id: 301, tags: { highway: "tertiary", name: "First Cross Street" }, nodes: [node({ x: -500, y: 300 }), nCross1, node({ x: 500, y: 300 })] },
  { id: 302, tags: { highway: "tertiary", name: "Second Cross Street" }, nodes: [node({ x: -500, y: 800 }), nCross2, node({ x: 500, y: 800 })] },
];

/** Invented shops: [category tag, value, name, extra tags]. */
const SHOP_KINDS: [string, string, string, Record<string, string>?][] = [
  ["amenity", "cafe", "Morning Cup", { opening_hours: "Mo-Su 07:00-22:00", "contact:instagram": "morningcup.synthetic" }],
  ["amenity", "restaurant", "Corner Noodles", { cuisine: "noodle" }],
  ["shop", "clothes", "Blue Thread", { "contact:facebook": "https://www.facebook.com/bluethread.synthetic" }],
  ["shop", "convenience", "Night Owl Mart", { opening_hours: "24/7" }],
  ["amenity", "fast_food", "Quick Bun", {}],
  ["shop", "cosmetics", "Glow Lab", {}],
  ["amenity", "bar", "Lantern Bar", {}],
  ["amenity", "pharmacy", "Green Cross Pharmacy", {}],
  ["shop", "shoes", "Step Ahead", {}],
  ["amenity", "bank", "Harbor Bank", {}],
  ["shop", "bakery", "Rise Bakery", {}],
  ["amenity", "cinema", "Silver Screen", {}],
  ["shop", "books", "Page Turner", {}],
  ["tourism", "hotel", "Avenue Inn", {}],
  ["amenity", "ice_cream", "Cold Spoon", {}],
];

type Element = Record<string, unknown>;

function shopElements(): Element[] {
  const out: Element[] = [];
  let id = 900_000;
  // Every 60 m, alternating sides, along both parts of the avenue; 20 m off the centre line.
  for (let m = -10, k = 0; m < 5600; m += 60, k += 1) {
    const side = k % 2 === 0 ? 1 : -1;
    let p: EN;
    if (m < 1200) p = { x: side * 20, y: m };
    else {
      const a = along2(m - 1200);
      p = { x: a.x + side * 20 * dir2.y, y: a.y - side * 20 * dir2.x };
    }
    const [key, value, name, extra] = SHOP_KINDS[k % SHOP_KINDS.length];
    const ll = toLatLon(frame, p);
    out.push({ type: "node", id: id++, lat: ll.lat, lon: ll.lon, tags: { [key]: value, name: k < SHOP_KINDS.length ? name : `${name} ${Math.floor(k / SHOP_KINDS.length) + 1}`, ...extra } });
  }
  // The same café drawn twice (its node and its building): the street view must show it once.
  const twin = toLatLon(frame, { x: 22, y: -10 });
  out.push({ type: "way", id: 950_001, center: { lat: twin.lat, lon: twin.lon }, tags: { amenity: "cafe", name: "Morning Cup", website: "https://example.org" } });
  // Off the street (150 m away): not on it.
  const far = toLatLon(frame, { x: 150, y: 400 });
  out.push({ type: "node", id: 950_002, lat: far.lat, lon: far.lon, tags: { shop: "florist", name: "Far Away Flowers" } });
  return out;
}

/** Highway ways as the Overpass API returns them with `out body geom`. SYNTHETIC. */
export function syntheticWaysJson(): { elements: Element[] } {
  return {
    elements: ways.map((w) => ({
      type: "way",
      id: w.id,
      nodes: w.nodes,
      geometry: w.nodes.map((n) => toLatLon(frame, nodePoints.get(n)!)),
      tags: w.tags,
    })),
  };
}

/** Shops as the Overpass API returns them with `out center tags`. SYNTHETIC. */
export function syntheticShopsJson(): { elements: Element[] } {
  return { elements: shopElements() };
}

/** Where the SYNTHETIC camera stands: 6 m east of the avenue, looking 4° off its line. */
export const SYNTHETIC_CAPTURE = {
  position: toLatLon(frame, { x: 6, y: 0 }),
  headingDeg: 4,
};

/** The SYNTHETIC street as the street view gets it, built here without any network. */
export function syntheticStreet(): StreetAhead {
  const street = buildStreetAhead({
    origin: SYNTHETIC_CAPTURE.position,
    headingDeg: SYNTHETIC_CAPTURE.headingDeg,
    ways: waysFromOverpass(syntheticWaysJson()),
    shops: shopsFromOverpass(syntheticShopsJson()),
    source: "SYNTHETIC street with invented shops",
    attribution: "SYNTHETIC: invented street and shops",
    fetchedAt: new Date().toISOString(),
    synthetic: true,
  });
  if (!street) throw new Error("The synthetic street did not build.");
  return street;
}
