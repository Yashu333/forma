import { describe, expect, it } from "vitest";
import { completionRate, habitStreak, parseWeekdays } from "./streak";

const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
// 2026-10-24 is a Saturday.
const TODAY = "2026-10-24";
const set = (...d: string[]) => new Set(d);

describe("habitStreak", () => {
  it("is zero with no ticks", () => {
    expect(habitStreak(ALL, set(), TODAY, "2026-10-01")).toEqual({ current: 0, longest: 0 });
  });

  it("counts consecutive days up to today", () => {
    expect(habitStreak(ALL, set("2026-10-22", "2026-10-23", "2026-10-24"), TODAY, "2026-10-01")).toEqual({ current: 3, longest: 3 });
  });

  it("an unticked today does not break the streak yet", () => {
    expect(habitStreak(ALL, set("2026-10-22", "2026-10-23"), TODAY, "2026-10-01")).toEqual({ current: 2, longest: 2 });
  });

  it("a missed scheduled day breaks it, and the longest run is remembered", () => {
    const ticks = set("2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-23", "2026-10-24");
    expect(habitStreak(ALL, ticks, TODAY, "2026-10-01")).toEqual({ current: 2, longest: 4 });
  });

  it("unscheduled days neither break nor extend a streak when unticked", () => {
    // Weekdays only: Fri 23rd and Mon 26th... today is Sat 24th (unscheduled)
    expect(habitStreak(WEEKDAYS, set("2026-10-21", "2026-10-22", "2026-10-23"), TODAY, "2026-10-01")).toEqual({ current: 3, longest: 3 });
    // Thu, Fri ticked, weekend skipped, Mon, Tue ticked: one run of 4
    const ticks = set("2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20");
    expect(habitStreak(WEEKDAYS, ticks, "2026-10-20", "2026-10-01")).toEqual({ current: 4, longest: 4 });
  });

  it("a tick on an unscheduled day is a bonus that adds to the streak", () => {
    expect(habitStreak(WEEKDAYS, set("2026-10-22", "2026-10-23", "2026-10-24"), TODAY, "2026-10-01")).toEqual({ current: 3, longest: 3 });
  });

  it("days before the habit existed do not count against it", () => {
    expect(habitStreak(ALL, set("2026-10-23", "2026-10-24"), TODAY, "2026-10-23")).toEqual({ current: 2, longest: 2 });
  });

  it("a tick before the creation date still counts", () => {
    expect(habitStreak(ALL, set("2026-10-22", "2026-10-23", "2026-10-24"), TODAY, "2026-10-24")).toEqual({ current: 3, longest: 3 });
  });

  it("a habit created today with nothing ticked has no streak", () => {
    expect(habitStreak(ALL, set(), TODAY, TODAY)).toEqual({ current: 0, longest: 0 });
  });

  it("works across a year boundary", () => {
    expect(habitStreak(ALL, set("2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"), "2027-01-02", "2026-12-01")).toEqual({ current: 4, longest: 4 });
  });

  it("a very old habit does not loop forever", () => {
    const r = habitStreak(ALL, set(TODAY), TODAY, "1990-01-01");
    expect(r).toEqual({ current: 1, longest: 1 });
  });
});

describe("completionRate", () => {
  it("counts only scheduled days", () => {
    // Mon 19 to Sun 25 Oct, weekdays only: 5 scheduled
    const r = completionRate(WEEKDAYS, set("2026-10-19", "2026-10-20", "2026-10-24"), "2026-10-19", "2026-10-25", "2026-10-01");
    expect(r).toEqual({ scheduled: 5, done: 2, rate: 0.4 });
  });

  it("starts at the creation date", () => {
    const r = completionRate(ALL, set("2026-10-23", "2026-10-24"), "2026-10-19", "2026-10-24", "2026-10-23");
    expect(r).toEqual({ scheduled: 2, done: 2, rate: 1 });
  });

  it("is zero when nothing was scheduled", () => {
    expect(completionRate([0], set(), "2026-10-19", "2026-10-23", "2026-10-01")).toEqual({ scheduled: 0, done: 0, rate: 0 });
  });
});

describe("parseWeekdays", () => {
  it("sorts and de-duplicates", () => expect(parseWeekdays([5, 1, 1, 0])).toEqual([0, 1, 5]));
  it.each([[[]], [[7]], [[-1]], [[1.5]], [["1"]], ["1,2"], [null], [[0, 1, 2, 3, 4, 5, 6, 0]]])("rejects %j", (v) => {
    // eight entries is too many even though they de-duplicate
    expect(parseWeekdays(v)).toBeNull();
  });
});
