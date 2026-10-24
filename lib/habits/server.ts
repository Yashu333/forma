// Server-side only: builds the habit payloads the API returns.
import { addDays, localDateKey } from "@/lib/frog/dates";
import { mondayOf, weekdayOf } from "@/lib/recurrence/rule";
import { completionRate, habitStreak } from "./streak";

/** The first day of the 5-week grid on /habits: the Monday four weeks before this week's. */
export function gridStart(today: string): string {
  return addDays(mondayOf(today), -28);
}

interface HabitRow {
  id: string;
  name: string;
  weekdays: number[];
  order: number;
  createdAt: Date;
  checks: { date: string }[];
}

/** One habit as the client sees it: recent ticks, streaks over all history, and the 5-week completion. */
export function habitPayload(h: HabitRow, today: string, tz: string) {
  const all = new Set(h.checks.map((c) => c.date));
  const createdKey = localDateKey(h.createdAt, tz);
  const start = gridStart(today);
  const rate = completionRate(h.weekdays, all, start, today, createdKey);
  return {
    id: h.id,
    name: h.name,
    weekdays: h.weekdays,
    order: h.order,
    createdKey,
    checks: [...all].filter((d) => d >= start).sort(),
    streak: habitStreak(h.weekdays, all, today, createdKey),
    rate: { scheduled: rate.scheduled, done: rate.done },
    scheduledToday: h.weekdays.includes(weekdayOf(today)),
  };
}
