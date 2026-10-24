import { addDays, isDateKey, isValidTimeZone, localDateKey, localHour } from "./dates";
import { computeStreaks } from "./streak";

/**
 * One DailyPlan row joined with its frog task. `frogTask` is null when the plan
 * has no frog (never chosen, or the task was deleted and the FK set to null);
 * `completedAt` is the frog task's own completedAt, null while it's open.
 * Dates may be Date objects or ISO strings, as they come from Prisma or JSON.
 */
export interface FrogPlanInput {
  date: string; // local "YYYY-MM-DD"
  frogTask: { completedAt: Date | string | null } | null;
}

export interface FrogDay {
  date: string;
  planned: boolean; // the day had a frog
  eaten: boolean;
  beforeNoon: boolean;
}

export interface FrogStats {
  plannedDays: number;
  eatenDays: number;
  eatenRate: number; // eatenDays / plannedDays, 0..1 (0 when nothing planned)
  beforeNoonRate: number; // share of eaten frogs eaten before noon, 0..1 (0 when none eaten)
  current: number;
  longest: number;
}

/**
 * Judges one plan. The frog is eaten if its completedAt is set and falls on or
 * before the plan's date in `tz` (finishing it later doesn't rescue that day).
 * It's eaten before noon if, additionally, the local hour is < 12.
 * An unparseable completedAt counts as not completed.
 */
export function evaluatePlan(plan: FrogPlanInput, tz: string): FrogDay {
  const planned = plan.frogTask !== null;
  const raw = plan.frogTask?.completedAt;
  const completedAt = raw == null ? null : new Date(raw);
  if (completedAt === null || Number.isNaN(completedAt.getTime())) {
    return { date: plan.date, planned, eaten: false, beforeNoon: false };
  }
  const eaten = localDateKey(completedAt, tz) <= plan.date;
  return { date: plan.date, planned, eaten, beforeNoon: eaten && localHour(completedAt, tz) < 12 };
}

/**
 * Frog statistics as of `today` (the user's local date) in zone `tz`.
 *
 * Counts cover the last `rangeDays` days ending today inclusive, or everything
 * up to today for "all". Plans dated after today (tomorrow's preselected frog)
 * and plans without a frog are not "planned days". Streaks ignore the range
 * and use every plan passed in, so pass the full history if the streak should
 * reach past the window.
 *
 * Throws RangeError for an invalid `today`, `tz`, or `rangeDays` (must be a
 * positive integer or "all").
 */
export function frogStats(
  plans: readonly FrogPlanInput[],
  tz: string,
  today: string,
  rangeDays: number | "all",
): FrogStats {
  if (!isDateKey(today)) throw new RangeError(`Invalid date key: ${String(today)}`);
  if (!isValidTimeZone(tz)) throw new RangeError(`Invalid time zone: ${String(tz)}`);
  if (rangeDays !== "all" && !(Number.isInteger(rangeDays) && rangeDays > 0)) {
    throw new RangeError(`rangeDays must be a positive integer or "all": ${String(rangeDays)}`);
  }
  const start = rangeDays === "all" ? null : addDays(today, -(rangeDays - 1));

  const days = plans.filter((p) => isDateKey(p.date) && p.date <= today).map((p) => evaluatePlan(p, tz));

  let plannedDays = 0;
  let eatenDays = 0;
  let beforeNoonDays = 0;
  for (const d of days) {
    if (!d.planned || (start !== null && d.date < start)) continue;
    plannedDays++;
    if (d.eaten) eatenDays++;
    if (d.beforeNoon) beforeNoonDays++;
  }

  return {
    plannedDays,
    eatenDays,
    eatenRate: plannedDays ? eatenDays / plannedDays : 0,
    beforeNoonRate: eatenDays ? beforeNoonDays / eatenDays : 0,
    ...computeStreaks(days, today),
  };
}
