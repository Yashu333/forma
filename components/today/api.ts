import type { LabelProject, LabelTask, Task, TodayPayload } from "@/types";
import type { LabelChange } from "@/lib/frog/labels";
import type { TodayPutBody } from "@/lib/frog/plan";
import type { ReviewPostBody } from "@/lib/frog/review";

// The fetch calls the /today page makes, in one place. Each throws an Error
// carrying the server's `{ error }` message so the UI can show it.

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    let message = fallback;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // not JSON: keep the fallback
    }
    throw new Error(message);
  }
  return res.json();
}

export async function fetchToday(date: string, tz: string): Promise<TodayPayload> {
  const qs = new URLSearchParams({ date, tz });
  return json(await fetch(`/api/today?${qs.toString()}`), "Couldn't load today's plan");
}

export async function savePlan(body: TodayPutBody): Promise<TodayPayload> {
  return json(
    await fetch("/api/today", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    "Couldn't save the plan",
  );
}

/** Closes the day (or edits the review of a closed one); returns the refreshed payload. */
export async function saveReview(body: ReviewPostBody): Promise<TodayPayload> {
  return json(
    await fetch("/api/today/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    "Couldn't save the review",
  );
}

async function patchTask(id: string, body: Record<string, unknown>, fallback: string): Promise<Task> {
  return json(
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    fallback,
  );
}

/** Marks a task done by moving it into its project's Done column. */
export function markTaskDone(id: string, doneStatusId: string): Promise<Task> {
  return patchTask(id, { statusId: doneStatusId, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }, "Couldn't mark that done");
}

/**
 * Saves the frog-first setting. Sends ONLY this field (the route leaves the
 * Pomodoro fields alone when they're omitted) and ignores the response body,
 * which is the whole settings row.
 */
export async function saveFrogFirstMode(on: boolean): Promise<void> {
  await json<unknown>(
    await fetch("/api/user-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frogFirstMode: on }) }),
    "Couldn't save that setting",
  );
}

/** Archives a task. `archived` is sent ALONE: the route rejects it combined with other fields. */
export function archiveTask(id: string): Promise<Task> {
  return patchTask(id, { archived: true }, "Couldn't archive that task");
}

// ── Label tasks screen (/today/label) ────────────────────────────────────────

export async function fetchLabels(): Promise<{ tasks: LabelTask[]; projects: LabelProject[] }> {
  return json(await fetch("/api/abcde"), "Couldn't load your tasks");
}

/** Adds a task to the first open column of `groupId`. */
export async function addLabelTask(title: string, groupId: string): Promise<LabelTask> {
  return json(
    await fetch("/api/abcde", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, groupId }) }),
    "Couldn't add that task",
  );
}

/** Saves several labels in one request (all or nothing). */
export async function saveLabels(updates: LabelChange[]): Promise<void> {
  await json<unknown>(
    await fetch("/api/abcde", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates }) }),
    "Couldn't save those labels",
  );
}

/** Renames a task (the New tasks screen's typo fix). */
export async function renameTask(id: string, title: string): Promise<void> {
  await patchTask(id, { title }, "Couldn't rename that task");
}

/** Moves a task to the trash. */
export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) await json<unknown>(res, "Couldn't remove that task"); // throws with the server's message
  // 204: no body to read
}
