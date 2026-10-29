/**
 * Per-instance daily call caps for the public demo. Serverless instances do
 * not share memory, so the provider dashboards remain the hard limit.
 */
import type { EnvMap } from "./keys.js";

type Counter = { day: string; count: number };

const counters = new Map<string, Counter>();

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type CallKind = "footprints" | "spark" | "street" | "sam";

const CAP_ENV: Record<CallKind, string> = {
  footprints: "DAILY_FOOTPRINT_CALL_CAP",
  spark: "DAILY_SPARK_CALL_CAP",
  street: "DAILY_STREET_CALL_CAP",
  sam: "DAILY_SAM_CALL_CAP",
};
// SAM 3.1 is billed per image ($2.50 per 1,000 images at the time of writing).
const CAP_DEFAULT: Record<CallKind, number> = { footprints: 2000, spark: 300, street: 2000, sam: 1000 };

export function capFor(name: CallKind, env: EnvMap = process.env): number {
  const raw = env[CAP_ENV[name]];
  const n = Number(raw);
  if (raw && Number.isFinite(n) && n > 0) return Math.floor(n);
  return CAP_DEFAULT[name];
}

/** Counts one call; false when today's cap is already used up. */
export function takeCall(name: CallKind, now = Date.now(), env: EnvMap = process.env): boolean {
  const day = today(now);
  const counter = counters.get(name);
  const current = counter && counter.day === day ? counter : { day, count: 0 };
  if (current.count >= capFor(name, env)) {
    counters.set(name, current);
    return false;
  }
  current.count += 1;
  counters.set(name, current);
  return true;
}

export function resetLimitsForTests(): void {
  counters.clear();
}
