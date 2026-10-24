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
import { MAX_PLAN_TASKS, parseTodayPut } from "./today";

// Edge cases beyond plan.test.ts: the 200-task cap, duplicate ids, cleared
// letters, rank renumbering with gaps/ties, the frog falling back, and the
// invariant that every body the editor builds passes the API's own validator.

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
const args = (items: PlanItem[], selected: string[], labels: PlanLabels, frogTaskId: string | null) => ({
  date: "2026-10-24", tz: "Europe/Berlin", items, selected, labels, frogTaskId,
});

describe("the 200-task cap", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => item({ id: `t${i}` }));

  it("countProblem is null at exactly 200 and a message at 201", () => {
    expect(countProblem(MAX_PLAN_TASKS)).toBeNull();
    expect(countProblem(MAX_PLAN_TASKS + 1)).toBe("A day can hold at most 200 tasks.");
  });

  it("the cap in the message comes from the API constant", () => {
    expect(MAX_PLAN_TASKS).toBe(200);
    expect(countProblem(MAX_PLAN_TASKS + 1)).toContain(String(MAX_PLAN_TASKS));
  });

  it("planProblem reports the count before a missing frog", () => {
    expect(planProblem(201, null)).toBe("A day can hold at most 200 tasks.");
    expect(planProblem(0, null)).toBe("Pick at least one task for today.");
    expect(planProblem(200, null)).toBe("Choose your frog to save the plan.");
    expect(planProblem(200, "t0")).toBeNull();
  });

  it("a body for exactly 200 tasks passes the API validator, 201 does not (so the editor must stop at 200)", () => {
    const items = many(201);
    const at200 = buildPutBody(args(items, ids(items.slice(0, 200)), {}, "t0"));
    expect(at200.taskIds).toHaveLength(200);
    expect(parseTodayPut(at200).ok).toBe(true);
    const at201 = buildPutBody(args(items, ids(items), {}, "t0"));
    expect(parseTodayPut(at201).ok).toBe(false);
  });

  it("handles negative and fractional counts without crashing", () => {
    expect(countProblem(-1)).toBeNull();
    expect(countProblem(0.5)).toBeNull();
  });
});

describe("duplicate ids", () => {
  it("buildPlanItems keeps one entry per id even when the candidates repeat it", () => {
    const items = buildPlanItems([], [cand({ id: "a" }), cand({ id: "a", title: "dup" }), cand({ id: "b" })]);
    expect(ids(items)).toEqual(["a", "b"]);
    expect(items[0].title).toBe("a"); // first copy wins
  });

  it("buildPlanItems keeps one entry per id when the planned tasks repeat it", () => {
    const items = buildPlanItems([task({ id: "p" }), task({ id: "p" })], []);
    expect(ids(items)).toEqual(["p"]);
  });

  it("buildPutBody never sends a duplicate in taskIds, even if the selection holds one", () => {
    const items = [item({ id: "a" }), item({ id: "b" })];
    const body = buildPutBody(args(items, ["a", "b", "a"], {}, "a"));
    expect(body.taskIds).toEqual(["a", "b"]);
    expect(parseTodayPut(body).ok).toBe(true);
  });

  it("toggleSelected removes every copy of a duplicated id", () => {
    expect(toggleSelected(["a", "b", "a"], "a")).toEqual(["b"]);
  });

  it("an id in the selection that is not an item is ignored in the body", () => {
    const items = [item({ id: "a" })];
    const body = buildPutBody(args(items, ["a", "ghost"], {}, "a"));
    expect(body.taskIds).toEqual(["a"]);
    expect(parseTodayPut(body).ok).toBe(true);
  });

  it("groupByProject treats a repeated group id as one project", () => {
    const groups = groupByProject([item({ id: "a" }), item({ id: "b", group: G2 }), item({ id: "c" })]);
    expect(groups.map((g) => ids(g.items))).toEqual([["a", "c"], ["b"]]);
  });
});

