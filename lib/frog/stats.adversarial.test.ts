// Extra, adversarial coverage for evaluatePlan / frogStats focused on the
// spec's open decisions: a plan counts as planned only if it has a frog and
// its date <= today; beforeNoonRate = before-noon eaten / eaten days; counts
// use the last rangeDays days ending today while streaks use every plan.
import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { evaluatePlan, frogStats, type FrogPlanInput } from "./stats";

const NY = "America/New_York";
const AKL = "Pacific/Auckland";
const TODAY = "2026-10-23";

const plan = (date: string, completedAt?: string | Date | null): FrogPlanInput => ({ date, frogTask: { completedAt: completedAt ?? null } });
const noFrog = (date: string): FrogPlanInput => ({ date, frogTask: null });

describe("evaluatePlan: completion relative to the plan date", () => {
  it("frog completed the day after the plan date is not eaten, and not before noon even at 06:00", () => {
    // plan 2026-10-22, completed 2026-10-23 06:00 NY (10:00Z)
    expect(evaluatePlan(plan("2026-10-22", "2026-10-23T10:00:00Z"), NY)).toEqual({
      date: "2026-10-22",
      planned: true,
      eaten: false,
      beforeNoon: false,
    });
  });

  it("local-midnight boundary: 23:59:59.999 on the plan date is eaten, 00:00:00.000 the next day is not (NY)", () => {
    // NY is UTC-4 on 2026-10-22: 23:59:59.999 local = 03:59:59.999Z on the 23rd
    expect(evaluatePlan(plan("2026-10-22", "2026-10-23T03:59:59.999Z"), NY)).toMatchObject({ eaten: true, beforeNoon: false });
    expect(evaluatePlan(plan("2026-10-22", "2026-10-23T04:00:00.000Z"), NY)).toMatchObject({ eaten: false, beforeNoon: false });
  });

  it("same boundary in a zone ahead of UTC (Auckland NZDT +13): plan 2026-10-22 ends at 11:00Z on the 22nd", () => {
    expect(evaluatePlan(plan("2026-10-22", "2026-10-22T10:59:59.999Z"), AKL)).toMatchObject({ eaten: true });
    expect(evaluatePlan(plan("2026-10-22", "2026-10-22T11:00:00.000Z"), AKL)).toMatchObject({ eaten: false });
    // A UTC-day reading would call 2026-10-22T20:00Z "the 22nd" (eaten) but it's the 23rd in Auckland.
    expect(evaluatePlan(plan("2026-10-22", "2026-10-22T20:00:00Z"), AKL)).toMatchObject({ eaten: false });
  });

  it("a frog completed at 00:00:00 local on the plan date is eaten before noon (hour 0)", () => {
    expect(evaluatePlan(plan("2026-10-22", "2026-10-22T04:00:00Z"), NY)).toEqual({
      date: "2026-10-22",
      planned: true,
      eaten: true,
      beforeNoon: true,
    });
  });

  it("frog completed weeks after the plan date is not eaten", () => {
    expect(evaluatePlan(plan("2026-09-01", "2026-10-20T15:00:00Z"), NY).eaten).toBe(false);
  });

  it("frog with completedAt = null is planned but not eaten; undefined and missing property behave the same", () => {
    const want = { date: "2026-10-22", planned: true, eaten: false, beforeNoon: false };
    expect(evaluatePlan({ date: "2026-10-22", frogTask: { completedAt: null } }, NY)).toEqual(want);
    expect(evaluatePlan({ date: "2026-10-22", frogTask: { completedAt: undefined as unknown as null } }, NY)).toEqual(want);
    expect(evaluatePlan({ date: "2026-10-22", frogTask: {} as unknown as { completedAt: null } }, NY)).toEqual(want);
  });

  it("empty-string completedAt is not a completion", () => {
    expect(evaluatePlan(plan("2026-10-22", ""), NY)).toMatchObject({ planned: true, eaten: false });
  });

  it("an epoch-0 completedAt (a falsy-looking Date value) is a real completion, long before the plan date", () => {
    expect(evaluatePlan(plan("2026-10-22", new Date(0)), NY)).toMatchObject({ eaten: true, beforeNoon: false }); // 19:00 on 1969-12-31
  });

  it("beforeNoon implies eaten for every hour of the day", () => {
    for (let h = 0; h < 24; h++) {
      const iso = `2026-10-22T${String(h).padStart(2, "0")}:00:00Z`;
      const r = evaluatePlan(plan("2026-10-22", iso), "UTC");
      expect(r.eaten).toBe(true);
      expect(r.beforeNoon).toBe(h < 12);
    }
  });

  it("DST overlap in NY: 01:30 EDT and 01:30 EST on 2026-11-01 are both eaten before noon for that plan date", () => {
    expect(evaluatePlan(plan("2026-11-01", "2026-11-01T05:30:00Z"), NY)).toMatchObject({ eaten: true, beforeNoon: true });
    expect(evaluatePlan(plan("2026-11-01", "2026-11-01T06:30:00Z"), NY)).toMatchObject({ eaten: true, beforeNoon: true });
  });

  it("DST gap in NY: completed at the first instant after spring-forward (03:00 EDT) is hour 3", () => {
    expect(evaluatePlan(plan("2026-03-08", "2026-03-08T07:00:00Z"), NY)).toMatchObject({ eaten: true, beforeNoon: true });
  });

  it("plan with a frog task that has an invalid date string is not eaten (no throw)", () => {
    expect(evaluatePlan(plan("2026-10-22", "not a date"), NY)).toMatchObject({ planned: true, eaten: false, beforeNoon: false });
  });
});

