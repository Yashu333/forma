import type { Abcde, Priority, TodayCandidate, TodayTask } from "@/types";
import { compareTasks } from "./abcde";
import { MAX_PLAN_TASKS } from "./today";

// Pure logic behind the "Plan my day" stepper (Pick -> Label -> Choose your
// frog). No React, no fetch, no DB: client-safe and unit-tested. The component
// holds three small pieces of state (selected ids, labels, picked frog) and
// calls these to derive everything else.

/** Above this many tasks the Pick step shows a gentle "fewer tasks" hint. */
export const PLAN_HINT_THRESHOLD = 7;
export const PLAN_HINT = "Fewer, more important tasks beat a long list.";

export interface PlanLabel {
  abcde: Abcde | null;
  abcdeRank: number | null;
}
/** The wanted letter and rank of every item, by task id. */
export type PlanLabels = Record<string, PlanLabel>;

/** A task the plan editor can pick, whether it came from /api/today or from the candidates. */
export interface PlanItem extends PlanLabel {
  id: string;
  title: string;
  priority: Priority;
  order: number;
  group: { id: string; name: string; color: string };
  /** Already done (completedAt set). Done tasks stay in the plan unless unchecked. */
  done: boolean;
}

/**
 * Everything the editor can offer: the candidates (open tasks, in project order)
 * followed by the planned tasks that aren't candidates, which are the DONE ones.
 * PUT /api/today treats `taskIds` as the WHOLE plan, so the done tasks have to be
 * in here (and start checked) or editing the plan after eating the frog would
 * un-plan it. Where a task is in both lists the planned copy wins (fresher).
 */
export function buildPlanItems(tasks: readonly TodayTask[], candidates: readonly TodayCandidate[]): PlanItem[] {
  const planned = new Map(tasks.map((t) => [t.id, t]));
  const fromPlanned = (t: TodayTask): PlanItem => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    order: t.order,
    group: { id: t.group.id, name: t.group.name, color: t.group.color },
    abcde: t.abcde ?? null,
    abcdeRank: t.abcdeRank ?? null,
    done: t.completedAt != null,
  });

  const items: PlanItem[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const p = planned.get(c.id);
    items.push(
      p
        ? fromPlanned(p)
        : {
            id: c.id,
            title: c.title,
            priority: c.priority,
            order: c.order,
            group: { id: c.group.id, name: c.group.name, color: c.group.color },
            abcde: c.abcde ?? null,
            abcdeRank: c.abcdeRank ?? null,
            done: false,
          },
    );
  }
  for (const t of tasks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    items.push(fromPlanned(t));
  }
  return items;
}

/** The ids already planned for the date (done ones included): the starting checkmarks. */
export function initialSelection(tasks: readonly TodayTask[]): string[] {
  return tasks.map((t) => t.id);
}

/** The letter and rank each item has right now (the baseline the editor changes). */
export function initialLabels(items: readonly PlanItem[]): PlanLabels {
  const labels: PlanLabels = {};
  for (const i of items) labels[i.id] = { abcde: i.abcde, abcdeRank: i.abcde === null ? null : i.abcdeRank };
  return labels;
}