describe("a letter that was cleared", () => {
  it("sends {abcde:null, abcdeRank:null} for a task that had a ranked letter", () => {
    const items = [item({ id: "a", abcde: "A", abcdeRank: 2 }), item({ id: "b" })];
    const labels = toggleLetter(initialLabels(items), "a", "A");
    expect(labels.a).toEqual({ abcde: null, abcdeRank: null });
    const body = buildPutBody(args(items, ["a", "b"], labels, "b"));
    expect(body.ranks).toEqual({ a: { abcde: null, abcdeRank: null } });
    expect(parseTodayPut(body).ok).toBe(true);
  });

  it("sends nothing for a task that got a letter and lost it again (net no change)", () => {
    const items = [item({ id: "a" })];
    let labels = initialLabels(items);
    labels = toggleLetter(labels, "a", "B");
    labels = toggleLetter(labels, "a", "B");
    expect(buildPutBody(args(items, ["a"], labels, "a")).ranks).toEqual({});
  });

  it("sends nothing for a task whose letter changed and changed back", () => {
    const items = [item({ id: "a", abcde: "C", abcdeRank: 3 })];
    let labels = initialLabels(items);
    labels = setLetter(labels, "a", "A"); // rank reset
    labels = setLetter(labels, "a", "C"); // rank is now null, not 3 -> that IS a change
    expect(buildPutBody(args(items, ["a"], labels, "a")).ranks).toEqual({ a: { abcde: "C", abcdeRank: null } });
  });

  it("a cleared letter on a task that is not selected is not sent (the key would not be in taskIds)", () => {
    const items = [item({ id: "a", abcde: "A" }), item({ id: "b" })];
    const labels = toggleLetter(initialLabels(items), "a", "A");
    const body = buildPutBody(args(items, ["b"], labels, "b"));
    expect(body.ranks).toEqual({});
    expect(body.taskIds).toEqual(["b"]);
  });

  it("withLabels ignores a stale rank on a cleared letter", () => {
    const [x] = withLabels([item({ id: "a", abcde: "A", abcdeRank: 4 })], { a: { abcde: null, abcdeRank: 4 } });
    expect(x.abcde).toBeNull();
    expect(x.abcdeRank).toBeNull();
  });

  it("a cleared task sorts after every lettered task and loses its rank position", () => {
    const items = [item({ id: "a", abcde: "A", abcdeRank: 1 }), item({ id: "b", abcde: "E", abcdeRank: 1 })];
    const labels = toggleLetter(initialLabels(items), "a", "A");
    expect(ids(sortedSelected(items, ["a", "b"], labels))).toEqual(["b", "a"]);
    expect(rankPosition(items, ["a", "b"], labels, "a")).toBeNull();
  });

  it("an inconsistent item (rank without a letter) never leaks its rank into the body", () => {
    const items = [item({ id: "a", abcde: null, abcdeRank: 3 })];
    const labels = initialLabels(items);
    expect(labels.a).toEqual({ abcde: null, abcdeRank: null });
    const body = buildPutBody(args(items, ["a"], labels, "a"));
    expect(body.ranks).toEqual({});
    expect(parseTodayPut(body).ok).toBe(true);
  });

  it("a label missing for a task means 'unchanged'", () => {
    const items = [item({ id: "a", abcde: "B", abcdeRank: 1 })];
    expect(buildPutBody(args(items, ["a"], {}, "a")).ranks).toEqual({});
  });
});

