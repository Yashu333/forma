import { addDays, localDateKey } from "@/lib/frog/dates";

// Pure helpers for focus-time reporting.

export interface SessionLike {
  startedAt: Date | string;
  durationSec: number;
}

/** "2h 25m", "45m", "30s", "0m". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return s === 0 ? "0m" : `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  // Rounding 59.6 minutes up must roll into the hour.
  return m === 60 ? `${h + 1}h` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Seconds of focus per local day for the `days` days ending on `today`
 * (inclusive), oldest first. A session counts on the day it started.
 */
export function dailyFocus(sessions: readonly SessionLike[], tz: string, today: string, days: number): { date: string; sec: number }[] {
  const out = Array.from({ length: days }, (_, i) => ({ date: addDays(today, i - (days - 1)), sec: 0 }));
  const index = new Map(out.map((d, i) => [d.date, i]));
  for (const s of sessions) {
    const i = index.get(localDateKey(new Date(s.startedAt), tz));
    if (i !== undefined) out[i].sec += s.durationSec;
  }
  return out;
}
