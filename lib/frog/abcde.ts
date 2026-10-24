import type { Abcde, Priority } from "@/types";

export const ABCDE_LETTERS: readonly Abcde[] = ["A", "B", "C", "D", "E"];

export const ABCDE_META: Record<Abcde, { label: string; description: string; color: string }> = {
  A: { label: "Must do", description: "Serious consequences if it isn't done.", color: "#F87171" },
  B: { label: "Should do", description: "Mild consequences if it isn't done.", color: "#FB923C" },
  C: { label: "Nice to do", description: "No consequences either way.", color: "#60A5FA" },
  D: { label: "Delegate", description: "Someone else could do this for you.", color: "#A78BFA" },
  E: { label: "Eliminate", description: "Not worth doing at all.", color: "#9CA3AF" },
};

// The subset of a task the ABCDE helpers read, so they work on DB rows, API
// payloads and test fixtures alike.
export interface AbcdeSortable {
  abcde?: Abcde | null;
  abcdeRank?: number | null;
  priority: Priority;
  order: number;
}

// Lower sorts first.
const LETTER_ORDER: Record<Abcde, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
const PRIORITY_ORDER: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// Ascending, with null/undefined after every real value.
function cmpNullLast(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/**
 * Sort order for the daily list: letter A→E (unlabelled last), then rank within
 * the letter (unranked last), then priority URGENT→LOW, then board `order`.
 * Returns 0 for a full tie, so Array.prototype.sort keeps the input order.
 */
export function compareTasks(a: AbcdeSortable, b: AbcdeSortable): number {
  return (
    cmpNullLast(a.abcde == null ? null : LETTER_ORDER[a.abcde], b.abcde == null ? null : LETTER_ORDER[b.abcde]) ||
    cmpNullLast(a.abcdeRank, b.abcdeRank) ||
    cmpNullLast(PRIORITY_ORDER[a.priority], PRIORITY_ORDER[b.priority]) ||
    a.order - b.order
  );
}

/** "A-1" for a ranked task, "A" for an unranked one, "" when there's no letter. */
export function formatAbcde(task: Pick<AbcdeSortable, "abcde" | "abcdeRank">): string {
  if (task.abcde == null) return "";
  return task.abcdeRank == null ? task.abcde : `${task.abcde}-${task.abcdeRank}`;
}

/**
 * The A tasks that aren't done yet. "Done" means `completedAt` is set: the task
 * routes stamp it when a task enters a celebrate status and clear it when it
 * leaves, so it is the single source of truth for done-ness.
 */
export function openAtasks<T extends { abcde?: Abcde | null; completedAt?: Date | string | null }>(
  tasks: readonly T[],
): T[] {
  return tasks.filter((t) => t.abcde === "A" && !t.completedAt);
}
