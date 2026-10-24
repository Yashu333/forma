import { describe, expect, it } from "vitest";
import type { TodayPayload, TodayTask } from "@/types";
import {
  aFirstNotice,
  applyTaskUpdate,
  countOpenA,
  formatClockTime,
  formatDateKeyLong,
  formatEatenAt,
  isFrogEaten,
  isPlanned,
  isSubtaskDone,
  isTaskDone,
  nextBite,
  removeTask,
  showAFirstHint,
  streakLabel,
  subtaskProgress,
} from "./dayview";

const sub = (order: number, over: { statusId?: string; completedAt?: string | null; title?: string } = {}) => ({
  title: `s${order}`, order, statusId: "todo", completedAt: null, ...over,
});

describe("subtasks", () => {
  it("done = completedAt set or sitting in the Done column", () => {
    expect(isSubtaskDone(sub(1), "done1")).toBe(false);
    expect(isSubtaskDone(sub(1, { completedAt: "2026-10-24T08:00:00Z" }), null)).toBe(true);
    expect(isSubtaskDone(sub(1, { statusId: "done1" }), "done1")).toBe(true);
    expect(isSubtaskDone(sub(1, { statusId: "done1" }), null)).toBe(false);
  });

  it("counts progress", () => {
    expect(subtaskProgress([], "d")).toEqual({ done: 0, total: 0 });
    expect(subtaskProgress([sub(1, { statusId: "d" }), sub(2), sub(3, { completedAt: "x" })], "d")).toEqual({ done: 2, total: 3 });
  });

  it("nextBite is the first unfinished subtask by order", () => {
    const subs = [sub(3), sub(1, { statusId: "d" }), sub(2), sub(0, { completedAt: "x" })];
    expect(nextBite(subs, "d")?.title).toBe("s2");
  });
  it("nextBite uses input order to break ties and is null when nothing is left", () => {
    expect(nextBite([sub(1, { title: "first" }), sub(1, { title: "second" })])?.title).toBe("first");
    expect(nextBite([])).toBeNull();
    expect(nextBite([sub(1, { statusId: "d" }), sub(2, { completedAt: "x" })], "d")).toBeNull();
  });
  it("nextBite does not reorder its input", () => {
    const subs = [sub(2), sub(1)];
    nextBite(subs);
    expect(subs.map((s) => s.order)).toEqual([2, 1]);
  });
});

describe("A-first rule", () => {
  it("hints on open B and C rows only while an A is open", () => {
    expect(showAFirstHint({ abcde: "B" }, 1)).toBe(true);
    expect(showAFirstHint({ abcde: "C" }, 2)).toBe(true);
    expect(showAFirstHint({ abcde: "B" }, 0)).toBe(false);
    expect(showAFirstHint({ abcde: "A" }, 3)).toBe(false);
    expect(showAFirstHint({ abcde: "D" }, 3)).toBe(false);
    expect(showAFirstHint({ abcde: "E" }, 3)).toBe(false);
    expect(showAFirstHint({ abcde: null }, 3)).toBe(false);
    expect(showAFirstHint({}, 3)).toBe(false);
  });
  it("does not hint on a finished B/C row", () => {
    expect(showAFirstHint({ abcde: "B", completedAt: "2026-10-24T08:00:00Z" }, 2)).toBe(false);
  });

  it("builds the notice with singular and plural", () => {
    expect(aFirstNotice({ abcde: "B" }, 1)).toBe("1 A-task still open — the book says finish those first.");
    expect(aFirstNotice({ abcde: "C" }, 3)).toBe("3 A-tasks still open — the book says finish those first.");
  });
  it("has no notice for A/D/E/unlabelled tasks or when no A is open", () => {
    expect(aFirstNotice({ abcde: "A" }, 2)).toBeNull();
    expect(aFirstNotice({ abcde: "D" }, 2)).toBeNull();
    expect(aFirstNotice({ abcde: "E" }, 2)).toBeNull();
    expect(aFirstNotice({ abcde: null }, 2)).toBeNull();
    expect(aFirstNotice({ abcde: "B" }, 0)).toBeNull();
  });

  it("counts open A tasks", () => {
    expect(countOpenA([{ abcde: "A" }, { abcde: "A", completedAt: "x" }, { abcde: "B" }, { abcde: null }])).toBe(1);
    expect(countOpenA([])).toBe(0);
  });
});

