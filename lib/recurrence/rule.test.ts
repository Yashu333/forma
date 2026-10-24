import { describe, expect, it } from "vitest";
import { formatRepeat, mondayOf, nextOccurrence, occurrencesBetween, parseRepeatRule, weekdayOf, type RepeatRule } from "./rule";

describe("parseRepeatRule", () => {
  it("accepts each frequency", () => {
    expect(parseRepeatRule({ freq: "day", interval: 2 })).toEqual({ freq: "day", interval: 2 });
    expect(parseRepeatRule({ freq: "year", interval: 1 })).toEqual({ freq: "year", interval: 1 });
    expect(parseRepeatRule({ freq: "month", interval: 1, day: "last" })).toEqual({ freq: "month", interval: 1, day: "last" });
    expect(parseRepeatRule({ freq: "month", interval: 1, day: 31 })).toEqual({ freq: "month", interval: 1, day: 31 });
  });

  it("sorts and de-duplicates weekdays", () => {
    expect(parseRepeatRule({ freq: "week", interval: 1, weekdays: [5, 1, 5, 3] })).toEqual({ freq: "week", interval: 1, weekdays: [1, 3, 5] });
  });

  it("drops unknown extra fields", () => {
    expect(parseRepeatRule({ freq: "day", interval: 1, evil: "<script>" })).toEqual({ freq: "day", interval: 1 });
  });

  it.each([
    ["null", null],
    ["a string", "daily"],
    ["an array", []],
    ["no freq", { interval: 1 }],
    ["unknown freq", { freq: "hour", interval: 1 }],
    ["interval 0", { freq: "day", interval: 0 }],
    ["interval 366", { freq: "day", interval: 366 }],
    ["fractional interval", { freq: "day", interval: 1.5 }],
    ["string interval", { freq: "day", interval: "1" }],
    ["no weekdays", { freq: "week", interval: 1, weekdays: [] }],
    ["weekday 7", { freq: "week", interval: 1, weekdays: [7] }],
    ["weekday -1", { freq: "week", interval: 1, weekdays: [-1] }],
    ["weekdays not a list", { freq: "week", interval: 1, weekdays: 1 }],
    ["month day 0", { freq: "month", interval: 1, day: 0 }],
    ["month day 32", { freq: "month", interval: 1, day: 32 }],
    ["month day text", { freq: "month", interval: 1, day: "first" }],
  ])("rejects %s", (_name, value) => {
    expect(parseRepeatRule(value)).toBeNull();
  });
});

