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
  order: number;
  dueDate: string | null; // ISO instant
  plannedFor: string | null; // local date the task is planned for (Today's list)
  scheduledAt: string | null; // time block start, ISO instant
  blockMinutes: number | null; // time block length; null = DEFAULT_BLOCK
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
  /** Tasks with a time block starting in the range. */
  blocks: CalTask[];
  /** Tasks planned (plannedFor) for a day in the range. */
  planned: CalTask[];
  /** Day key → that day's frog task id. */
  frogs: Record<string, string>;
}

export type CalItem =
  | { kind: "task"; task: CalTask }
  | { kind: "ghost"; rec: CalRecurring; date: string };

export type CalView = "month" | "week" | "day";

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

// ── Time blocks (the Day view) ──

export const DEFAULT_BLOCK = 60;
export const SNAP = 15;
export const DAY_MINUTES = 24 * 60;
/** Where "Fill my day" starts on a future day. */
export const WORKDAY_START = 9 * 60;

export const snap = (min: number) => Math.round(min / SNAP) * SNAP;
export const blockLength = (task: Pick<CalTask, "blockMinutes">) => task.blockMinutes ?? DEFAULT_BLOCK;

/** Minutes since local midnight. */
export function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** The instant `minutes` after local midnight on `dayKey`. */
export function slotIso(dayKey: string, minutes: number): string {
  const d = keyToDate(dayKey);
  d.setHours(0, minutes, 0, 0);
  return d.toISOString();
}

/** "9:00 am" or "2:30 pm", like timeText. */
export function clockText(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "45m", "1h", "1h 30m". */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export interface Span { id: string; start: number; end: number }

/** Side-by-side columns for overlapping blocks: each block's column and the column count of its cluster. */
export function layoutBlocks(spans: Span[]): Map<string, { col: number; cols: number }> {
  const out = new Map<string, { col: number; cols: number }>();
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: { span: Span; col: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) out.set(c.span.id, { col: c.col, cols });
    cluster = [];
  };
  for (const span of sorted) {
    if (cluster.length > 0 && span.start >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => c.span.end > span.start).map((c) => c.col));
    let col = 0;
    while (taken.has(col)) col++;
    cluster.push({ span, col });
    clusterEnd = Math.max(clusterEnd, span.end);
  }
  if (cluster.length > 0) flush();
  return out;
}

/** The first start at or after `from` where `minutes` fits between the existing blocks, or null if the day is full. */
export function nextFreeStart(spans: Span[], minutes: number, from: number): number | null {
  let start = Math.ceil(from / SNAP) * SNAP;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.end <= start) continue;
    if (s.start >= start + minutes) break;
    start = Math.max(start, s.end);
  }
  return start + minutes <= DAY_MINUTES ? start : null;
}