describe("eaten state and time formatting", () => {
  it("is eaten when completed on or before the plan date in tz", () => {
    expect(isFrogEaten({ completedAt: "2026-10-24T07:42:00Z" }, "2026-10-24", "UTC")).toBe(true);
    expect(isFrogEaten({ completedAt: "2026-10-23T22:00:00Z" }, "2026-10-24", "UTC")).toBe(true);
    expect(isFrogEaten({ completedAt: "2026-10-25T00:30:00Z" }, "2026-10-24", "UTC")).toBe(false);
  });
  it("uses the local day, not the UTC day", () => {
    // 23:30 on the 24th in New York is already the 25th in UTC.
    expect(isFrogEaten({ completedAt: "2026-10-25T03:30:00Z" }, "2026-10-24", "America/New_York")).toBe(true);
    expect(isFrogEaten({ completedAt: "2026-10-25T03:30:00Z" }, "2026-10-24", "UTC")).toBe(false);
  });
  it("is not eaten without a frog or completedAt", () => {
    expect(isFrogEaten(null, "2026-10-24", "UTC")).toBe(false);
    expect(isFrogEaten({ completedAt: null }, "2026-10-24", "UTC")).toBe(false);
    expect(isFrogEaten({}, "2026-10-24", "UTC")).toBe(false);
  });

  it("formats the clock in the given zone with an unpadded hour", () => {
    expect(formatClockTime("2026-10-24T07:42:00Z", "UTC")).toBe("7:42");
    expect(formatClockTime("2026-10-24T07:42:00Z", "Asia/Kolkata")).toBe("13:12");
    expect(formatClockTime("2026-10-24T14:05:00Z", "UTC")).toBe("14:05");
    expect(formatClockTime(new Date("2026-10-24T09:05:00Z"), "UTC")).toBe("9:05");
  });
  it("shows midnight as 0, never 24", () => {
    expect(formatClockTime("2026-10-24T00:07:00Z", "UTC")).toBe("0:07");
    expect(formatClockTime("2026-10-24T22:07:00Z", "Europe/Berlin")).toBe("0:07");
  });
  it("is DST aware", () => {
    // Berlin is UTC+2 before 2026-10-25 03:00 local and UTC+1 after.
    expect(formatClockTime("2026-10-24T07:00:00Z", "Europe/Berlin")).toBe("9:00");
    expect(formatClockTime("2026-10-26T07:00:00Z", "Europe/Berlin")).toBe("8:00");
  });

  it("formats 'Eaten at H:MM'", () => {
    expect(formatEatenAt("2026-10-24T07:42:00Z", "UTC", "2026-10-24")).toBe("Eaten at 7:42");
    expect(formatEatenAt("2026-10-24T07:42:00Z", "America/New_York", "2026-10-24")).toBe("Eaten at 3:42");
  });
  it("names the day when it was eaten on another day", () => {
    expect(formatEatenAt("2026-10-23T07:42:00Z", "UTC", "2026-10-24")).toBe("Eaten on 2026-10-23 at 7:42");
  });

  it("formats the date key without time-zone shifts", () => {
    expect(formatDateKeyLong("2026-10-24")).toBe("Saturday, October 24");
    expect(formatDateKeyLong("2026-01-01")).toBe("Thursday, January 1");
    expect(formatDateKeyLong("2028-02-29")).toBe("Tuesday, February 29");
  });

  it("labels the streak only while one is running", () => {
    expect(streakLabel(0)).toBeNull();
    expect(streakLabel(-1)).toBeNull();
    expect(streakLabel(1)).toBe("🔥 1-day frog streak");
    expect(streakLabel(4)).toBe("🔥 4-day frog streak");
  });
});

describe("payload updates", () => {
  const group = { id: "g", name: "G", color: "#000", doneStatusId: "done" };
  const t = (id: string, abcde: TodayTask["abcde"], completedAt: string | null = null): TodayTask =>
    ({ id, title: id, groupId: "g", statusId: "todo", priority: "MEDIUM", order: 0, createdBy: "u", createdAt: "", updatedAt: "", abcde, completedAt, group });
  const payload = (): TodayPayload => ({
    date: "2026-10-24",
    plan: null,
    frog: { ...t("a1", "A"), subtasks: [] },
    tasks: [t("a1", "A"), t("a2", "A"), t("b1", "B")],
    completedToday: [],
    openA: 2,
    streak: { current: 0, longest: 0 },
  });

  it("applyTaskUpdate marks the row and the frog done and recomputes openA", () => {
    const next = applyTaskUpdate(payload(), { id: "a1", statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    expect(next.tasks[0]).toMatchObject({ statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    expect(next.frog).toMatchObject({ statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    expect(next.openA).toBe(1);
    expect(next.tasks[1].completedAt).toBeNull();
  });
  it("applyTaskUpdate leaves the frog alone for another task, and does not mutate", () => {
    const p = payload();
    const next = applyTaskUpdate(p, { id: "b1", statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    expect(next.frog?.completedAt).toBeNull();
    expect(next.openA).toBe(2);
    expect(p.tasks[2].completedAt).toBeNull();
  });
  it("applyTaskUpdate ignores an unknown id and treats a missing completedAt as null", () => {
    expect(applyTaskUpdate(payload(), { id: "zzz", statusId: "done" }).tasks.map(isTaskDone)).toEqual([false, false, false]);
    const reopened = applyTaskUpdate(applyTaskUpdate(payload(), { id: "a2", statusId: "done", completedAt: "x" }), { id: "a2", statusId: "todo" });
    expect(reopened.tasks[1].completedAt).toBeNull();
    expect(reopened.openA).toBe(2);
  });

  it("removeTask drops the row, recomputes openA, and clears the frog if it was archived", () => {
    const next = removeTask(payload(), "a2");
    expect(next.tasks.map((x) => x.id)).toEqual(["a1", "b1"]);
    expect(next.openA).toBe(1);
    expect(next.frog?.id).toBe("a1");
    expect(removeTask(payload(), "a1").frog).toBeNull();
  });

  it("isPlanned needs plannedAt", () => {
    expect(isPlanned({ plan: null })).toBe(false);
    expect(isPlanned({ plan: { plannedAt: null } as TodayPayload["plan"] })).toBe(false);
    expect(isPlanned({ plan: { plannedAt: "2026-10-24T06:00:00Z" } as TodayPayload["plan"] })).toBe(true);
  });
});
