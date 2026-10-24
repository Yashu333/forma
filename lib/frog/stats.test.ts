import { describe, expect, it } from "vitest";
import { evaluatePlan, frogStats, type FrogPlanInput } from "./stats";

const NY = "America/New_York";
const AKL = "Pacific/Auckland";
const TODAY = "2026-10-23";

// A plan whose frog was completed at `iso` (UTC), or still open when omitted.
const plan = (date: string, completedAt?: string | Date | null): FrogPlanInput => ({
  date,
  frogTask: { completedAt: completedAt ?? null },
});
const noFrog = (date: string): FrogPlanInput => ({ date, frogTask: null });

describe("evaluatePlan", () => {
  it("is eaten and before noon when completed at 09:42 local on the plan date", () => {
    // 13:42Z is 09:42 EDT.
    expect(evaluatePlan(plan("2026-10-23", "2026-10-23T13:42:00Z"), NY)).toEqual({
      date: "2026-10-23",
      planned: true,
      eaten: true,
      beforeNoon: true,
    });
  });

  it("is eaten but not before noon at 12:00 local, with 11:59:59 still before", () => {
    expect(evaluatePlan(plan("2026-10-23", "2026-10-23T16:00:00Z"), NY).beforeNoon).toBe(false); // 12:00 EDT
    expect(evaluatePlan(plan("2026-10-23", "2026-10-23T16:00:00Z"), NY).eaten).toBe(true);
    expect(evaluatePlan(plan("2026-10-23", "2026-10-23T15:59:59Z"), NY).beforeNoon).toBe(true); // 11:59:59 EDT
  });

  it("is not eaten while the frog is open", () => {
    expect(evaluatePlan(plan("2026-10-23", null), NY)).toEqual({
      date: "2026-10-23",
      planned: true,
      eaten: false,
      beforeNoon: false,
    });
  });

  it("is not eaten when completed on a later local day", () => {
    // 04:00Z on Oct 24 is 00:00 EDT Oct 24: one second too late for Oct 23.
    expect(evaluatePlan(plan("2026-10-23", "2026-10-24T04:00:00Z"), NY).eaten).toBe(false);
    expect(evaluatePlan(plan("2026-10-23", "2026-10-24T03:59:59Z"), NY).eaten).toBe(true); // 23:59:59 EDT
  });

  it("uses the local date, not the UTC date: 23:30 local is still that day", () => {
    // 23:30 EDT Oct 23 = 03:30Z Oct 24. Late, but on the plan date, so eaten (not before noon).
    const r = evaluatePlan(plan("2026-10-23", "2026-10-24T03:30:00Z"), NY);
    expect(r.eaten).toBe(true);
    expect(r.beforeNoon).toBe(false);
  });

  it("uses the local date for far-east zones", () => {
    // Auckland NZDT is UTC+13: 2026-10-22T12:00Z is 01:00 on Oct 23 local.
    const r = evaluatePlan(plan("2026-10-22", "2026-10-22T12:00:00Z"), AKL);
    expect(r.eaten).toBe(false); // Oct 23 local, after plan date Oct 22
    expect(evaluatePlan(plan("2026-10-23", "2026-10-22T12:00:00Z"), AKL)).toMatchObject({ eaten: true, beforeNoon: true });
  });

  it("counts a frog completed before its plan date as eaten", () => {
    // Done the day before it was planned for.
    expect(evaluatePlan(plan("2026-10-23", "2026-10-22T13:00:00Z"), NY)).toMatchObject({ eaten: true, beforeNoon: true });
  });

  it("applies the 12:00 cut-off on DST days", () => {
    // NY spring forward 2026-03-08: noon EDT is 16:00Z.
    expect(evaluatePlan(plan("2026-03-08", "2026-03-08T15:59:59Z"), NY).beforeNoon).toBe(true);
    expect(evaluatePlan(plan("2026-03-08", "2026-03-08T16:00:00Z"), NY).beforeNoon).toBe(false);
    // NY fall back 2026-11-01: noon EST is 17:00Z.
    expect(evaluatePlan(plan("2026-11-01", "2026-11-01T16:59:59Z"), NY).beforeNoon).toBe(true);
    expect(evaluatePlan(plan("2026-11-01", "2026-11-01T17:00:00Z"), NY).beforeNoon).toBe(false);
  });

  it("accepts a Date or an ISO string", () => {
    const iso = "2026-10-23T13:00:00.000Z";
    expect(evaluatePlan(plan("2026-10-23", new Date(iso)), NY)).toEqual(evaluatePlan(plan("2026-10-23", iso), NY));
  });

  it("marks a plan without a frog as unplanned and uneaten", () => {
    expect(evaluatePlan(noFrog("2026-10-23"), NY)).toEqual({
      date: "2026-10-23",
      planned: false,
      eaten: false,
      beforeNoon: false,
    });
  });

  it("treats an unparseable completedAt as not completed", () => {
    expect(evaluatePlan(plan("2026-10-23", "garbage"), NY)).toMatchObject({ planned: true, eaten: false });
  });

  it("throws RangeError for an invalid time zone when there is a completion to place", () => {
    expect(() => evaluatePlan(plan("2026-10-23", "2026-10-23T13:00:00Z"), "Nope/Zone")).toThrow(RangeError);
  });
});