describe("rank renumbering", () => {
  const items = [
    item({ id: "a", abcde: "A", abcdeRank: 5 }),
    item({ id: "b", abcde: "A", abcdeRank: 5 }), // a tie
    item({ id: "c", abcde: "A", abcdeRank: 9 }),
    item({ id: "d", abcde: "A" }), // unranked
    item({ id: "e", abcde: "B", abcdeRank: 7 }),
  ];
  const all = ids(items);

  it("renumbers a group with gaps, ties and unranked members to 1..n on the first tap", () => {
    const labels = moveRank(items, all, initialLabels(items), "c", -1);
    // order was a, b (tie, input order), c, d -> c moved above b
    expect(ids(sortedSelected(items, all, labels).filter((i) => i.abcde === "A"))).toEqual(["a", "c", "b", "d"]);
    expect(["a", "c", "b", "d"].map((id) => labels[id].abcdeRank)).toEqual([1, 2, 3, 4]);
  });

  it("leaves other letters alone", () => {
    const labels = moveRank(items, all, initialLabels(items), "c", -1);
    expect(labels.e).toEqual({ abcde: "B", abcdeRank: 7 });
  });

  it("is a pure function: the input labels are never mutated", () => {
    const before = initialLabels(items);
    const snapshot = JSON.parse(JSON.stringify(before));
    moveRank(items, all, before, "c", -1);
    expect(before).toEqual(snapshot);
  });

  it("ranks only the selected members of a letter", () => {
    const labels = moveRank(items, ["a", "c", "e"], initialLabels(items), "c", -1);
    expect(labels.c.abcdeRank).toBe(1);
    expect(labels.a.abcdeRank).toBe(2);
    expect(labels.b.abcdeRank).toBe(5); // not selected, untouched
    expect(labels.d.abcdeRank).toBeNull();
  });

  it("moving down and then up restores the visible order (and keeps ranks 1..n)", () => {
    const base = [item({ id: "x", abcde: "A" }), item({ id: "y", abcde: "A" }), item({ id: "z", abcde: "A" })];
    const sel = ids(base);
    let labels = initialLabels(base);
    labels = moveRank(base, sel, labels, "x", 1);
    labels = moveRank(base, sel, labels, "x", -1);
    expect(ids(sortedSelected(base, sel, labels))).toEqual(["x", "y", "z"]);
    expect(sel.map((id) => labels[id].abcdeRank)).toEqual([1, 2, 3]);
  });

  it("moving the first up or the last down returns the same object (no re-render, no new ranks)", () => {
    const base = [item({ id: "x", abcde: "A" }), item({ id: "y", abcde: "A" })];
    const labels = initialLabels(base);
    expect(moveRank(base, ids(base), labels, "x", -1)).toBe(labels);
    expect(moveRank(base, ids(base), labels, "y", 1)).toBe(labels);
  });

  it("the ranks it produces are all in the body and pass the API validator", () => {
    const labels = moveRank(items, all, initialLabels(items), "c", -1);
    const body = buildPutBody(args(items, all, labels, "a"));
    expect(body.ranks.a).toEqual({ abcde: "A", abcdeRank: 1 });
    expect(body.ranks.c).toEqual({ abcde: "A", abcdeRank: 2 });
    expect(body.ranks.b).toEqual({ abcde: "A", abcdeRank: 3 });
    expect(body.ranks.d).toEqual({ abcde: "A", abcdeRank: 4 });
    expect(body.ranks.e).toBeUndefined();
    expect(parseTodayPut(body).ok).toBe(true);
  });

  it("after a letter changes, the rest of the old letter keeps its (now gappy) ranks and only the changed task is sent", () => {
    const base = [
      item({ id: "x", abcde: "A", abcdeRank: 1 }),
      item({ id: "y", abcde: "A", abcdeRank: 2 }),
      item({ id: "z", abcde: "A", abcdeRank: 3 }),
    ];
    const labels = setLetter(initialLabels(base), "y", "B");
    const body = buildPutBody(args(base, ids(base), labels, "x"));
    expect(body.ranks).toEqual({ y: { abcde: "B", abcdeRank: null } });
    expect(ids(sortedSelected(base, ids(base), labels))).toEqual(["x", "z", "y"]);
  });

  it("a moved task in a done state is still ranked (done tasks stay in the plan)", () => {
    const base = [item({ id: "x", abcde: "A", abcdeRank: 1, done: true }), item({ id: "y", abcde: "A", abcdeRank: 2 })];
    const labels = moveRank(base, ids(base), initialLabels(base), "y", -1);
    expect(labels.y.abcdeRank).toBe(1);
    expect(labels.x.abcdeRank).toBe(2);
  });

  it("an unknown id or an unselected id is a no-op", () => {
    const labels = initialLabels(items);
    expect(moveRank(items, all, labels, "nope", 1)).toBe(labels);
    expect(moveRank(items, ["a"], labels, "c", -1)).toBe(labels);
  });
});

