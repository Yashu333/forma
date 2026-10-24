import type { Abcde } from "@/types";
import { addDays, isDateKey, isValidTimeZone, localDateKey } from "./dates";
import { ABCDE_LETTERS } from "./abcde";
import { evaluatePlan, type FrogDay, type FrogPlanInput, type FrogStats } from "./stats";
import { MIN_PLAN_DATE, isPlanDate, PLAN_DATE_ERROR } from "./today";
import type { Parsed } from "./validate";

// Pure logic behind GET /api/reports/frog (no DB, safe to import from client
// code for the types). The queries live in the route.

/** The longest calendar strip the report returns: "all time" is cut to this many days. */
export const MAX_STRIP_DAYS = 400;
/** "All time" shows at least this many days, like /api/reports. */
export const MIN_STRIP_DAYS = 7;
/** Reflections returned, newest first. */
export const MAX_REFLECTIONS = 30;

/** Per-letter counts of completed tasks; `none` holds tasks without an ABCDE letter. */
export type AbcdeCounts = Record<Abcde | "none", number>;

export interface FrogReflection {
  date: string;
  rating: number | null;
  wentWell: string | null;
  improve: string | null;
  frogTitle: string | null;
  eaten: boolean;
}

export interface FrogReport {
  stats: FrogStats;
  daily: FrogDay[];
  abcdeCompleted: AbcdeCounts;
  reflections: FrogReflection[];
}

export interface FrogReportQuery {
  tz: string;
  today: string;
  /** Window in days (7..365), or "all". */
  days: number | "all";
}

const fail = (error: string): Parsed<never> => ({ ok: false, error });

/**
 * Validates the query of GET /api/reports/frog. `tz` and `today` are required
 * (the server never reads its own clock); `days` defaults to 30 and accepts the
 * same values as /api/reports: "all", or a whole number that is clamped to
 * 7..365. Anything else ("abc", "1.5", "-3", "") is a 400, not a silent default.
 */
export function parseFrogReportQuery(params: { get(name: string): string | null }): Parsed<FrogReportQuery> {
  const tz = params.get("tz");
  const today = params.get("today");
  if (!isValidTimeZone(tz)) return fail("tz must be an IANA time zone such as Europe/Berlin");
  if (!isDateKey(today)) return fail("today must be a date in YYYY-MM-DD format");
  if (!isPlanDate(today)) return fail(PLAN_DATE_ERROR.replace(/^date/, "today"));

  const raw = params.get("days") ?? "30";
  let days: number | "all";
  if (raw === "all") {
    days = "all";
  } else if (/^\d{1,6}$/.test(raw)) {
    days = Math.min(Math.max(Number(raw), 7), 365);
  } else {
    return fail('days must be a whole number of days (7 to 365) or "all"');
  }
  return { ok: true, value: { tz, today, days } };
}

/**
 * First day of the calendar strip, ending at `today`.
 * - a number of days: the last `days` days, today inclusive;
 * - "all": from the earliest plan (or the last 7 days when there is none),
 *   but never fewer than 7 or more than MAX_STRIP_DAYS days.
 * The result never goes before MIN_PLAN_DATE.
 */
export function rangeStart(today: string, days: number | "all", earliestPlanDate: string | null = null): string {
  let span: number;
  if (days === "all") {
    span = MIN_STRIP_DAYS;
    if (earliestPlanDate !== null && isDateKey(earliestPlanDate) && earliestPlanDate < today) {
      span = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${earliestPlanDate}T00:00:00Z`)) / 86_400_000) + 1;
      span = Math.min(Math.max(span, MIN_STRIP_DAYS), MAX_STRIP_DAYS);
    }
  } else {
    span = days;
  }
  const start = addDays(today, -(span - 1));
  return start < MIN_PLAN_DATE ? MIN_PLAN_DATE : start;
}

/** The earliest plan date on or before `today`, or null. */
export function earliestPlanDate(plans: readonly { date: string }[], today: string): string | null {
  let min: string | null = null;
  for (const p of plans) {
    if (isDateKey(p.date) && p.date <= today && (min === null || p.date < min)) min = p.date;
  }
  return min;
}

/**
 * One entry per calendar day from `start` to `today` inclusive (oldest first).
 * Days without a plan are `{planned:false, eaten:false, beforeNoon:false}`.
 * Plans after `today` are ignored.
 */
export function buildDailyStrip(plans: readonly FrogPlanInput[], tz: string, start: string, today: string): FrogDay[] {
  const byDate = new Map<string, FrogDay>();
  for (const p of plans) {
    if (!isDateKey(p.date) || p.date < start || p.date > today) continue;
    const day = evaluatePlan(p, tz);
    const prev = byDate.get(p.date);
    // (userId, date) is unique, but if duplicates ever appear, an eaten one wins.
    if (!prev || (!prev.eaten && day.eaten) || (!prev.planned && day.planned)) byDate.set(p.date, day);
  }
  const out: FrogDay[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) {
    out.push(byDate.get(d) ?? { date: d, planned: false, eaten: false, beforeNoon: false });
    if (d === today) break;
  }
  return out;
}

export function emptyAbcdeCounts(): AbcdeCounts {
  return { A: 0, B: 0, C: 0, D: 0, E: 0, none: 0 };
}

/**
 * Counts completed tasks per ABCDE letter (`none` for tasks without one). A task
 * counts when `localDateKey(completedAt, tz)` is within `start..today`; `start`
 * null means no lower bound. Tasks with no completedAt are skipped.
 */
export function bucketAbcde(
  tasks: readonly { abcde?: Abcde | null; completedAt: Date | string | null }[],
  tz: string,
  start: string | null,
  today: string,
): AbcdeCounts {
  const counts = emptyAbcdeCounts();
  for (const t of tasks) {
    if (t.completedAt == null) continue;
    const at = new Date(t.completedAt);
    if (Number.isNaN(at.getTime())) continue;
    const key = localDateKey(at, tz);
    if (key > today || (start !== null && key < start)) continue;
    const letter = t.abcde != null && (ABCDE_LETTERS as readonly string[]).includes(t.abcde) ? t.abcde : "none";
    counts[letter]++;
  }
  return counts;
}

export interface ReflectionPlanInput extends FrogPlanInput {
  reviewedAt: Date | string | null;
  rating: number | null;
  wentWell: string | null;
  improve: string | null;
  frogTask: { completedAt: Date | string | null; title: string } | null;
}

const hasText = (s: string | null | undefined) => typeof s === "string" && s.trim() !== "";

/**
 * The reflections journal: reviewed days (reviewedAt set) on or before `today`
 * that hold a rating or at least one text, newest first, at most `limit`.
 * `frogTitle` is null and `eaten` false when the day has no frog (callers null
 * `frogTask` for a frog in an excluded project).
 */
export function buildReflections(
  plans: readonly ReflectionPlanInput[],
  tz: string,
  today: string,
  limit: number = MAX_REFLECTIONS,
): FrogReflection[] {
  return plans
    .filter((p) => isDateKey(p.date) && p.date <= today && p.reviewedAt != null && (p.rating != null || hasText(p.wentWell) || hasText(p.improve)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit)
    .map((p) => ({
      date: p.date,
      rating: p.rating,
      wentWell: hasText(p.wentWell) ? p.wentWell : null,
      improve: hasText(p.improve) ? p.improve : null,
      frogTitle: p.frogTask?.title ?? null,
      eaten: evaluatePlan(p, tz).eaten,
    }));
}
