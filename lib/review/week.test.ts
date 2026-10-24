import { describe, expect, it } from "vitest";
import { defaultReviewWeek, isReviewNudgeDay, isWeekStart, weekDates, weekStartOf } from "./week";

// Week of 19 Oct 2026: Mon 19, Tue 20, Wed 21, Thu 22, Fri 23, Sat 24, Sun 25.
describe("weekStartOf", () => {
  it.each([
    ["2026-10-19", "2026-10-19"],
    ["2026-10-23", "2026-10-19"],
    ["2026-10-25", "2026-10-19"],
    ["2026-10-26", "2026-10-26"],
    ["2027-01-01", "2026-12-28"],
  ])("%s -> %s", (day, monday) => expect(weekStartOf(day)).toBe(monday));
});

describe("defaultReviewWeek", () => {
  it("Friday to Sunday review the week that is nearly over", () => {
    for (const d of ["2026-10-23", "2026-10-24", "2026-10-25"]) expect(defaultReviewWeek(d)).toBe("2026-10-19");
  });
  it("Monday to Thursday review the week that just ended", () => {
    expect(defaultReviewWeek("2026-10-26")).toBe("2026-10-19");
    for (const d of ["2026-10-20", "2026-10-21", "2026-10-22"]) expect(defaultReviewWeek(d)).toBe("2026-10-12");
  });
  it("works across a year boundary", () => {
    expect(defaultReviewWeek("2027-01-04")).toBe("2026-12-28");
  });
});

describe("isReviewNudgeDay", () => {
  it("is Friday to Monday", () => {
    expect(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map(isReviewNudgeDay))
      .toEqual([true, false, false, false, true, true, true]);
  });
});

describe("isWeekStart and weekDates", () => {
  it("accepts only a real Monday", () => {
    expect(isWeekStart("2026-10-19")).toBe(true);
    expect(isWeekStart("2026-10-20")).toBe(false);
    expect(isWeekStart("2026-02-30")).toBe(false);
    expect(isWeekStart(20261019)).toBe(false);
    expect(isWeekStart(null)).toBe(false);
  });
  it("lists the seven days", () => {
    expect(weekDates("2026-10-19")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(weekDates("2026-12-28")[6]).toBe("2027-01-03");
  });
});
