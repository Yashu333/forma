import { addDays, isDateKey } from "./dates";

// addDays that returns null at the ends of the calendar instead of throwing.
function shift(key: string, n: number): string | null {
  try {
    return addDays(key, n);
  } catch {
    return null;
  }
}

export interface StreakDay {
  date: string; // local "YYYY-MM-DD"
  eaten: boolean; // the day's frog was eaten (see "Done and eaten" in the spec)
}

/**
 * Frog streaks: runs of consecutive calendar days whose frog was eaten.
 *
 * - A day with no entry, or an uneaten frog, breaks the run.
 * - Today is the exception for `current`: it may still be eaten, so an uneaten
 *   or missing today doesn't break the streak yet and counting starts from
 *   yesterday. If today is eaten it counts as the newest day.
 * - Days after `today` (tomorrow's preselected frog) are ignored.
 * - Unsorted input is fine. Duplicate dates count as eaten if any entry is.
 *   Entries whose date isn't a valid key are ignored.
 *
 * Throws RangeError if `today` isn't a valid date key. The ends of the calendar
 * (0000-01-01, 9999-12-31) just end a run; they never throw.
 */
export function computeStreaks(days: readonly StreakDay[], today: string): { current: number; longest: number } {
  if (!isDateKey(today)) throw new RangeError(`Invalid date key: ${String(today)}`);

  const eatenDates = new Set<string>();
  for (const d of days) {
    // Date keys are zero-padded, so plain string comparison orders them.
    if (d.eaten && isDateKey(d.date) && d.date <= today) eatenDates.add(d.date);
  }

  let current = 0;
  let cursor: string | null = eatenDates.has(today) ? today : shift(today, -1);
  while (cursor !== null && eatenDates.has(cursor)) {
    current++;
    cursor = shift(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of [...eatenDates].sort()) {
    run = prev !== null && shift(prev, 1) === date ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = date;
  }

  return { current, longest };
}
