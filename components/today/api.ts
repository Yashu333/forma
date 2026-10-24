import type { Task, TodayCandidate, TodayPayload } from "@/types";
import type { TodayPutBody } from "@/lib/frog/plan";

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

export async function fetchCandidates(): Promise<TodayCandidate[]> {
  return json(await fetch("/api/today/candidates"), "Couldn't load your tasks");
}

export async function savePlan(body: TodayPutBody): Promise<TodayPayload> {
  return json(
    await fetch("/api/today", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    "Couldn't save the plan",
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
  return patchTask(id, { statusId: doneStatusId }, "Couldn't mark that done");
}

/** Archives a task. `archived` is sent ALONE: the route rejects it combined with other fields. */
export function archiveTask(id: string): Promise<Task> {
  return patchTask(id, { archived: true }, "Couldn't archive that task");
}
