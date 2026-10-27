/**
 * Local east-north coordinates in metres around one reference point on the
 * WGS84 ellipsoid. A street scene spans a few hundred metres, where this
 * tangent-plane approximation is good to well under a centimetre per metre.
 */

export type LatLon = { lat: number; lon: number };

/** x east, y north, metres. */
export type EN = { x: number; y: number };

/** x east, y north, z up, metres. */
export type ENU = { x: number; y: number; z: number };

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export type LocalFrame = {
  origin: LatLon;
  metersPerDegLat: number;
  metersPerDegLon: number;
};

export function localFrame(origin: LatLon): LocalFrame {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lon) || Math.abs(origin.lat) > 89) {
    throw new RangeError("origin must be a finite latitude within ±89° and a finite longitude");
  }
  const phi = (origin.lat * Math.PI) / 180;
  const s = Math.sin(phi);
  const w = Math.sqrt(1 - WGS84_E2 * s * s);
  const meridional = (WGS84_A * (1 - WGS84_E2)) / (w * w * w);
  const primeVertical = WGS84_A / w;
  return {
    origin,
    metersPerDegLat: (meridional * Math.PI) / 180,
    metersPerDegLon: (primeVertical * Math.cos(phi) * Math.PI) / 180,
  };
}

export function toLocal(frame: LocalFrame, p: LatLon): EN {
  return {
    x: (p.lon - frame.origin.lon) * frame.metersPerDegLon,
    y: (p.lat - frame.origin.lat) * frame.metersPerDegLat,
  };
}

export function toLatLon(frame: LocalFrame, p: EN): LatLon {
  return {
    lat: frame.origin.lat + p.y / frame.metersPerDegLat,
    lon: frame.origin.lon + p.x / frame.metersPerDegLon,
  };
}

export function distance2(a: EN, b: EN): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Compass bearing from a to b in degrees, clockwise from north, in [0, 360). */
export function bearingDeg(a: EN, b: EN): number {
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

/** Wraps an angle in degrees into (-180, 180]. */
export function wrapDeg(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/** Wraps an angle in degrees into [0, 360). */
export function normDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}
