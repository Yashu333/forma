import type { Abcde, Priority, Task } from "@/types";
import type { RepeatRule } from "@/lib/recurrence/rule";

// The fetch calls the command palette makes. Each throws an Error carrying the
// server's `{ error }` message so the UI can show it.

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

export interface PaletteProject {
  id: string;
  name: string;
  color: string;
}

export async function fetchProjects(): Promise<PaletteProject[]> {
  const groups = await json<PaletteProject[]>(await fetch("/api/groups"), "Couldn't load your projects");
  return groups.map((g) => ({ id: g.id, name: g.name, color: g.color }));
}

export interface CaptureBody {
  title: string;
  groupId: string;
  priority?: Priority | null;
  dueDate?: string | null;
  plannedFor?: string | null;
  repeat?: RepeatRule | null;
}

export type CapturedTask = Task & { group: { id: string; name: string; color: string } };

export async function captureTask(body: CaptureBody): Promise<CapturedTask> {
  return json(
    await fetch("/api/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    "Couldn't add the task",
  );
}

export interface SearchResult {
  id: string;
  title: string;
  parentTaskId: string | null;
  parentTitle: string | null;
  done: boolean;
  dueDate: string | null;
  priority: Priority;
  abcde: Abcde | null;
  abcdeRank: number | null;
  group: { id: string; name: string; color: string };
}

export async function searchTasks(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  return json(await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal }), "Search failed");
}
