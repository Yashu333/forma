import type { Abcde, Task, TodayPayload } from "@/types";
import { openAtasks } from "./abcde";
import { localDateKey } from "./dates";

// Pure logic behind the "Today" view of /today (frog card, list, A-first rule).
// Client-safe, no React or fetch.

type SubtaskLike = Pick<Task, "order" | "statusId" | "completedAt">;

/** Done = `completedAt` is set (the task routes stamp it on entering a celebrate status). */
export function isTaskDone(task: { completedAt?: string | Date | null }): boolean {
  return task.completedAt != null;
}

/**
 * A subtask is done when it has a completedAt or sits in its project's Done
 * column. Subtasks live in the same group as the parent, so the parent's
 * `doneStatusId` applies.
 */
export function isSubtaskDone(sub: SubtaskLike, doneStatusId: string | null): boolean {
  return isTaskDone(sub) || (doneStatusId !== null && sub.statusId === doneStatusId);
}

export function subtaskProgress(
  subtasks: readonly SubtaskLike[],
  doneStatusId: string | null,
): { done: number; total: number } {
  return { done: subtasks.filter((s) => isSubtaskDone(s, doneStatusId)).length, total: subtasks.length };
}

/**
 * The next bite of the frog: the first unfinished subtask by `order` (the input
 * order breaks ties), or null when there are no subtasks or all are done.
 */
export function nextBite<T extends SubtaskLike>(subtasks: readonly T[], doneStatusId: string | null = null): T | null {
  const open = subtasks.map((s, i) => ({ s, i })).filter(({ s }) => !isSubtaskDone(s, doneStatusId));
  open.sort((a, b) => a.s.order - b.s.order || a.i - b.i);
  return open[0]?.s ?? null;
}

const isBorC = (letter: Abcde | null | undefined) => letter === "B" || letter === "C";

/** B and C rows show an "A tasks first" hint while any A task is still open. */
export function showAFirstHint(task: { abcde?: Abcde | null; completedAt?: string | Date | null }, openA: number): boolean {
  return openA > 0 && isBorC(task.abcde) && !isTaskDone(task);
}

/**
 * The inline notice for checking off a B/C task while A tasks are open, else
 * null. Never blocks anything. `openA` is the count before the check-off.
 */
export function aFirstNotice(task: { abcde?: Abcde | null }, openA: number): string | null {
  if (openA <= 0 || !isBorC(task.abcde)) return null;
  return `${openA} A-task${openA === 1 ? "" : "s"} still open — the book says finish those first.`;
}

/** Number of open A tasks in a task list (same rule as the API's `openA`). */
export function countOpenA(tasks: readonly { abcde?: Abcde | null; completedAt?: string | Date | null }[]): number {
  return openAtasks(tasks).length;
}

/**
 * The frog to show as today's frog. GET /api/today still returns an archived
 * frog (archiving doesn't touch the plan) so that an archived AND eaten frog
 * keeps showing as eaten; an archived frog that was never eaten has been
 * eliminated and counts as "no frog".
 */
export function activeFrog<T extends { archivedAt?: string | null; completedAt?: string | null }>(frog: T | null | undefined): T | null {
  if (!frog) return null;
  return frog.archivedAt != null && !frog.completedAt ? null : frog;
}

/**
 * Eaten = completed, and completed on or before the plan date in the user's
 * time zone (finishing it a day late doesn't count, matching the streak rule).
 */
export function isFrogEaten(frog: { completedAt?: string | null } | null, date: string, tz: string): boolean {
  if (!frog?.completedAt) return false;
  return localDateKey(new Date(frog.completedAt), tz) <= date;
}

/** Wall-clock time in `tz`, 24-hour with an unpadded hour: "9:42", "14:05". */
export function formatClockTime(iso: string | Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "numeric", minute: "2-digit" }).formatToParts(
    new Date(iso),
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${Number(get("hour")) % 24}:${get("minute")}`;
}

/** "Eaten at 9:42", or "Eaten on 2026-10-23 at 9:42" if it was eaten on another day. */
export function formatEatenAt(completedAt: string | Date, tz: string, date: string): string {
  const time = formatClockTime(completedAt, tz);
  const day = localDateKey(new Date(completedAt), tz);
  return day === date ? `Eaten at ${time}` : `Eaten on ${day} at ${time}`;
}

/** "Saturday, October 24" for a date key. Built in UTC so no time zone shifts the day. */
export function formatDateKeyLong(key: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${key}T00:00:00Z`),
  );
}

/** "🔥 4-day frog streak" while a streak is running, else null. */
export function streakLabel(current: number): string | null {
  return current > 0 ? `🔥 ${current}-day frog streak` : null;
}

/**
 * Applies a task's new state (what PATCH /api/tasks/[id] returned) to the
 * payload: the list row, the frog card, and `openA`. Streak and completedToday
 * need the server, so the caller refetches afterwards.
 */
export function applyTaskUpdate(
  payload: TodayPayload,
  updated: { id: string; statusId: string; completedAt?: string | null },
): TodayPayload {
  const patch = { statusId: updated.statusId, completedAt: updated.completedAt ?? null };
  const tasks = payload.tasks.map((t) => (t.id === updated.id ? { ...t, ...patch } : t));
  const frog = payload.frog && payload.frog.id === updated.id ? { ...payload.frog, ...patch } : payload.frog;
  return { ...payload, tasks, frog, openA: countOpenA(tasks) };
}

/** Drops a task from the list after it was archived (and from the frog card if it was the frog). */
export function removeTask(payload: TodayPayload, id: string): TodayPayload {
  const tasks = payload.tasks.filter((t) => t.id !== id);
  const frog = payload.frog && payload.frog.id === id ? null : payload.frog;
  return { ...payload, tasks, frog, openA: countOpenA(tasks) };
}

/** True when the plan has been saved through the morning flow (the Today view shows). */
export function isPlanned(payload: Pick<TodayPayload, "plan">): boolean {
  return payload.plan?.plannedAt != null;
}