describe("frogStats", () => {
  it("returns zeros for empty input", () => {
    expect(frogStats([], NY, TODAY, 30)).toEqual({
      plannedDays: 0,
      eatenDays: 0,
      eatenRate: 0,
      beforeNoonRate: 0,
      current: 0,
      longest: 0,
    });
  });

  it("returns zeros for empty input with range 'all'", () => {
    expect(frogStats([], NY, TODAY, "all")).toMatchObject({ plannedDays: 0, eatenRate: 0, beforeNoonRate: 0 });
  });

  it("computes counts, rates and streaks for a mixed history", () => {
    const plans = [
      plan("2026-10-19", "2026-10-19T14:00:00Z"), // 10:00 EDT, eaten before noon
      plan("2026-10-20", "2026-10-20T19:00:00Z"), // 15:00 EDT, eaten after noon
      plan("2026-10-21", null), // not eaten
      plan("2026-10-22", "2026-10-22T13:00:00Z"), // 09:00 EDT, before noon
      plan("2026-10-23", "2026-10-23T12:30:00Z"), // 08:30 EDT, before noon
    ];
    expect(frogStats(plans, NY, TODAY, 30)).toEqual({
      plannedDays: 5,
      eatenDays: 4,
      eatenRate: 4 / 5,
      beforeNoonRate: 3 / 4,
      current: 2,
      longest: 2,
    });
  });

  it("keeps the streak alive when today's frog is uneaten", () => {
    const plans = [
      plan("2026-10-21", "2026-10-21T14:00:00Z"),
      plan("2026-10-22", "2026-10-22T14:00:00Z"),
      plan("2026-10-23", null),
    ];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({
      plannedDays: 3,
      eatenDays: 2,
      current: 2,
      longest: 2,
    });
  });

  it("doesn't count a frog finished the next day, for the rate or the streak", () => {
    const plans = [
      plan("2026-10-21", "2026-10-21T14:00:00Z"),
      plan("2026-10-22", "2026-10-23T14:00:00Z"), // finished a day late
      plan("2026-10-23", "2026-10-23T14:30:00Z"),
    ];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ plannedDays: 3, eatenDays: 2, current: 1, longest: 1 });
  });

  it("breaks the streak on a gap day with no plan", () => {
    const plans = [
      plan("2026-10-18", "2026-10-18T14:00:00Z"),
      plan("2026-10-19", "2026-10-19T14:00:00Z"),
      plan("2026-10-20", "2026-10-20T14:00:00Z"),
      // 21st: no plan
      plan("2026-10-22", "2026-10-22T14:00:00Z"),
      plan("2026-10-23", "2026-10-23T14:00:00Z"),
    ];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ plannedDays: 5, eatenDays: 5, eatenRate: 1, current: 2, longest: 3 });
  });

  it("limits counts to the last rangeDays days, today included", () => {
    const plans = [
      plan("2026-10-16", "2026-10-16T14:00:00Z"), // outside a 7-day window (starts Oct 17)
      plan("2026-10-17", null), // first day inside
      plan("2026-10-23", "2026-10-23T14:00:00Z"),
    ];
    expect(frogStats(plans, NY, TODAY, 7)).toMatchObject({ plannedDays: 2, eatenDays: 1, eatenRate: 0.5 });
    expect(frogStats(plans, NY, TODAY, 8)).toMatchObject({ plannedDays: 3, eatenDays: 2 });
  });

  it("treats rangeDays 1 as just today", () => {
    const plans = [plan("2026-10-22", "2026-10-22T14:00:00Z"), plan("2026-10-23", null)];
    expect(frogStats(plans, NY, TODAY, 1)).toMatchObject({ plannedDays: 1, eatenDays: 0 });
  });

  it("includes everything up to today for 'all'", () => {
    const plans = [plan("2024-01-02", "2024-01-02T14:00:00Z"), plan("2026-10-23", "2026-10-23T14:00:00Z")];
    expect(frogStats(plans, NY, TODAY, "all")).toMatchObject({ plannedDays: 2, eatenDays: 2 });
    expect(frogStats(plans, NY, TODAY, 90)).toMatchObject({ plannedDays: 1, eatenDays: 1 });
  });

  it("computes streaks from all plans, not just the range", () => {
    const plans = [
      plan("2026-10-01", "2026-10-01T14:00:00Z"),
      plan("2026-10-02", "2026-10-02T14:00:00Z"),
      plan("2026-10-03", "2026-10-03T14:00:00Z"),
      plan("2026-10-23", "2026-10-23T14:00:00Z"),
    ];
    expect(frogStats(plans, NY, TODAY, 7)).toMatchObject({ plannedDays: 1, current: 1, longest: 3 });
  });

  it("ignores plans dated after today", () => {
    const plans = [plan("2026-10-23", "2026-10-23T14:00:00Z"), plan("2026-10-24", null), plan("2026-10-25", "2026-10-25T14:00:00Z")];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ plannedDays: 1, eatenDays: 1, current: 1, longest: 1 });
  });

  it("doesn't count plans without a frog as planned days", () => {
    const plans = [noFrog("2026-10-21"), plan("2026-10-22", "2026-10-22T14:00:00Z"), noFrog("2026-10-23")];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ plannedDays: 1, eatenDays: 1, eatenRate: 1, current: 1 });
  });

  it("breaks the streak on a frog-less plan day", () => {
    const plans = [plan("2026-10-20", "2026-10-20T14:00:00Z"), noFrog("2026-10-21"), plan("2026-10-22", "2026-10-22T14:00:00Z")];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ current: 1, longest: 1 });
  });

  it("reports beforeNoonRate as a share of eaten frogs, 0 when none were eaten", () => {
    expect(frogStats([plan("2026-10-23", null)], NY, TODAY, 30)).toMatchObject({ eatenDays: 0, beforeNoonRate: 0 });
    const plans = [
      plan("2026-10-22", "2026-10-22T20:00:00Z"), // 16:00 EDT
      plan("2026-10-23", "2026-10-23T20:00:00Z"), // 16:00 EDT
    ];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ eatenDays: 2, beforeNoonRate: 0 });
  });

  it("judges 'before noon' in the user's zone, not UTC", () => {
    // 2026-10-22T20:00Z is 09:00 on Oct 23 in Auckland (NZDT) and 16:00 in New York.
    const plans = [plan("2026-10-23", "2026-10-22T20:00:00Z")];
    expect(frogStats(plans, AKL, TODAY, 30)).toMatchObject({ eatenDays: 1, beforeNoonRate: 1 });
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ eatenDays: 1, beforeNoonRate: 0 });
  });

  it("handles a 23:30 local completion that is already the next UTC day", () => {
    // 03:30Z Oct 24 = 23:30 EDT Oct 23: eaten for Oct 23, not before noon.
    const plans = [plan("2026-10-23", "2026-10-24T03:30:00Z")];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ eatenDays: 1, beforeNoonRate: 0, current: 1 });
  });

  it("works across a year boundary", () => {
    const plans = [
      plan("2026-12-30", "2026-12-30T14:00:00Z"),
      plan("2026-12-31", "2026-12-31T14:00:00Z"),
      plan("2027-01-01", "2027-01-01T14:00:00Z"),
    ];
    expect(frogStats(plans, NY, "2027-01-01", 3)).toMatchObject({ plannedDays: 3, eatenDays: 3, current: 3, longest: 3 });
    expect(frogStats(plans, NY, "2027-01-01", 2)).toMatchObject({ plannedDays: 2, eatenDays: 2, current: 3 });
  });

  it("works across a month boundary window", () => {
    const plans = [plan("2026-09-30", null), plan("2026-10-01", "2026-10-01T14:00:00Z")];
    // A 2-day window ending Oct 1 starts on Sep 30.
    expect(frogStats(plans, NY, "2026-10-01", 2)).toMatchObject({ plannedDays: 2, eatenDays: 1 });
    expect(frogStats(plans, NY, "2026-10-01", 1)).toMatchObject({ plannedDays: 1, eatenDays: 1 });
  });

  it("works across NY DST transition dates", () => {
    const plans = [
      plan("2026-03-07", "2026-03-07T15:00:00Z"),
      plan("2026-03-08", "2026-03-08T15:00:00Z"), // 11:00 EDT
      plan("2026-03-09", "2026-03-09T15:00:00Z"),
    ];
    expect(frogStats(plans, NY, "2026-03-09", 3)).toMatchObject({ plannedDays: 3, eatenDays: 3, beforeNoonRate: 1, current: 3 });
    const fall = [
      plan("2026-10-31", "2026-10-31T15:00:00Z"),
      plan("2026-11-01", "2026-11-01T16:00:00Z"), // 11:00 EST
      plan("2026-11-02", "2026-11-02T16:00:00Z"),
    ];
    expect(frogStats(fall, NY, "2026-11-02", 3)).toMatchObject({ plannedDays: 3, eatenDays: 3, beforeNoonRate: 1, current: 3 });
  });

  it("works in Auckland, where local days start before the UTC date does", () => {
    // In NZDT (UTC+13): Oct 22 09:00 local = Oct 21 20:00Z; Oct 23 09:00 local = Oct 22 20:00Z.
    const plans = [plan("2026-10-22", "2026-10-21T20:00:00Z"), plan("2026-10-23", "2026-10-22T20:00:00Z")];
    expect(frogStats(plans, AKL, TODAY, 30)).toMatchObject({ plannedDays: 2, eatenDays: 2, beforeNoonRate: 1, current: 2, longest: 2 });
  });

  it("accepts ISO strings and Dates for completedAt", () => {
    const plans = [plan("2026-10-23", "2026-10-23T13:00:00.000Z"), plan("2026-10-22", new Date("2026-10-22T13:00:00Z"))];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ eatenDays: 2, current: 2 });
  });

  it("ignores plans with an invalid date key", () => {
    const plans = [plan("garbage", "2026-10-23T13:00:00Z"), plan("2026-10-23", "2026-10-23T13:00:00Z")];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ plannedDays: 1, eatenDays: 1 });
  });

  it("doesn't mutate its input", () => {
    const plans = [plan("2026-10-23", "2026-10-23T13:00:00Z"), plan("2026-10-22", null)];
    const copy = JSON.parse(JSON.stringify(plans));
    frogStats(plans, NY, TODAY, 30);
    expect(JSON.parse(JSON.stringify(plans))).toEqual(copy);
  });

  it("throws RangeError for an invalid time zone, even with no plans", () => {
    expect(() => frogStats([], "Nope/Zone", TODAY, 30)).toThrow(RangeError);
    expect(() => frogStats([], "", TODAY, 30)).toThrow(RangeError);
  });

  it("throws RangeError for an invalid today", () => {
    expect(() => frogStats([], NY, "2026-02-30", 30)).toThrow(RangeError);
    expect(() => frogStats([], NY, "today", 30)).toThrow(RangeError);
  });

  it("throws RangeError for an invalid rangeDays", () => {
    for (const r of [0, -7, 1.5, NaN, Infinity]) {
      expect(() => frogStats([], NY, TODAY, r), String(r)).toThrow(RangeError);
    }
  });
});