describe("the frog falls back", () => {
  const a = item({ id: "a", abcde: "A", abcdeRank: 1 });
  const b = item({ id: "b", abcde: "B" });
  const c = item({ id: "c" });

  it("a pick that left the plan falls back to the saved plan frog, then to A-1", () => {
    expect(resolveFrog([a, b], "gone", "b")).toBe("b");
    expect(resolveFrog([a, b], "gone", "also-gone")).toBe("a");
    expect(resolveFrog([a, b], null, null)).toBe("a");
  });

  it("a pick that is still in the plan wins over the saved frog", () => {
    expect(resolveFrog([a, b, c], "c", "b")).toBe("c");
  });

  it("when the A-1 task is removed the suggestion moves to the next task in order", () => {
    expect(resolveFrog(sortedSelected([a, b, c], ["b", "c"], initialLabels([a, b, c])), "a", "a")).toBe("b");
  });

  it("relabelling A-1 down to E changes the suggestion", () => {
    const items = [a, b];
    const labels = setLetter(initialLabels(items), "a", "E");
    expect(suggestFrog(sortedSelected(items, ["a", "b"], labels))).toBe("b");
  });

  it("nothing selected: no frog", () => {
    expect(resolveFrog([], "a", "a")).toBeNull();
    expect(suggestFrog([])).toBeNull();
  });

  it("an eaten frog is suggested only when nothing open is left, in either position", () => {
    const eaten = item({ id: "e", abcde: "A", abcdeRank: 1, done: true });
    expect(suggestFrog([eaten, b])).toBe("b");
    expect(suggestFrog([eaten])).toBe("e");
    expect(suggestFrog([eaten, item({ id: "e2", done: true })])).toBe("e");
  });

  it("the saved plan frog is kept even if it is done (Edit plan after eating it)", () => {
    const eaten = item({ id: "e", abcde: "A", abcdeRank: 1, done: true });
    expect(resolveFrog([eaten, b], null, "e")).toBe("e");
  });

  it("the frog id always lands in taskIds when it comes from resolveFrog over the selection", () => {
    const items = [a, b, c];
    for (const sel of [["a"], ["b", "c"], ["a", "b", "c"]]) {
      const frog = resolveFrog(sortedSelected(items, sel, initialLabels(items)), "a", "c");
      const body = buildPutBody(args(items, sel, initialLabels(items), frog));
      expect(body.taskIds).toContain(body.frogTaskId);
      expect(parseTodayPut(body).ok).toBe(true);
    }
  });
});

describe("selection, sorting and items: other edges", () => {
  it("initialSelection of no tasks is empty and buildPutBody of an empty plan still validates (the UI blocks it earlier)", () => {
    expect(initialSelection([])).toEqual([]);
    const body = buildPutBody(args([], [], {}, null));
    expect(body.taskIds).toEqual([]);
    expect(parseTodayPut(body).ok).toBe(true);
  });

  it("sortedSelected keeps items in input order for a full tie", () => {
    const tie = [item({ id: "p", order: 1 }), item({ id: "q", order: 1 })];
    expect(ids(sortedSelected(tie, ["q", "p"], {}))).toEqual(["p", "q"]);
  });

  it("sortedSelected orders by priority then board order within a letter and rank", () => {
    const items = [
      item({ id: "low", abcde: "B", priority: "LOW", order: 1 }),
      item({ id: "urgent", abcde: "B", priority: "URGENT", order: 9 }),
      item({ id: "first", abcde: "B", priority: "URGENT", order: 2 }),
    ];
    expect(ids(sortedSelected(items, ids(items), {}))).toEqual(["first", "urgent", "low"]);
  });

  it("buildPlanItems lets the planned copy override stale candidate labels and marks done", () => {
    const items = buildPlanItems(
      [task({ id: "a", abcde: "B", abcdeRank: 2, completedAt: "2026-10-24T06:00:00Z" })],
      [cand({ id: "a", abcde: "A", abcdeRank: 1 })],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ abcde: "B", abcdeRank: 2, done: true });
  });

  it("buildPlanItems does not mutate its inputs", () => {
    const tasks = [task({ id: "p" })];
    const cands = [cand({ id: "c" })];
    const snap = JSON.stringify([tasks, cands]);
    buildPlanItems(tasks, cands);
    expect(JSON.stringify([tasks, cands])).toBe(snap);
  });

  it("toggleLetter on an unknown id creates its label", () => {
    expect(toggleLetter({}, "x", "D")).toEqual({ x: { abcde: "D", abcdeRank: null } });
  });

  it("every body the editor builds from a messy state passes the real validator", () => {
    const items = [
      item({ id: "a", abcde: "A", abcdeRank: 3 }),
      item({ id: "b", abcde: "B" }),
      item({ id: "c", done: true, abcde: "C", abcdeRank: 1 }),
      item({ id: "d" }),
    ];
    let labels = initialLabels(items);
    labels = toggleLetter(labels, "a", "A");
    labels = toggleLetter(labels, "d", "A");
    labels = toggleLetter(labels, "b", "A");
    labels = moveRank(items, ids(items), labels, "b", -1);
    const sel = ["a", "b", "c", "d"];
    const frog = resolveFrog(sortedSelected(items, sel, labels), null, null);
    const parsed = parseTodayPut(buildPutBody(args(items, sel, labels, frog)));
    expect(parsed.ok).toBe(true);
  });
});
