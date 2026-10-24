import { addDays } from "@/lib/frog/dates";
import { weekdayOf } from "@/lib/recurrence/rule";

// Habit streaks. A habit is scheduled on some weekdays; only scheduled days
// count. Pure date-key maths, no clock.

const MAX_LOOKBACK_DAYS = 3650;

export interface HabitStreak {
  current: number;
  longest: number;
}

/**
 * Streaks over the days from the habit's creation (or its earliest tick) to
 * `today`. A scheduled day with no tick breaks the streak, except today: an
 * unticked today doesn't break it yet, same as the frog streak. A tick on an
 * unscheduled day is a bonus: it adds to the streak, and missing such a day
 * never breaks it.
 */
export function habitStreak(weekdays: readonly number[], checked: ReadonlySet<string>, today: string, createdKey: string): HabitStreak {
  let start = createdKey;
  for (const d of checked) if (d < start) start = d;
  const floor = addDays(today, -MAX_LOOKBACK_DAYS);
  if (start < floor) start = floor;

  let run = 0;
  let longest = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const scheduled = weekdays.includes(weekdayOf(d));
    if (checked.has(d)) {
      run++;
      if (run > longest) longest = run;
    } else if (scheduled && d !== today) {
      run = 0;
    }
  }
  return { current: run, longest };
}

/** How many scheduled days in [fromKey, toKey] were ticked. Days before `createdKey` don't count. */
export function completionRate(
  weekdays: readonly number[],
  checked: ReadonlySet<string>,
  fromKey: string,
  toKey: string,
  createdKey: string,
): { scheduled: number; done: number; rate: number } {
  let scheduled = 0;
  let done = 0;
  for (let d = fromKey > createdKey ? fromKey : createdKey; d <= toKey; d = addDays(d, 1)) {
    if (!weekdays.includes(weekdayOf(d))) continue;
    scheduled++;
    if (checked.has(d)) done++;
  }
  return { scheduled, done, rate: scheduled === 0 ? 0 : done / scheduled };
}

/** A valid weekday list: 1–7 distinct integers 0–6, sorted. */
export function parseWeekdays(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 7) return null;
  if (!v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
  return [...new Set(v as number[])].sort((a, b) => a - b);
}
