import { format } from "date-fns";
import type { Abcde, Priority, Status } from "@/types";
import { addDays, localDateKey } from "@/lib/frog/dates";
import { mondayOf } from "@/lib/recurrence/rule";

export interface CalTask {
  id: string;
  title: string;
  groupId: string;
  statusId: string;
  priority: Priority;
  dueDate: string | null; // ISO instant
  repeat: unknown;
  abcde: Abcde | null;
  abcdeRank: number | null;
  completedAt: string | null;
  group: { id: string; name: string; color: string };
  done: boolean;
}

export interface CalRecurring {
  id: string;
  title: string;
  repeat: unknown;
  dueDate: string;
  group: { id: string; name: string; color: string };
}

export interface CalendarPayload {
  tasks: CalTask[];
  overdue: CalTask[];
  unscheduled: CalTask[];
  statusesByGroup: Record<string, Status[]>;
  recurring: CalRecurring[];
}

export type CalItem =
  | { kind: "task"; task: CalTask }
  | { kind: "ghost"; rec: CalRecurring; date: string };

export type CalView = "month" | "week";

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function dueKeyOf(task: CalTask, tz: string): string | null {
  return task.dueDate ? localDateKey(new Date(task.dueDate), tz) : null;
}

export function timeText(iso: string): string {
  return format(new Date(iso), "h:mm a").toLowerCase();
}

/** Moving a task to a day keeps its time of day; an unscheduled task gets the next full hour. */
export function rescheduleIso(task: CalTask, dayKey: string): string {
  const day = keyToDate(dayKey);
  if (task.dueDate) {
    const old = new Date(task.dueDate);
    day.setHours(old.getHours(), old.getMinutes(), 0, 0);
  } else {
    const now = new Date();
    day.setHours(now.getHours() + 1, 0, 0, 0);
  }
  return day.toISOString();
}

/** The 42 day keys of a month grid (six Monday-first weeks). */
export function monthGrid(anchorKey: string): string[] {
  const first = `${anchorKey.slice(0, 7)}-01`;
  const start = mondayOf(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDays(anchorKey: string): string[] {
  const start = mondayOf(anchorKey);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
