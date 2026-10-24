import { describe, expect, it } from "vitest";
import type { Priority, TodayCandidate, TodayTask } from "@/types";
import {
  buildPlanItems,
  buildPutBody,
  countProblem,
  groupByProject,
  initialLabels,
  initialSelection,
  moveRank,
  planProblem,
  planSizeHint,
  PLAN_HINT,
  rankPosition,
  resolveFrog,
  setLetter,
  sortedSelected,
  suggestFrog,
  toggleLetter,
  toggleSelected,
  withLabels,
  type PlanItem,
  type PlanLabels,
} from "./plan";
import { parseTodayPut } from "./today";

const G1 = { id: "g1", name: "Work", color: "#111111" };
const G2 = { id: "g2", name: "Home", color: "#222222" };

let seq = 0;
function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  return { title: over.id, priority: "MEDIUM", order: seq++, group: G1, abcde: null, abcdeRank: null, done: false, ...over };
}
function cand(over: Partial<TodayCandidate> & { id: string }): TodayCandidate {
  return {
    title: over.id, groupId: "g1", statusId: "s1", priority: "MEDIUM", order: seq++, abcde: null, abcdeRank: null,
    plannedFor: null, dueDate: null, group: G1, ...over,
  };
}
function task(over: Partial<TodayTask> & { id: string }): TodayTask {
  return {
    title: over.id, groupId: "g1", statusId: "s1", priority: "MEDIUM" as Priority, order: seq++, createdBy: "u", createdAt: "", updatedAt: "",
    abcde: null, abcdeRank: null, plannedFor: "2026-10-24", completedAt: null, group: { ...G1, doneStatusId: "done1" }, ...over,
  };
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("buildPlanItems", () => {
  it("lists candidates first, then planned tasks that are not candidates (the done ones)", () => {
    const items = buildPlanItems(
      [task({ id: "done", completedAt: "2026-10-24T08:00:00Z" }), task({ id: "open" })],
      [cand({ id: "open" }), cand({ id: "other" })],
    );
    expect(ids(items)).toEqual(["open", "other", "done"]);
    expect(items.find((i) => i.id === "done")!.done).toBe(true);
    expect(items.find((i) => i.id === "open")!.done).toBe(false);
  });

  it("prefers the planned copy of a task that is in both lists", () => {
    const items = buildPlanItems([task({ id: "x", title: "fresh", abcde: "A", abcdeRank: 2 })], [cand({ id: "x", title: "stale" })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "fresh", abcde: "A", abcdeRank: 2 });
  });

  it("copies the project and defaults missing letters to null", () => {
    const [i] = buildPlanItems([], [cand({ id: "c", group: G2 })]);
    expect(i.group).toEqual(G2);
    expect(i).toMatchObject({ abcde: null, abcdeRank: null, done: false });
  });

  it("does not duplicate a repeated id", () => {
    expect(buildPlanItems([task({ id: "a" }), task({ id: "a" })], [cand({ id: "b" }), cand({ id: "b" })])).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(buildPlanItems([], [])).toEqual([]);
  });
});

describe("initialSelection / initialLabels / toggleSelected", () => {
  it("starts with every task planned for the date, done ones included", () => {
    expect(initialSelection([task({ id: "a" }), task({ id: "b", completedAt: "2026-10-24T08:00:00Z" })])).toEqual(["a", "b"]);
    expect(initialSelection([])).toEqual([]);
  });

  it("takes labels from the items and drops a rank that has no letter", () => {
    const labels = initialLabels([item({ id: "a", abcde: "A", abcdeRank: 1 }), item({ id: "b" }), item({ id: "c", abcde: null, abcdeRank: 3 })]);
    expect(labels).toEqual({ a: { abcde: "A", abcdeRank: 1 }, b: { abcde: null, abcdeRank: null }, c: { abcde: null, abcdeRank: null } });
  });

  it("toggles without mutating", () => {
    const start = ["a", "b"];
    expect(toggleSelected(start, "c")).toEqual(["a", "b", "c"]);
    expect(toggleSelected(start, "a")).toEqual(["b"]);
    expect(start).toEqual(["a", "b"]);
  });
});

describe("groupByProject", () => {
  it("groups in first-appearance order and keeps item order inside a group", () => {
    const out = groupByProject([item({ id: "1", group: G2 }), item({ id: "2" }), item({ id: "3", group: G2 })]);
    expect(out.map((g) => g.group.id)).toEqual(["g2", "g1"]);
    expect(ids(out[0].items)).toEqual(["1", "3"]);
  });
  it("is empty for no items", () => {
    expect(groupByProject([])).toEqual([]);
  });
});

describe("labels and sorting", () => {
  const items = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" }), item({ id: "d" })];
  const base = initialLabels(items);

  it("setLetter sets the letter, resets the rank, and keeps identity on a no-op", () => {
    const ranked: PlanLabels = { ...base, a: { abcde: "A", abcdeRank: 2 } };
    expect(setLetter(ranked, "a", "B").a).toEqual({ abcde: "B", abcdeRank: null });
    expect(setLetter(ranked, "a", null).a).toEqual({ abcde: null, abcdeRank: null });
    expect(setLetter(ranked, "a", "A")).toBe(ranked);
  });

  it("toggleLetter clears the letter you tap twice", () => {
    const once = toggleLetter(base, "a", "C");
    expect(once.a.abcde).toBe("C");
    expect(toggleLetter(once, "a", "C").a.abcde).toBeNull();
    expect(toggleLetter(once, "a", "A").a.abcde).toBe("A");
  });

  it("withLabels applies labels and forces a null rank when there is no letter", () => {
    const out = withLabels(items, { a: { abcde: null, abcdeRank: 4 }, b: { abcde: "B", abcdeRank: 2 } });
    expect(out[0]).toMatchObject({ abcde: null, abcdeRank: null });
    expect(out[1]).toMatchObject({ abcde: "B", abcdeRank: 2 });
    expect(out[2]).toBe(items[2]); // no label: untouched
  });

  it("sortedSelected keeps only picked tasks and sorts A first, null letters last", () => {
    const labels: PlanLabels = { ...base, a: { abcde: "C", abcdeRank: null }, b: { abcde: "A", abcdeRank: null }, d: { abcde: "B", abcdeRank: null } };
    expect(ids(sortedSelected(items, ["a", "b", "c"], labels))).toEqual(["b", "a", "c"]);
  });

  it("re-sorts live: relabelling changes the order, rank orders inside a letter", () => {
    let labels = base;
    for (const id of ["a", "b", "c"]) labels = setLetter(labels, id, "A");
    labels = { ...labels, c: { abcde: "A", abcdeRank: 1 }, a: { abcde: "A", abcdeRank: 2 } };
    expect(ids(sortedSelected(items, ["a", "b", "c"], labels))).toEqual(["c", "a", "b"]); // unranked b last
  });

  it("falls back to priority then board order for the same letter and rank", () => {
    const p = [item({ id: "low", priority: "LOW", order: 0 }), item({ id: "urgent", priority: "URGENT", order: 5 })];
    expect(ids(sortedSelected(p, ["low", "urgent"], initialLabels(p)))).toEqual(["urgent", "low"]);
  });
});

describe("moveRank / rankPosition", () => {
  const items = [item({ id: "a1" }), item({ id: "a2" }), item({ id: "a3" }), item({ id: "b1" })];
  const sel = ["a1", "a2", "a3", "b1"];
  let labels = initialLabels(items);
  for (const id of ["a1", "a2", "a3"]) labels = setLetter(labels, id, "A");
  labels = setLetter(labels, "b1", "B");

  it("reports the position among the same letter only", () => {
    expect(rankPosition(items, sel, labels, "a2")).toEqual({ index: 1, count: 3 });
    expect(rankPosition(items, sel, labels, "b1")).toEqual({ index: 0, count: 1 });
  });
  it("has no position without a letter, for an unselected task, or an unknown id", () => {
    expect(rankPosition(items, sel, initialLabels(items), "a1")).toBeNull();
    expect(rankPosition(items, ["a1"], labels, "a2")).toBeNull();
    expect(rankPosition(items, sel, labels, "ghost")).toBeNull();
  });

  it("the first tap numbers the whole letter group in its visible order", () => {
    const next = moveRank(items, sel, labels, "a3", -1);
    expect(next.a1).toEqual({ abcde: "A", abcdeRank: 1 });
    expect(next.a3).toEqual({ abcde: "A", abcdeRank: 2 });
    expect(next.a2).toEqual({ abcde: "A", abcdeRank: 3 });
    expect(ids(sortedSelected(items, sel, next))).toEqual(["a1", "a3", "a2", "b1"]);
    expect(next.b1).toEqual({ abcde: "B", abcdeRank: null }); // other letters untouched
  });

  it("moves down, and repeated moves keep ranks 1..n without gaps", () => {
    let next = moveRank(items, sel, labels, "a1", 1);
    next = moveRank(items, sel, next, "a1", 1);
    expect(ids(sortedSelected(items, sel, next))).toEqual(["a2", "a3", "a1", "b1"]);
    expect([next.a2, next.a3, next.a1].map((l) => l.abcdeRank)).toEqual([1, 2, 3]);
  });

  it("is a no-op (same object) at the ends, without a letter, or for an unselected task", () => {
    expect(moveRank(items, sel, labels, "a1", -1)).toBe(labels);
    expect(moveRank(items, sel, labels, "a3", 1)).toBe(labels);
    expect(moveRank(items, sel, initialLabels(items), "a1", 1)).toEqual(initialLabels(items));
    expect(moveRank(items, ["a1", "a3"], labels, "a2", 1)).toBe(labels);
  });

  it("ignores unselected tasks of the same letter when ranking", () => {
    const next = moveRank(items, ["a1", "a3"], labels, "a3", -1);
    expect(next.a3.abcdeRank).toBe(1);
    expect(next.a1.abcdeRank).toBe(2);
    expect(next.a2).toEqual(labels.a2);
  });
});

describe("suggestFrog / resolveFrog", () => {
  it("suggests the A-1 task", () => {
    const sorted = sortedSelected(
      [item({ id: "b", abcde: "B" }), item({ id: "a2", abcde: "A", abcdeRank: 2 }), item({ id: "a1", abcde: "A", abcdeRank: 1 })],
      ["b", "a2", "a1"],
      {},
    );
    expect(suggestFrog(sorted)).toBe("a1");
  });
  it("suggests the first task when there is no A", () => {
    const sorted = sortedSelected([item({ id: "x", order: 2 }), item({ id: "y", order: 1 })], ["x", "y"], {});
    expect(suggestFrog(sorted)).toBe("y");
  });
  it("skips done tasks unless nothing else is left, and is null for an empty plan", () => {
    expect(suggestFrog([item({ id: "d", abcde: "A", done: true }), item({ id: "o", abcde: "B" })])).toBe("o");
    expect(suggestFrog([item({ id: "d", done: true })])).toBe("d");
    expect(suggestFrog([])).toBeNull();
  });

  const sorted = [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })];
  it("keeps the user's pick while it is in the plan", () => {
    expect(resolveFrog(sorted, "c", "b")).toBe("c");
  });
  it("falls back to the saved plan frog, then to the suggestion", () => {
    expect(resolveFrog(sorted, "gone", "b")).toBe("b");
    expect(resolveFrog(sorted, null, "b")).toBe("b");
    expect(resolveFrog(sorted, "gone", "alsogone")).toBe("a");
    expect(resolveFrog(sorted, null, null)).toBe("a");
  });
  it("is null with nothing selected", () => {
    expect(resolveFrog([], "a", "b")).toBeNull();
  });
});