describe("frogStats: frog finished the day after, or never", () => {
  it("next-day completion: counted as planned, not eaten, no streak, and doesn't count toward beforeNoon", () => {
    const plans = [plan("2026-10-21", "2026-10-22T13:00:00Z")]; // 09:00 NY on the 22nd
    expect(frogStats(plans, NY, TODAY, 30)).toEqual({
      plannedDays: 1,
      eatenDays: 0,
      eatenRate: 0,
      beforeNoonRate: 0,
      current: 0,
      longest: 0,
    });
  });

  it("next-day completion breaks a streak that the spec says it should break", () => {
    const plans = [
      plan("2026-10-20", "2026-10-20T14:00:00Z"),
      plan("2026-10-21", "2026-10-22T14:00:00Z"), // late
      plan("2026-10-22", "2026-10-22T14:00:00Z"),
      plan(TODAY, "2026-10-23T14:00:00Z"),
    ];
    const s = frogStats(plans, NY, TODAY, 30);
    expect(s.current).toBe(2);
    expect(s.longest).toBe(2);
    expect(s.eatenDays).toBe(3);
    expect(s.plannedDays).toBe(4);
    expect(s.eatenRate).toBe(3 / 4);
  });

  it("frog with no completedAt on a past day: planned, uneaten, and breaks the streak", () => {
    const plans = [plan("2026-10-21", "2026-10-21T14:00:00Z"), plan("2026-10-22"), plan(TODAY, "2026-10-23T14:00:00Z")];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ plannedDays: 3, eatenDays: 2, current: 1, longest: 1 });
  });

  it("uneaten frog today is planned but the streak from yesterday survives", () => {
    const plans = [plan("2026-10-21", "2026-10-21T14:00:00Z"), plan("2026-10-22", "2026-10-22T14:00:00Z"), plan(TODAY)];
    expect(frogStats(plans, NY, TODAY, 30)).toMatchObject({ plannedDays: 3, eatenDays: 2, current: 2, longest: 2 });
  });
});

