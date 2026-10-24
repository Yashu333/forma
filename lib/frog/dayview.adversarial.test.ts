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
  isSubtaskDone,
  isTaskDone,
  nextBite,
  removeTask,
  showAFirstHint,
  streakLabel,
  subtaskProgress,
} from "./dayview";

// Edge cases beyond dayview.test.ts: DST and half-hour time zones for the
// "Eaten at" time, local-midnight boundaries for "eaten", year/leap boundaries
// for the date line, and the payload reducers' invariants.

describe("formatClockTime: zones and DST", () => {
  it("formats a half-hour zone (Kolkata, UTC+5:30)", () => {
    expect(formatClockTime("2026-10-24T04:12:00Z", "Asia/Kolkata")).toBe("9:42");
  });

  it("formats a 45-minute zone (Kathmandu, UTC+5:45)", () => {
    expect(formatClockTime("2026-10-24T04:00:00Z", "Asia/Kathmandu")).toBe("9:45");
  });

  it("formats a zone that is more than a day ahead of UTC-12 (Kiritimati, UTC+14)", () => {
    expect(formatClockTime("2026-10-24T09:42:00Z", "Pacific/Kiritimati")).toBe("23:42");
  });

  it("formats a negative offset (Honolulu, UTC-10)", () => {
    expect(formatClockTime("2026-10-24T19:42:00Z", "Pacific/Honolulu")).toBe("9:42");
  });

  it("Berlin spring forward: 01:59Z is 3:59 CEST on 2026-03-29 (02:xx does not exist)", () => {
    expect(formatClockTime("2026-03-29T00:59:00Z", "Europe/Berlin")).toBe("1:59");
    expect(formatClockTime("2026-03-29T01:00:00Z", "Europe/Berlin")).toBe("3:00");
  });

  it("Berlin fall back: 02:30 happens twice and both instants read 2:30", () => {
    expect(formatClockTime("2026-10-25T00:30:00Z", "Europe/Berlin")).toBe("2:30"); // CEST
    expect(formatClockTime("2026-10-25T01:30:00Z", "Europe/Berlin")).toBe("2:30"); // CET
    expect(formatClockTime("2026-10-25T02:30:00Z", "Europe/Berlin")).toBe("3:30");
  });

  it("New York fall back 2026-11-01: 1:30 twice", () => {
    expect(formatClockTime("2026-11-01T05:30:00Z", "America/New_York")).toBe("1:30");
    expect(formatClockTime("2026-11-01T06:30:00Z", "America/New_York")).toBe("1:30");
  });

  it("midnight is 0:00 and one minute before is 23:59, never 24:xx", () => {
    expect(formatClockTime("2026-10-23T22:00:00Z", "Europe/Berlin")).toBe("0:00");
    expect(formatClockTime("2026-10-24T21:59:00Z", "Europe/Berlin")).toBe("23:59");
    expect(formatClockTime("2026-10-24T00:00:00Z", "UTC")).toBe("0:00");
  });

  it("pads minutes but not the hour", () => {
    expect(formatClockTime("2026-10-24T07:05:00Z", "UTC")).toBe("7:05");
    expect(formatClockTime("2026-10-24T10:00:00Z", "UTC")).toBe("10:00");
  });

  it("accepts a Date as well as an ISO string and ignores seconds/milliseconds", () => {
    expect(formatClockTime(new Date("2026-10-24T07:42:59.999Z"), "UTC")).toBe("7:42");
  });

  it("a time-zone offset-bearing ISO string is read as the instant it names", () => {
    expect(formatClockTime("2026-10-24T09:42:00+02:00", "UTC")).toBe("7:42");
  });

  it("is deterministic across the process time zone (uses tz, not TZ)", () => {
    const before = formatClockTime("2026-10-24T07:42:00Z", "Asia/Tokyo");
    const prev = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(formatClockTime("2026-10-24T07:42:00Z", "Asia/Tokyo")).toBe(before);
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
    expect(before).toBe("16:42");
  });

  it("an invalid time zone throws (the UI only ever passes the browser's own zone)", () => {
    expect(() => formatClockTime("2026-10-24T07:42:00Z", "Not/AZone")).toThrow(RangeError);
  });
});