describe("hints and problems", () => {
  it("shows the size hint only above 7 tasks", () => {
    expect(planSizeHint(0)).toBeNull();
    expect(planSizeHint(7)).toBeNull();
    expect(planSizeHint(8)).toBe(PLAN_HINT);
    expect(PLAN_HINT).toBe("Fewer, more important tasks beat a long list.");
  });
  it("countProblem and planProblem", () => {
    expect(countProblem(0)).toMatch(/at least one/);
    expect(countProblem(1)).toBeNull();
    expect(countProblem(200)).toBeNull();
    expect(countProblem(201)).toMatch(/200/);
    expect(planProblem(0, null)).toMatch(/at least one/);
    expect(planProblem(3, null)).toMatch(/frog/);
    expect(planProblem(3, "a")).toBeNull();
    expect(planProblem(201, "a")).toMatch(/200/);
  });
});

describe("buildPutBody", () => {
  const items = [
    item({ id: "a", abcde: "A", abcdeRank: 1 }),
    item({ id: "b" }),
    item({ id: "c", abcde: "B", abcdeRank: null }),
    item({ id: "d", done: true, abcde: "C", abcdeRank: 2 }),
  ];
  const args = { date: "2026-10-24", tz: "Europe/Berlin", items, frogTaskId: "a" };

  it("sends the whole selection as taskIds in item order and finalizes by default", () => {
    const body = buildPutBody({ ...args, selected: ["d", "a", "b"], labels: initialLabels(items) });
    expect(body.taskIds).toEqual(["a", "b", "d"]);
    expect(body).toMatchObject({ date: "2026-10-24", tz: "Europe/Berlin", frogTaskId: "a", finalize: true });
  });

  it("keeps a done task in taskIds (otherwise the server un-plans it)", () => {
    expect(buildPutBody({ ...args, selected: ["a", "d"], labels: initialLabels(items) }).taskIds).toContain("d");
  });

  it("sends no ranks when nothing changed", () => {
    expect(buildPutBody({ ...args, selected: ["a", "b", "c", "d"], labels: initialLabels(items) }).ranks).toEqual({});
  });

  it("sends full state only for changed tasks", () => {
    let labels = initialLabels(items);
    labels = setLetter(labels, "b", "A"); // new letter, no rank
    labels = { ...labels, c: { abcde: "B", abcdeRank: 1 } }; // rank only
    const { ranks } = buildPutBody({ ...args, selected: ["a", "b", "c", "d"], labels });
    expect(ranks).toEqual({ b: { abcde: "A", abcdeRank: null }, c: { abcde: "B", abcdeRank: 1 } });
  });

  it("sends {abcde:null, abcdeRank:null} for 'no letter'", () => {
    const labels = setLetter(initialLabels(items), "a", null);
    expect(buildPutBody({ ...args, selected: ["a"], labels }).ranks).toEqual({ a: { abcde: null, abcdeRank: null } });
  });

  it("never sends a rank without a letter even for a stray label", () => {
    const labels: PlanLabels = { ...initialLabels(items), b: { abcde: null, abcdeRank: 5 } };
    expect(buildPutBody({ ...args, selected: ["b"], labels }).ranks).toEqual({});
  });

  it("only sends ranks for selected tasks, so every ranks key is in taskIds", () => {
    const labels = setLetter(initialLabels(items), "b", "E");
    const body = buildPutBody({ ...args, selected: ["a"], labels });
    expect(body.ranks).toEqual({});
    expect(body.taskIds).toEqual(["a"]);
  });

  it("can send a plain save and a null frog", () => {
    const body = buildPutBody({ ...args, selected: ["a"], labels: initialLabels(items), frogTaskId: null, finalize: false });
    expect(body).toMatchObject({ finalize: false, frogTaskId: null });
  });

  it("produces a body the API's own validator accepts", () => {
    let labels = initialLabels(items);
    labels = setLetter(labels, "b", "A");
    labels = setLetter(labels, "a", null);
    labels = { ...labels, c: { abcde: "B", abcdeRank: 3 } };
    const parsed = parseTodayPut(buildPutBody({ ...args, selected: ["a", "b", "c", "d"], labels }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.ranks.a).toEqual({ abcde: null, abcdeRank: null });
      expect(parsed.value.ranks.c).toEqual({ abcde: "B", abcdeRank: 3 });
    }
  });

  it("round trip: edit plan after eating the frog keeps the frog planned", () => {
    // The frog is done, so it is NOT in the candidates, only in the payload tasks.
    const tasks = [task({ id: "frog", abcde: "A", abcdeRank: 1, completedAt: "2026-10-24T07:30:00Z" }), task({ id: "t2" })];
    const built = buildPlanItems(tasks, [cand({ id: "t2" }), cand({ id: "t3" })]);
    const selected = initialSelection(tasks);
    const body = buildPutBody({ date: "2026-10-24", tz: "UTC", items: built, selected, labels: initialLabels(built), frogTaskId: "frog" });
    expect(body.taskIds.sort()).toEqual(["frog", "t2"]);
    expect(body.ranks).toEqual({});
  });
});
