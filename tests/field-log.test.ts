import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureMeta } from "../src/capture/types.js";
import { addFieldShot, clearFieldLog, fieldLogText, fieldShot, MAX_FIELD_SHOTS, readFieldLog } from "../src/street/field-log.js";
import type { StreetAhead } from "../src/street/street.js";

// SYNTHETIC: a made-up shot and street, for the log's format only.
const capture: CaptureMeta = {
  lat: 37.5006,
  lon: 127.0365,
  accuracyM: 12.4,
  headingDeg: 72.3,
  headingAccuracyDeg: 15,
  headingSource: "compass",
  pitchDeg: -1.2,
  rollDeg: 0.4,
  tiltSource: "gravity sensor",
  fovLongDeg: 67,
  fovSource: "assumption",
  takenAt: "2026-10-29T03:14:15.000Z",
  raw: { alpha: 287.7, beta: 88.4, gamma: 0.2, absolute: true, screenAngle: 0 },
};
const street = {
  name: "Synthetic-ro",
  highway: "primary",
  streetDistanceM: 7.4,
  streetHeadingDeg: 70.2,
  route: { points: [], along: [], length: 5000 },
  shops: new Array(12).fill(null),
} as unknown as StreetAhead;

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, String(v)),
  };
}

describe("the field log", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes one line per shot with what the sensors said, the street found and a link that replays it", () => {
    const text = fieldLogText([fieldShot(capture, 6.08, street)], "https://example.test/");
    expect(text).toBe(
      "2026-10-29T03:14Z · 37.500600,127.036500 ±12 m · facing 72° (compass ±15°) · tilt -1° · α287.7 β88.4 γ0.2 abs → Synthetic-ro (primary), 7 m off, runs 70° · 12 places · 5.0 km · 6.1 s · https://example.test/?street=37.500600,127.036500,72",
    );
  });

  it("keeps why a lookup failed, and the direction someone picked by hand", () => {
    const picked = { ...capture, headingDeg: 90, headingAccuracyDeg: 22.5, headingSource: "manual" as const, raw: undefined };
    const line = fieldLogText([fieldShot(picked, 2, "No street runs beside you")], "https://example.test/");
    expect(line).toContain("facing 90° (manual ±23°)");
    expect(line).toContain("→ failed: No street runs beside you");
    expect(line).not.toContain("α");
  });

  it("keeps the latest shots in this browser, and does without storage", () => {
    expect(readFieldLog()).toEqual([]);
    expect(() => addFieldShot(fieldShot(capture, 1, street))).not.toThrow();
    vi.stubGlobal("localStorage", memoryStorage());
    for (let i = 0; i < MAX_FIELD_SHOTS + 3; i += 1) addFieldShot(fieldShot({ ...capture, accuracyM: i }, 1, street));
    const log = readFieldLog();
    expect(log).toHaveLength(MAX_FIELD_SHOTS);
    expect(log[0].accuracyM).toBe(3);
    expect(log.at(-1)?.street?.places).toBe(12);
    clearFieldLog();
    expect(readFieldLog()).toEqual([]);
  });
});
