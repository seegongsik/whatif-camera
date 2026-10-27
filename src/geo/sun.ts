/**
 * Where the sun is, from the low-precision formulas of the Astronomical
 * Almanac (about 0.01° between 1950 and 2050). Used only to light the scene
 * like the moment of capture and to find an evening light for the "what if".
 */
const DEG = Math.PI / 180;

export type SunPosition = { azimuthDeg: number; elevationDeg: number };

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = date.getTime() / 86_400_000 + 2440587.5;
  const n = jd - 2451545.0;
  const meanLon = (280.46 + 0.9856474 * n) % 360;
  const anomaly = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const eclLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon));
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclLon));
  const gmstHours = (18.697374558 + 24.06570982441908 * n) % 24;
  const hourAngle = (gmstHours * 15 + lon) * DEG - ra;
  const phi = lat * DEG;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const azimuth = Math.atan2(
    -Math.cos(dec) * Math.sin(hourAngle),
    Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.cos(hourAngle) * Math.sin(phi),
  );
  const az = azimuth / DEG;
  return { azimuthDeg: az < 0 ? az + 360 : az, elevationDeg: elevation / DEG };
}

/**
 * The first moment after `from` (within a day) when the sun sinks through
 * `elevationDeg`, searched in two-minute steps. Null when it never does.
 */
export function eveningSun(from: Date, lat: number, lon: number, elevationDeg = 7): { at: Date; sun: SunPosition } | null {
  let previous = sunPosition(from, lat, lon);
  for (let minutes = 2; minutes <= 24 * 60; minutes += 2) {
    const at = new Date(from.getTime() + minutes * 60_000);
    const sun = sunPosition(at, lat, lon);
    if (previous.elevationDeg >= elevationDeg && sun.elevationDeg < elevationDeg && sun.azimuthDeg > 180) {
      return { at, sun };
    }
    previous = sun;
  }
  return null;
}

/** Unit vector towards the sun in east-north-up. */
export function sunVector(sun: SunPosition): { x: number; y: number; z: number } {
  const az = sun.azimuthDeg * DEG;
  const el = sun.elevationDeg * DEG;
  return { x: Math.sin(az) * Math.cos(el), y: Math.cos(az) * Math.cos(el), z: Math.sin(el) };
}