describe("frogStats: decisions the developer made where the spec was open", () => {
  it("planned = has a frog AND date <= today: frog-less plans and future plans don't count, and don't distort the rate", () => {
    const plans = [
      plan("2026-10-22", "2026-10-22T14:00:00Z"),
      noFrog("2026-10-21"),
      plan("2026-10-24"), // tomorrow's pre-selected frog
      plan("2027-01-01", "2026-10-23T14:00:00Z"), // far-future plan whose frog is somehow already done
    ];
    const s = frogStats(plans, NY, TODAY, 30);
    expect(s.plannedDays).toBe(1);
    expect(s.eatenDays).toBe(1);
    expect(s.eatenRate).toBe(1);
  });

  it("a plan dated today with a frog counts as planned immediately (even if the frog is open)", () => {
    expect(frogStats([plan(TODAY)], NY, TODAY, 7)).toMatchObject({ plannedDays: 1, eatenDays: 0, eatenRate: 0 });
  });

  it("beforeNoonRate is before-noon / EATEN days, not / planned days", () => {
    const plans = [
      plan("2026-10-20", "2026-10-20T13:00:00Z"), // 09:00 NY, before noon
      plan("2026-10-21", "2026-10-21T20:00:00Z"), // 16:00 NY
      plan("2026-10-22"), // not eaten
      plan("2026-10-19"), // not eaten
    ];
    const s = frogStats(plans, NY, TODAY, 30);
    expect(s.plannedDays).toBe(4);
    expect(s.eatenDays).toBe(2);
    expect(s.beforeNoonRate).toBe(0.5); // would be 0.25 if divided by planned days
    expect(s.eatenRate).toBe(0.5);
  });

  it("beforeNoonRate only considers eaten days inside the range window", () => {
    const plans = [
      plan("2026-09-01", "2026-09-01T13:00:00Z"), // before noon, outside a 7-day window
      plan("2026-10-22", "2026-10-22T20:00:00Z"), // afternoon, inside
    ];
    expect(frogStats(plans, NY, TODAY, 7)).toMatchObject({ plannedDays: 1, eatenDays: 1, beforeNoonRate: 0 });
    expect(frogStats(plans, NY, TODAY, "all")).toMatchObject({ plannedDays: 2, eatenDays: 2, beforeNoonRate: 0.5 });
  });

  it("window is exactly rangeDays long ending today inclusive: day today-(n-1) is in, today-n is out", () => {
    const n = 10;
    const inside = addDays(TODAY, -(n - 1)); // 2026-10-14
    const outside = addDays(TODAY, -n); // 2026-10-13
    const plans = [plan(inside, `${inside}T15:00:00Z`), plan(outside, `${outside}T15:00:00Z`)];
    expect(frogStats(plans, NY, TODAY, n)).toMatchObject({ plannedDays: 1, eatenDays: 1 });
    expect(frogStats(plans, NY, TODAY, n + 1)).toMatchObject({ plannedDays: 2, eatenDays: 2 });
  });

  it("window across a month and year boundary", () => {
    const today = "2027-01-03";
    const plans = [plan("2026-12-28", "2026-12-28T15:00:00Z"), plan("2026-12-27", "2026-12-27T15:00:00Z")];
    // 7 days ending 2027-01-03 starts 2026-12-28
    expect(frogStats(plans, NY, today, 7)).toMatchObject({ plannedDays: 1, eatenDays: 1 });
  });

  it("streaks use ALL plans passed in even when counts only use the window (consistency between the two)", () => {
    const plans: FrogPlanInput[] = [];
    for (let i = 0; i < 45; i++) {
      const d = addDays(TODAY, -i);
      plans.push(plan(d, `${d}T15:00:00Z`));
    }
    const s = frogStats(plans, NY, TODAY, 7);
    expect(s.plannedDays).toBe(7);
    expect(s.eatenDays).toBe(7);
    expect(s.current).toBe(45);
    expect(s.longest).toBe(45);
    // Documented consequence: a streak can legitimately exceed eatenDays when rangeDays is short.
    expect(s.current).toBeGreaterThan(s.eatenDays);
  });

  it("all-range counts equal summing the pieces, and eatenDays <= plannedDays always", () => {
    const plans = [
      plan("2026-10-18", "2026-10-18T13:00:00Z"),
      plan("2026-10-19"),
      plan("2026-10-20", "2026-10-21T13:00:00Z"),
      noFrog("2026-10-21"),
      plan("2026-10-22", "2026-10-22T13:00:00Z"),
    ];
    for (const r of [1, 3, 7, 30, "all"] as const) {
      const s = frogStats(plans, NY, TODAY, r);
      expect(s.eatenDays).toBeLessThanOrEqual(s.plannedDays);
      expect(s.eatenRate).toBeGreaterThanOrEqual(0);
      expect(s.eatenRate).toBeLessThanOrEqual(1);
      expect(s.beforeNoonRate).toBeGreaterThanOrEqual(0);
      expect(s.beforeNoonRate).toBeLessThanOrEqual(1);
      expect(s.longest).toBeGreaterThanOrEqual(s.current);
    }
  });

  it("the whole plan list in the all-range is order independent", () => {
    const plans = [
      plan("2026-10-18", "2026-10-18T13:00:00Z"),
      plan("2026-10-19", "2026-10-19T13:00:00Z"),
      plan("2026-10-20"),
      plan("2026-10-22", "2026-10-22T13:00:00Z"),
    ];
    expect(frogStats([...plans].reverse(), NY, TODAY, "all")).toEqual(frogStats(plans, NY, TODAY, "all"));
  });

  it("a frog completed in the past and picked as a later day's frog counts as eaten (spec: completedAt local date <= plan date)", () => {
    // This is what the spec literally says; flagged to the developer as a product consequence, not a bug.
    expect(frogStats([plan("2026-10-22", "2026-10-01T13:00:00Z")], NY, TODAY, 30)).toMatchObject({ plannedDays: 1, eatenDays: 1 });
  });

  it("rangeDays validation: 0, negative, fractional, NaN, Infinity and numeric strings all throw", () => {
    for (const r of [0, -1, 0.5, NaN, Infinity, "30" as unknown as number, "ALL" as unknown as "all"]) {
      expect(() => frogStats([], NY, TODAY, r), String(r)).toThrow(RangeError);
    }
  });

  it("an enormous rangeDays doesn't silently drop every plan (either throws or behaves like 'all')", () => {
    const plans = [plan("2026-10-22", "2026-10-22T13:00:00Z")];
    let s: ReturnType<typeof frogStats> | undefined;
    try {
      s = frogStats(plans, NY, TODAY, 1e9);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      return;
    }
    expect(s).toEqual(frogStats(plans, NY, TODAY, "all"));
  });

  it("works in Auckland where 'today' there is the next UTC day: a 23:30 local completion is the plan's own day", () => {
    // 2026-10-22 23:30 NZDT = 10:30Z on the 22nd
    const s = frogStats([plan("2026-10-22", "2026-10-22T10:30:00Z")], AKL, TODAY, 30);
    expect(s).toMatchObject({ plannedDays: 1, eatenDays: 1, beforeNoonRate: 0 });
  });

  it("with an empty plan list and every range gives all zeros, never NaN", () => {
    for (const r of [1, 30, 90, "all"] as const) {
      const s = frogStats([], NY, TODAY, r);
      expect(s).toEqual({ plannedDays: 0, eatenDays: 0, eatenRate: 0, beforeNoonRate: 0, current: 0, longest: 0 });
    }
  });
});