describe("isFrogEaten and formatEatenAt at local midnight", () => {
  const frog = (completedAt: string | null) => ({ completedAt });

  it("the last millisecond of the plan date (local) counts, the first of the next day does not", () => {
    // Berlin, 2026-10-24 = [10-23T22:00Z, 10-24T22:00Z)
    expect(isFrogEaten(frog("2026-10-24T21:59:59.999Z"), "2026-10-24", "Europe/Berlin")).toBe(true);
    expect(isFrogEaten(frog("2026-10-24T22:00:00.000Z"), "2026-10-24", "Europe/Berlin")).toBe(false);
  });

  it("an earlier day counts as eaten (done before the plan date)", () => {
    expect(isFrogEaten(frog("2026-10-23T21:59:59.999Z"), "2026-10-24", "Europe/Berlin")).toBe(true);
    expect(isFrogEaten(frog("2020-01-01T00:00:00Z"), "2026-10-24", "Europe/Berlin")).toBe(true);
  });

  it("the 25-hour day on the fall-back date: 23:59 local is still that date, 00:00 is not", () => {
    // Berlin 2026-10-25 = [10-24T22:00Z, 10-25T23:00Z)
    expect(isFrogEaten(frog("2026-10-25T22:59:59.999Z"), "2026-10-25", "Europe/Berlin")).toBe(true);
    expect(isFrogEaten(frog("2026-10-25T23:00:00.000Z"), "2026-10-25", "Europe/Berlin")).toBe(false);
  });

  it("the 23-hour day on the spring-forward date", () => {
    // Berlin 2026-03-29 = [03-28T23:00Z, 03-29T22:00Z)
    expect(isFrogEaten(frog("2026-03-29T21:59:59.999Z"), "2026-03-29", "Europe/Berlin")).toBe(true);
    expect(isFrogEaten(frog("2026-03-29T22:00:00.000Z"), "2026-03-29", "Europe/Berlin")).toBe(false);
  });

  it("23:30 local on the plan date is the next day in UTC but still eaten", () => {
    // Los Angeles 2026-10-24 23:30 PDT = 10-25T06:30Z
    expect(isFrogEaten(frog("2026-10-25T06:30:00Z"), "2026-10-24", "America/Los_Angeles")).toBe(true);
    expect(isFrogEaten(frog("2026-10-25T06:30:00Z"), "2026-10-24", "UTC")).toBe(false);
  });

  it("is false for a missing frog, a null completedAt, and an unset field", () => {
    expect(isFrogEaten(null, "2026-10-24", "UTC")).toBe(false);
    expect(isFrogEaten(frog(null), "2026-10-24", "UTC")).toBe(false);
    expect(isFrogEaten({}, "2026-10-24", "UTC")).toBe(false);
  });

  it("works across a year boundary", () => {
    expect(isFrogEaten(frog("2026-12-31T23:30:00Z"), "2027-01-01", "UTC")).toBe(true);
    expect(isFrogEaten(frog("2027-01-01T00:00:00Z"), "2026-12-31", "UTC")).toBe(false);
  });

  it("formatEatenAt: same local day is 'Eaten at', another day names the day (in tz, not UTC)", () => {
    expect(formatEatenAt("2026-10-24T21:59:00Z", "Europe/Berlin", "2026-10-24")).toBe("Eaten at 23:59");
    expect(formatEatenAt("2026-10-24T22:00:00Z", "Europe/Berlin", "2026-10-24")).toBe("Eaten on 2026-10-25 at 0:00");
    expect(formatEatenAt("2026-10-23T21:00:00Z", "Europe/Berlin", "2026-10-24")).toBe("Eaten on 2026-10-23 at 23:00");
  });

  it("formatEatenAt: the day line crosses a year boundary correctly", () => {
    expect(formatEatenAt("2026-12-31T23:30:00Z", "UTC", "2027-01-01")).toBe("Eaten on 2026-12-31 at 23:30");
  });
});