/** Adds `id` to the selection, or removes it when it's already there. */
export function toggleSelected(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

export interface ProjectGroup {
  group: { id: string; name: string; color: string };
  items: PlanItem[];
}

/** Items grouped by project, in the order each project first appears. */
export function groupByProject(items: readonly PlanItem[]): ProjectGroup[] {
  const out: ProjectGroup[] = [];
  const index = new Map<string, ProjectGroup>();
  for (const item of items) {
    let g = index.get(item.group.id);
    if (!g) {
      g = { group: item.group, items: [] };
      index.set(item.group.id, g);
      out.push(g);
    }
    g.items.push(item);
  }
  return out;
}

/** `items` with the wanted letters and ranks applied. */
export function withLabels(items: readonly PlanItem[], labels: PlanLabels): PlanItem[] {
  return items.map((i) => {
    const l = labels[i.id];
    return l ? { ...i, abcde: l.abcde, abcdeRank: l.abcde === null ? null : l.abcdeRank } : i;
  });
}

/** The selected items, labelled and sorted with compareTasks (A-1 first). */
export function sortedSelected(items: readonly PlanItem[], selected: readonly string[], labels: PlanLabels): PlanItem[] {
  const picked = new Set(selected);
  return withLabels(items.filter((i) => picked.has(i.id)), labels).sort(compareTasks);
}

/** Gives `id` the letter (a different letter resets the rank, like PATCH does). */
export function setLetter(labels: PlanLabels, id: string, letter: Abcde | null): PlanLabels {
  const current = labels[id]?.abcde ?? null;
  if (current === letter) return labels;
  return { ...labels, [id]: { abcde: letter, abcdeRank: null } };
}

/** Tapping the letter a task already has clears it; any other letter sets it. */
export function toggleLetter(labels: PlanLabels, id: string, letter: Abcde): PlanLabels {
  return setLetter(labels, id, (labels[id]?.abcde ?? null) === letter ? null : letter);
}

/** Where `id` stands among the selected tasks with its letter (null when it has none). */
export function rankPosition(
  items: readonly PlanItem[],
  selected: readonly string[],
  labels: PlanLabels,
  id: string,
): { index: number; count: number } | null {
  const letter = labels[id]?.abcde ?? null;
  if (letter === null) return null;
  const group = sortedSelected(items, selected, labels).filter((i) => i.abcde === letter);
  const index = group.findIndex((i) => i.id === id);
  return index === -1 ? null : { index, count: group.length };
}

/**
 * Moves `id` one place up (-1) or down (+1) among the selected tasks with the
 * same letter, then numbers that whole group 1..n in its new order. Numbering
 * the group (rather than swapping two ranks) makes the first tap turn the order
 * the user can already see into real ranks. A no-op returns `labels` itself.
 */
export function moveRank(
  items: readonly PlanItem[],
  selected: readonly string[],
  labels: PlanLabels,
  id: string,
  direction: -1 | 1,
): PlanLabels {
  const letter = labels[id]?.abcde ?? null;
  if (letter === null) return labels;
  const group = sortedSelected(items, selected, labels).filter((i) => i.abcde === letter);
  const from = group.findIndex((i) => i.id === id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= group.length) return labels;
  const ordered = group.map((i) => i.id);
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  const next = { ...labels };
  ordered.forEach((taskId, i) => {
    next[taskId] = { abcde: letter, abcdeRank: i + 1 };
  });
  return next;
}

/**
 * The frog to suggest: the first open task in A-1 order, which is the A-1 task
 * when there is an A and simply the first task when there isn't. An already
 * eaten task is only suggested when nothing open is left. `sorted` must come
 * from sortedSelected.
 */
export function suggestFrog(sorted: readonly PlanItem[]): string | null {
  return (sorted.find((i) => !i.done) ?? sorted[0])?.id ?? null;
}

/**
 * The frog the stepper shows as chosen: the user's tap if that task is still in
 * the plan, else the frog already saved on the plan (if still in it), else the
 * suggestion. Derived on every render, so un-ticking the chosen task or
 * relabelling can never leave a stale frog behind.
 */
export function resolveFrog(
  sorted: readonly PlanItem[],
  picked: string | null,
  planFrogId: string | null,
): string | null {
  const has = (id: string | null): id is string => id !== null && sorted.some((i) => i.id === id);
  if (has(picked)) return picked;
  if (has(planFrogId)) return planFrogId;
  return suggestFrog(sorted);
}

/** The hint for a plan of `count` tasks, or null while the plan is short. */
export function planSizeHint(count: number): string | null {
  return count > PLAN_HINT_THRESHOLD ? PLAN_HINT : null;
}

/** Why a plan of `count` tasks can't go on (none picked, or more than the API takes), or null. */
export function countProblem(count: number): string | null {
  if (count === 0) return "Pick at least one task for today.";
  if (count > MAX_PLAN_TASKS) return `A day can hold at most ${MAX_PLAN_TASKS} tasks.`;
  return null;
}

/** Why the plan can't be saved yet (count first, then a missing frog), or null when it's fine. */
export function planProblem(count: number, frogId: string | null): string | null {
  return countProblem(count) ?? (frogId === null ? "Choose your frog to save the plan." : null);
}

/** The body of PUT /api/today. */
export interface TodayPutBody {
  date: string;
  tz: string;
  taskIds: string[];
  ranks: Record<string, PlanLabel>;
  frogTaskId: string | null;
  finalize: boolean;
}

/**
 * Builds the PUT body. `taskIds` is the whole plan (the server un-plans anything
 * planned for the date that is missing). `ranks` holds only the tasks whose
 * letter or rank changed, each as its FULL wanted state: a task without a letter
 * is `{ abcde: null, abcdeRank: null }` (a rank without a letter is a 400).
 * `items` must be the original, unlabelled items: that is the baseline.
 */
export function buildPutBody(args: {
  date: string;
  tz: string;
  items: readonly PlanItem[];
  selected: readonly string[];
  labels: PlanLabels;
  frogTaskId: string | null;
  finalize?: boolean;
}): TodayPutBody {
  const { date, tz, items, selected, labels, frogTaskId, finalize = true } = args;
  const picked = new Set(selected);
  const taskIds = items.filter((i) => picked.has(i.id)).map((i) => i.id);
  const ranks: Record<string, PlanLabel> = {};
  for (const item of items) {
    if (!picked.has(item.id)) continue;
    const want = labels[item.id];
    if (!want) continue;
    const abcde = want.abcde;
    const abcdeRank = abcde === null ? null : want.abcdeRank;
    const baseRank = item.abcde === null ? null : item.abcdeRank;
    if (abcde !== item.abcde || abcdeRank !== baseRank) ranks[item.id] = { abcde, abcdeRank };
  }
  return { date, tz, taskIds, ranks, frogTaskId, finalize };
}
