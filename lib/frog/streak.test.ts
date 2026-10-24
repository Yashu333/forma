import { describe, expect, it } from "vitest";
import { computeStreaks, type StreakDay } from "./streak";

const TODAY = "2026-10-23";
const eaten = (...dates: string[]): StreakDay[] => dates.map((date) => ({ date, eaten: true }));
const missed = (...dates: string[]): StreakDay[] => dates.map((date) => ({ date, eaten: false }));

describe("computeStreaks", () => {
  it("is 0/0 for empty input", () => {
    expect(computeStreaks([], TODAY)).toEqual({ current: 0, longest: 0 });
  });

  it("counts today when its frog is eaten", () => {
    expect(computeStreaks(eaten("2026-10-23"), TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it("counts consecutive eaten days ending today", () => {
    expect(computeStreaks(eaten("2026-10-21", "2026-10-22", "2026-10-23"), TODAY)).toEqual({ current: 3, longest: 3 });
  });

  it("doesn't break the current streak when today's frog is still uneaten", () => {
    const days = [...eaten("2026-10-20", "2026-10-21", "2026-10-22"), ...missed("2026-10-23")];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 3, longest: 3 });
  });

  it("doesn't break the current streak when today has no plan yet", () => {
    expect(computeStreaks(eaten("2026-10-21", "2026-10-22"), TODAY)).toEqual({ current: 2, longest: 2 });
  });

  it("is 0 current with only an uneaten today", () => {
    expect(computeStreaks(missed(TODAY), TODAY)).toEqual({ current: 0, longest: 0 });
  });

  it("breaks the streak on a yesterday that wasn't eaten", () => {
    const days = [...eaten("2026-10-20", "2026-10-21", "2026-10-23"), ...missed("2026-10-22")];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 1, longest: 2 });
  });

  it("breaks the streak on an uneaten yesterday even if today is uneaten too", () => {
    const days = [...eaten("2026-10-20", "2026-10-21"), ...missed("2026-10-22", "2026-10-23")];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 0, longest: 2 });
  });

  it("breaks the streak on a day with no plan at all (gap day)", () => {
    // 19, 20, [gap 21], 22, 23
    expect(computeStreaks(eaten("2026-10-19", "2026-10-20", "2026-10-22", "2026-10-23"), TODAY)).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it("finds a longest streak that is older than the current one", () => {
    const days = eaten("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-22", "2026-10-23");
    expect(computeStreaks(days, TODAY)).toEqual({ current: 2, longest: 4 });
  });

  it("keeps the current streak equal to the longest when they're the same run", () => {
    const days = eaten("2026-10-10", "2026-10-11", "2026-10-12");
    expect(computeStreaks(days, "2026-10-12")).toEqual({ current: 3, longest: 3 });
  });

  it("is 0 current when the last eaten day was two or more days ago", () => {
    expect(computeStreaks(eaten("2026-10-19", "2026-10-20", "2026-10-21"), TODAY)).toEqual({ current: 0, longest: 3 });
  });

  it("handles a gap of exactly one day before yesterday", () => {
    // yesterday eaten, 21 missing, 20 eaten
    expect(computeStreaks(eaten("2026-10-20", "2026-10-22"), TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it("accepts unsorted input", () => {
    const days = eaten("2026-10-23", "2026-10-21", "2026-10-22", "2026-10-19");
    expect(computeStreaks(days, TODAY)).toEqual({ current: 3, longest: 3 });
  });

  it("treats duplicate dates as eaten if any entry is", () => {
    const days = [...missed("2026-10-22"), ...eaten("2026-10-22", "2026-10-23")];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 2, longest: 2 });
  });

  it("ignores days after today (tomorrow's preselected frog)", () => {
    const days = [...eaten("2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25")];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 2, longest: 2 });
  });

  it("ignores entries with an invalid date", () => {
    const days = [...eaten("2026-10-22", "2026-10-23"), { date: "not-a-date", eaten: true }, { date: "2026-02-30", eaten: true }];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 2, longest: 2 });
  });

  it("runs across a month boundary", () => {
    const days = eaten("2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02");
    expect(computeStreaks(days, "2026-10-02")).toEqual({ current: 4, longest: 4 });
  });

  it("runs across a year boundary", () => {
    const days = eaten("2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02");
    expect(computeStreaks(days, "2027-01-02")).toEqual({ current: 4, longest: 4 });
  });

  it("counts back from yesterday across a year boundary when today is uneaten", () => {
    const days = [...eaten("2026-12-30", "2026-12-31"), ...missed("2027-01-01")];
    expect(computeStreaks(days, "2027-01-01")).toEqual({ current: 2, longest: 2 });
  });

  it("runs across the leap day", () => {
    const days = eaten("2028-02-28", "2028-02-29", "2028-03-01");
    expect(computeStreaks(days, "2028-03-01")).toEqual({ current: 3, longest: 3 });
  });

  it("runs across DST transition dates, since it works on date keys", () => {
    const days = eaten("2026-03-07", "2026-03-08", "2026-03-09");
    expect(computeStreaks(days, "2026-03-09")).toEqual({ current: 3, longest: 3 });
    const fall = eaten("2026-10-31", "2026-11-01", "2026-11-02");
    expect(computeStreaks(fall, "2026-11-02")).toEqual({ current: 3, longest: 3 });
  });

  it("counts a long run exactly", () => {
    const days: StreakDay[] = [];
    let d = "2026-01-01";
    for (let i = 0; i < 100; i++) {
      days.push({ date: d, eaten: true });
      const [y, m, day] = d.split("-").map(Number);
      const next = new Date(Date.UTC(y, m - 1, day + 1));
      d = next.toISOString().slice(0, 10);
    }
    // 100 days from Jan 1 ends on Apr 10.
    expect(computeStreaks(days, "2026-04-10")).toEqual({ current: 100, longest: 100 });
  });

  it("doesn't mutate its input", () => {
    const days = [...eaten("2026-10-23", "2026-10-21")];
    const copy = JSON.parse(JSON.stringify(days));
    computeStreaks(days, TODAY);
    expect(days).toEqual(copy);
  });

  it("throws RangeError for an invalid today", () => {
    expect(() => computeStreaks([], "nope")).toThrow(RangeError);
    expect(() => computeStreaks([], "2026-02-30")).toThrow(RangeError);
  });
});