describe("formatDateKeyLong", () => {
  it("a year boundary and a leap day", () => {
    expect(formatDateKeyLong("2026-12-31")).toBe("Thursday, December 31");
    expect(formatDateKeyLong("2027-01-01")).toBe("Friday, January 1");
    expect(formatDateKeyLong("2028-02-29")).toBe("Tuesday, February 29");
  });

  it("does not shift with the process time zone", () => {
    const prev = process.env.TZ;
    try {
      for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
        process.env.TZ = tz;
        expect(formatDateKeyLong("2026-10-24")).toBe("Saturday, October 24");
      }
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it("the supported extremes still format", () => {
    expect(formatDateKeyLong("0001-01-03")).toMatch(/January 3$/);
    expect(formatDateKeyLong("9998-12-29")).toMatch(/December 29$/);
  });
});

describe("streakLabel", () => {
  it("is null for 0, negatives and NaN; counts otherwise", () => {
    expect(streakLabel(0)).toBeNull();
    expect(streakLabel(-1)).toBeNull();
    expect(streakLabel(Number.NaN)).toBeNull();
    expect(streakLabel(1)).toBe("🔥 1-day frog streak");
    expect(streakLabel(365)).toBe("🔥 365-day frog streak");
  });
});

describe("A-first helpers: edges", () => {
  it("the notice pluralises on 1 vs everything else", () => {
    expect(aFirstNotice({ abcde: "B" }, 1)).toBe("1 A-task still open — the book says finish those first.");
    expect(aFirstNotice({ abcde: "C" }, 2)).toBe("2 A-tasks still open — the book says finish those first.");
    expect(aFirstNotice({ abcde: "C" }, 11)).toBe("11 A-tasks still open — the book says finish those first.");
  });

  it("has no notice for zero or negative open A tasks", () => {
    expect(aFirstNotice({ abcde: "B" }, 0)).toBeNull();
    expect(aFirstNotice({ abcde: "B" }, -3)).toBeNull();
  });

  it("only B and C trigger it; missing or null letters do not", () => {
    for (const abcde of ["A", "D", "E", null, undefined] as const) {
      expect(aFirstNotice({ abcde }, 3)).toBeNull();
      expect(showAFirstHint({ abcde }, 3)).toBe(false);
    }
  });

  it("a done B/C row never hints, even with A open", () => {
    expect(showAFirstHint({ abcde: "B", completedAt: "2026-10-24T05:00:00Z" }, 2)).toBe(false);
    expect(showAFirstHint({ abcde: "C", completedAt: new Date() }, 2)).toBe(false);
  });

  it("countOpenA ignores done A tasks and every other letter", () => {
    expect(
      countOpenA([
        { abcde: "A", completedAt: null },
        { abcde: "A" },
        { abcde: "A", completedAt: "2026-10-24T05:00:00Z" },
        { abcde: "B" },
        { abcde: null },
      ]),
    ).toBe(2);
    expect(countOpenA([])).toBe(0);
  });
});

describe("subtasks: edges", () => {
  const sub = (order: number, over: { statusId?: string; completedAt?: string | null } = {}) => ({
    order, statusId: "todo", completedAt: null, ...over,
  });

  it("with no Done column (null) only completedAt counts", () => {
    expect(isSubtaskDone(sub(1, { statusId: "anything" }), null)).toBe(false);
    expect(isSubtaskDone(sub(1, { completedAt: "2026-10-24T05:00:00Z" }), null)).toBe(true);
  });

  it("is done in the Done column even if completedAt was never stamped", () => {
    expect(isSubtaskDone(sub(1, { statusId: "done" }), "done")).toBe(true);
  });

  it("progress of nothing is 0 of 0", () => {
    expect(subtaskProgress([], "done")).toEqual({ done: 0, total: 0 });
    expect(nextBite([], "done")).toBeNull();
  });

  it("nextBite handles negative, equal and out-of-order `order` values", () => {
    const subs = [{ ...sub(3), id: "c" }, { ...sub(-1), id: "neg" }, { ...sub(3), id: "c2" }, { ...sub(0), id: "zero" }];
    expect(nextBite(subs)?.id).toBe("neg");
    expect(nextBite(subs.filter((s) => s.id !== "neg"))?.id).toBe("zero");
    expect(nextBite(subs.filter((s) => s.id.startsWith("c")))?.id).toBe("c"); // tie: input order
  });

  it("nextBite skips the done ones in the middle", () => {
    const subs = [
      { ...sub(1, { completedAt: "2026-10-24T05:00:00Z" }), id: "1" },
      { ...sub(2, { statusId: "done" }), id: "2" },
      { ...sub(3), id: "3" },
    ];
    expect(nextBite(subs, "done")?.id).toBe("3");
  });

  it("an empty-string completedAt is treated as not-null (done): documents the != null rule", () => {
    expect(isTaskDone({ completedAt: "" })).toBe(true);
    expect(isTaskDone({ completedAt: undefined })).toBe(false);
    expect(isTaskDone({ completedAt: null })).toBe(false);
  });
});

describe("payload reducers: invariants", () => {
  const group = { id: "g", name: "G", color: "#000", doneStatusId: "done" };
  const t = (id: string, abcde: TodayTask["abcde"], completedAt: string | null = null): TodayTask =>
    ({ id, title: id, groupId: "g", statusId: "todo", priority: "MEDIUM", order: 0, createdBy: "u", createdAt: "", updatedAt: "", abcde, completedAt, group });
  const base = (): TodayPayload => ({
    date: "2026-10-24",
    plan: null,
    frog: { ...t("a1", "A"), subtasks: [] },
    tasks: [t("a1", "A"), t("a2", "A"), t("b1", "B")],
    completedToday: [],
    openA: 2,
    streak: { current: 2, longest: 5 },
  });

  it("reopening a done A task (completedAt null) raises openA again", () => {
    const done = applyTaskUpdate(base(), { id: "a1", statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    expect(done.openA).toBe(1);
    const reopened = applyTaskUpdate(done, { id: "a1", statusId: "todo", completedAt: null });
    expect(reopened.openA).toBe(2);
    expect(reopened.tasks[0].completedAt).toBeNull();
    expect(reopened.frog?.completedAt).toBeNull();
  });

  it("keeps streak, plan, date and completedToday exactly as they were", () => {
    const p = base();
    const next = applyTaskUpdate(p, { id: "a2", statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    expect(next.streak).toBe(p.streak);
    expect(next.plan).toBe(p.plan);
    expect(next.date).toBe(p.date);
    expect(next.completedToday).toBe(p.completedToday);
  });

  it("does not mutate the previous payload (React state must stay immutable)", () => {
    const p = base();
    const snapshot = JSON.stringify(p);
    applyTaskUpdate(p, { id: "a1", statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    removeTask(p, "a1");
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("only touches the updated task's object; the other rows keep their identity", () => {
    const p = base();
    const next = applyTaskUpdate(p, { id: "b1", statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    expect(next.tasks[0]).toBe(p.tasks[0]);
    expect(next.tasks[1]).toBe(p.tasks[1]);
    expect(next.tasks[2]).not.toBe(p.tasks[2]);
    expect(next.frog).toBe(p.frog);
  });

  it("removeTask of an unknown id changes nothing visible and keeps the frog", () => {
    const p = base();
    const next = removeTask(p, "nope");
    expect(next.tasks).toHaveLength(3);
    expect(next.frog).toBe(p.frog);
    expect(next.openA).toBe(2);
  });

  it("removeTask of an open A task lowers openA; of a done A task it does not", () => {
    const p = applyTaskUpdate(base(), { id: "a2", statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    expect(p.openA).toBe(1);
    expect(removeTask(p, "a2").openA).toBe(1);
    expect(removeTask(p, "a1").openA).toBe(0);
  });

  it("removing every task leaves an empty list and a null frog if it was the frog", () => {
    let p = base();
    for (const id of ["a1", "a2", "b1"]) p = removeTask(p, id);
    expect(p.tasks).toEqual([]);
    expect(p.frog).toBeNull();
    expect(p.openA).toBe(0);
  });

  it("applyTaskUpdate on a frog that is not in the list still updates the frog card", () => {
    const p = { ...base(), frog: { ...t("far", "A"), subtasks: [] } };
    const next = applyTaskUpdate(p, { id: "far", statusId: "done", completedAt: "2026-10-24T07:00:00Z" });
    expect(next.frog?.completedAt).toBe("2026-10-24T07:00:00Z");
    expect(next.tasks).toHaveLength(3);
  });
});
