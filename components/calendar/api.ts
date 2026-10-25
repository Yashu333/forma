import type { Task } from "@/types";
import type { CalendarPayload } from "./types";

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

export async function fetchCalendar(from: string, to: string, tz: string, signal?: AbortSignal): Promise<CalendarPayload> {
  const qs = new URLSearchParams({ from, to, tz });
  return json(await fetch(`/api/calendar?${qs.toString()}`, { signal }), "Couldn't load the calendar");
}

export async function setDueDate(id: string, dueDate: string | null): Promise<Task> {
  return json(
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dueDate }) }),
    "Couldn't reschedule that task",
  );
}

export async function fetchTask(id: string): Promise<Task> {
  return json(await fetch(`/api/tasks/${id}`), "Couldn't open that task");
}

/** Sets or clears a task's time block, or just its length (and, when given, the day it's planned for). */
export async function setTimeBlock(
  id: string,
  block: { scheduledAt?: string | null; blockMinutes?: number | null; plannedFor?: string },
): Promise<Task> {
  return json(
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(block) }),
    "Couldn't save that time block",
  );
}
