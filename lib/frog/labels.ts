import type { Abcde } from "@/types";

// Pure logic for the "Label tasks" screen (/today/label): tap a letter to put a
// task at the end of that letter (A1, A2, A3…), tap it again to clear it, move
// a task up or down inside its letter. Every edit renumbers the letters it
// touches to 1..n, so there are never gaps or duplicates. Client-safe.

export interface Labelled {
  id: string;
  abcde: Abcde | null;
  abcdeRank: number | null;
}

/** One task's new label, as sent to PATCH /api/abcde. */
export interface LabelChange {
  id: string;
  abcde: Abcde | null;
  abcdeRank: number | null;
}

/** "A1" for a ranked task, "A" for an unranked one, "" when there's no letter. */
export function labelCode(task: { abcde?: Abcde | null; abcdeRank?: number | null }): string {
  if (task.abcde == null) return "";
  return task.abcdeRank == null ? task.abcde : `${task.abcde}${task.abcdeRank}`;
}

/**
 * The tasks labelled `letter`, in label order: ranked ones by rank, then
 * unranked ones. Ties keep the input order (Array.prototype.sort is stable).
 */
export function inLetter<T extends Labelled>(tasks: readonly T[], letter: Abcde): T[] {
  return tasks
    .filter((t) => t.abcde === letter)
    .sort((a, b) => (a.abcdeRank ?? Infinity) - (b.abcdeRank ?? Infinity));
}

// The changes that number `ordered` 1..n under `letter`, skipping tasks that already match.
function renumber(ordered: readonly Labelled[], letter: Abcde): LabelChange[] {
  const changes: LabelChange[] = [];
  ordered.forEach((t, i) => {
    if (t.abcde !== letter || t.abcdeRank !== i + 1) changes.push({ id: t.id, abcde: letter, abcdeRank: i + 1 });
  });
  return changes;
}

/**
 * Tapping `letter` on a task. A different letter moves the task to the end of
 * that letter and closes the gap it left; the same letter clears the label.
 * Returns only the tasks whose label changes (empty for an unknown id).
 */
export function tapLetter(tasks: readonly Labelled[], id: string, letter: Abcde): LabelChange[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return [];
  const from = task.abcde;
  const changes: LabelChange[] = [];
  if (from !== null) {
    changes.push(...renumber(inLetter(tasks, from).filter((t) => t.id !== id), from));
  }
  if (from === letter) {
    changes.push({ id, abcde: null, abcdeRank: null });
  } else {
    changes.push(...renumber([...inLetter(tasks, letter), task], letter));
  }
  return changes;
}

/**
 * Numbers one letter in the order its tasks were tapped: `ids[0]` becomes
 * `letter`1, the next `letter`2… Tasks of that letter not in `ids` follow, in
 * their current order. Ids of other letters are ignored.
 */
export function numberInOrder(tasks: readonly Labelled[], letter: Abcde, ids: readonly string[]): LabelChange[] {
  const inL = inLetter(tasks, letter);
  const tapped = ids.map((id) => inL.find((t) => t.id === id)).filter((t): t is Labelled => !!t);
  const rest = inL.filter((t) => !ids.includes(t.id));
  return renumber([...tapped, ...rest], letter);
}

/** The list with `changes` applied (tasks not mentioned are returned as they are). */
export function applyLabels<T extends Labelled>(tasks: readonly T[], changes: readonly LabelChange[]): T[] {
  if (changes.length === 0) return [...tasks];
  const byId = new Map(changes.map((c) => [c.id, c]));
  return tasks.map((t) => {
    const c = byId.get(t.id);
    return c ? { ...t, abcde: c.abcde, abcdeRank: c.abcdeRank } : t;
  });
}
