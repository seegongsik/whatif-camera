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

export function capFor(name: "footprints" | "spark", env: EnvMap = process.env): number {
  const raw = name === "footprints" ? env.DAILY_FOOTPRINT_CALL_CAP : env.DAILY_SPARK_CALL_CAP;
  const n = Number(raw);
  if (raw && Number.isFinite(n) && n > 0) return Math.floor(n);
  return name === "footprints" ? 2000 : 300;
}

/** Counts one call; false when today's cap is already used up. */
export function takeCall(name: "footprints" | "spark", now = Date.now(), env: EnvMap = process.env): boolean {
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
