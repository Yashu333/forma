import { addDays, isDateKey } from "@/lib/frog/dates";
import { mondayOf, weekdayOf } from "@/lib/recurrence/rule";

// Week maths for the weekly review. Weeks run Monday to Sunday and are named
// by their Monday's date key.

export function weekStartOf(key: string): string {
  return mondayOf(key);
}

export function isWeekStart(v: unknown): v is string {
  return isDateKey(v) && weekdayOf(v) === 1;
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * The week the review is about by default: this week from Friday to Sunday
 * (it is nearly over), otherwise the week that just ended.
 */
export function defaultReviewWeek(today: string): string {
  const dow = weekdayOf(today);
  const thisWeek = mondayOf(today);
  return dow === 5 || dow === 6 || dow === 0 ? thisWeek : addDays(thisWeek, -7);
}

/** True on the days the app nudges you to review: Friday to Monday. */
export function isReviewNudgeDay(today: string): boolean {
  const dow = weekdayOf(today);
  return dow === 5 || dow === 6 || dow === 0 || dow === 1;
}