describe("weekdayOf and mondayOf", () => {
  it("knows the weekday", () => {
    expect(weekdayOf("2026-10-24")).toBe(6);
    expect(weekdayOf("2026-10-25")).toBe(0);
    expect(weekdayOf("2026-10-26")).toBe(1);
  });
  it("finds the Monday of a Monday-to-Sunday week", () => {
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
    expect(mondayOf("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week before
    expect(mondayOf("2026-10-24")).toBe("2026-10-19");
    expect(mondayOf("2027-01-01")).toBe("2026-12-28");
  });
});

describe("nextOccurrence", () => {
  const day = (interval: number): RepeatRule => ({ freq: "day", interval });
  const week = (weekdays: number[], interval = 1): RepeatRule => ({ freq: "week", interval, weekdays });
  const month = (d: number | "last", interval = 1): RepeatRule => ({ freq: "month", interval, day: d });
  const year = (interval = 1): RepeatRule => ({ freq: "year", interval });

  describe("daily", () => {
    it("is the day after", () => expect(nextOccurrence(day(1), "2026-10-24", "2026-10-24")).toBe("2026-10-25"));
    it("finishing late gives the next one in the future, not an overdue copy", () => {
      expect(nextOccurrence(day(1), "2026-10-01", "2026-10-24")).toBe("2026-10-25");
    });
    it("every 3 days stays on its rhythm", () => {
      expect(nextOccurrence(day(3), "2026-10-01", "2026-10-24")).toBe("2026-10-25"); // 1, 4, ..., 22, 25
      expect(nextOccurrence(day(3), "2026-10-01", "2026-10-25")).toBe("2026-10-28");
    });
    it("a date after the anchor wins when the afterKey is earlier", () => {
      expect(nextOccurrence(day(2), "2026-10-24", "2026-01-01")).toBe("2026-10-24");
    });
    it("crosses a month and a year end", () => {
      expect(nextOccurrence(day(1), "2026-12-31", "2026-12-31")).toBe("2027-01-01");
    });
  });

  describe("weekly", () => {
    it("moves to the next chosen weekday", () => {
      expect(nextOccurrence(week([1, 3, 5]), "2026-10-23", "2026-10-23")).toBe("2026-10-26"); // Fri -> Mon
      expect(nextOccurrence(week([1, 3, 5]), "2026-10-26", "2026-10-26")).toBe("2026-10-28"); // Mon -> Wed
    });
    it("Sunday counts as the end of the week", () => {
      expect(nextOccurrence(week([0]), "2026-10-24", "2026-10-24")).toBe("2026-10-25");
      expect(nextOccurrence(week([0]), "2026-10-25", "2026-10-25")).toBe("2026-11-01");
    });
    it("every 2 weeks skips the off week", () => {
      expect(nextOccurrence(week([2], 2), "2026-10-20", "2026-10-20")).toBe("2026-11-03");
    });
    it("every 2 weeks with several days stays within the on week first", () => {
      // Tue and Thu, anchored on Tue 10-20: Thu the 22nd is in the same week
      expect(nextOccurrence(week([2, 4], 2), "2026-10-20", "2026-10-20")).toBe("2026-10-22");
      expect(nextOccurrence(week([2, 4], 2), "2026-10-20", "2026-10-22")).toBe("2026-11-03");
    });
    it("crosses the year boundary", () => {
      expect(nextOccurrence(week([1]), "2026-12-28", "2026-12-28")).toBe("2027-01-04");
    });
    it("finishing late jumps to the next future one", () => {
      expect(nextOccurrence(week([1]), "2026-09-07", "2026-10-24")).toBe("2026-10-26");
    });
  });

  describe("monthly", () => {
    it("clamps day 31 to the end of a short month, then recovers", () => {
      expect(nextOccurrence(month(31), "2026-01-31", "2026-01-31")).toBe("2026-02-28");
      expect(nextOccurrence(month(31), "2026-01-31", "2026-02-28")).toBe("2026-03-31");
    });
    it("clamps day 29 to the 28th in a common year and keeps it in a leap year", () => {
      expect(nextOccurrence(month(29), "2026-01-29", "2026-01-29")).toBe("2026-02-28");
      expect(nextOccurrence(month(29), "2028-01-29", "2028-01-29")).toBe("2028-02-29");
    });
    it("last day of the month", () => {
      expect(nextOccurrence(month("last"), "2026-02-28", "2026-02-28")).toBe("2026-03-31");
      expect(nextOccurrence(month("last"), "2028-01-31", "2028-01-31")).toBe("2028-02-29");
    });
    it("every 3 months", () => {
      expect(nextOccurrence(month(15, 3), "2026-01-15", "2026-01-15")).toBe("2026-04-15");
      expect(nextOccurrence(month(15, 3), "2026-01-15", "2026-10-24")).toBe("2027-01-15");
    });
    it("rolls into the next year", () => {
      expect(nextOccurrence(month(5), "2026-12-05", "2026-12-05")).toBe("2027-01-05");
    });
    it("never goes before the anchor", () => {
      expect(nextOccurrence(month(15), "2026-10-24", "2026-01-01")).toBe("2026-11-15");
    });
    it("a task finished mid-month moves on to next month's day", () => {
      expect(nextOccurrence(month(1), "2026-10-01", "2026-10-24")).toBe("2026-11-01");
    });
  });

  describe("yearly", () => {
    it("the same day next year", () => {
      expect(nextOccurrence(year(), "2026-10-24", "2026-10-24")).toBe("2027-10-24");
    });
    it("Feb 29 falls back to Feb 28 in common years and returns in leap years", () => {
      expect(nextOccurrence(year(), "2024-02-29", "2024-02-29")).toBe("2025-02-28");
      expect(nextOccurrence(year(), "2024-02-29", "2027-03-01")).toBe("2028-02-29");
    });
    it("every 2 years", () => {
      expect(nextOccurrence(year(2), "2026-05-01", "2026-05-01")).toBe("2028-05-01");
    });
  });

  it("throws on a bad date key", () => {
    expect(() => nextOccurrence(day(1), "2026-02-30", "2026-02-01")).toThrow(RangeError);
    expect(() => nextOccurrence(day(1), "2026-02-01", "nope")).toThrow(RangeError);
  });
});

describe("occurrencesBetween", () => {
  const rule: RepeatRule = { freq: "week", interval: 1, weekdays: [1, 3] };

  it("lists occurrences after the anchor inside the window", () => {
    expect(occurrencesBetween(rule, "2026-10-21", "2026-10-26", "2026-11-08")).toEqual(["2026-10-26", "2026-10-28", "2026-11-02", "2026-11-04"]);
  });
  it("never includes the anchor itself", () => {
    expect(occurrencesBetween({ freq: "day", interval: 1 }, "2026-10-24", "2026-10-24", "2026-10-26")).toEqual(["2026-10-25", "2026-10-26"]);
  });
  it("is empty when the window ends before the series continues", () => {
    expect(occurrencesBetween(rule, "2026-10-21", "2026-10-22", "2026-10-25")).toEqual([]);
  });
  it("starts mid-series for a window far from the anchor", () => {
    const out = occurrencesBetween({ freq: "day", interval: 7 }, "2026-01-01", "2026-10-24", "2026-11-07");
    expect(out).toEqual(["2026-10-29", "2026-11-05"]);
  });
  it("respects the limit", () => {
    expect(occurrencesBetween({ freq: "day", interval: 1 }, "2026-01-01", "2026-01-02", "2030-01-01", 5)).toHaveLength(5);
  });
});

describe("formatRepeat", () => {
  it.each([
    [{ freq: "day", interval: 1 }, "Every day"],
    [{ freq: "day", interval: 3 }, "Every 3 days"],
    [{ freq: "week", interval: 1, weekdays: [1, 2, 3, 4, 5] }, "Weekdays"],
    [{ freq: "week", interval: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] }, "Every day"],
    [{ freq: "week", interval: 1, weekdays: [1, 3, 5] }, "Every Mon, Wed, Fri"],
    [{ freq: "week", interval: 2, weekdays: [2] }, "Every 2 weeks on Tue"],
    [{ freq: "month", interval: 1, day: 1 }, "Every month on the 1st"],
    [{ freq: "month", interval: 1, day: 22 }, "Every month on the 22nd"],
    [{ freq: "month", interval: 1, day: 23 }, "Every month on the 23rd"],
    [{ freq: "month", interval: 1, day: 11 }, "Every month on the 11th"],
    [{ freq: "month", interval: 2, day: "last" }, "Every 2 months on the last day"],
    [{ freq: "year", interval: 1 }, "Every year"],
    [{ freq: "year", interval: 5 }, "Every 5 years"],
  ] as [RepeatRule, string][])("%j -> %s", (rule, label) => {
    expect(formatRepeat(rule)).toBe(label);
  });
});
