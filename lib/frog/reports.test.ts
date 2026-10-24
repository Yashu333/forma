import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import {
  MAX_REFLECTIONS,
  MAX_STRIP_DAYS,
  bucketAbcde,
  buildDailyStrip,
  buildReflections,
  earliestPlanDate,
  emptyAbcdeCounts,
  parseFrogReportQuery,
  rangeStart,
  type ReflectionPlanInput,
} from "./reports";

const NY = "America/New_York";
const TODAY = "2026-10-23";

const q = (o: Record<string, string | undefined>) => ({ get: (k: string) => o[k] ?? null });
const okQuery = { tz: NY, today: TODAY };

describe("parseFrogReportQuery", () => {
  it("accepts tz + today and defaults days to 30", () => {
    expect(parseFrogReportQuery(q(okQuery))).toEqual({ ok: true, value: { tz: NY, today: TODAY, days: 30 } });
  });

  it("accepts 'all' and numeric days, clamped to 7..365", () => {
    const days = (d: string) => {
      const r = parseFrogReportQuery(q({ ...okQuery, days: d }));
      return r.ok ? r.value.days : r.error;
    };
    expect(days("all")).toBe("all");
    expect(days("90")).toBe(90);
    expect(days("7")).toBe(7);
    expect(days("3")).toBe(7);
    expect(days("0")).toBe(7);
    expect(days("365")).toBe(365);
    expect(days("9999")).toBe(365);
  });

  it.each(["abc", "", "1.5", "-3", "+30", "1e2", "30 ", "ALL", "\u0000", "1234567"])("rejects days=%j", (days) => {
    expect(parseFrogReportQuery(q({ ...okQuery, days })).ok).toBe(false);
  });

  it.each([undefined, "", "Mars/Base", "+05:00", "UTC\u0000"])("rejects tz=%j", (tz) => {
    const r = parseFrogReportQuery(q({ ...okQuery, tz }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tz/);
  });

  it.each([undefined, "", "2026-02-30", "2026-1-1", "2026-10-23\u0000", "0000-01-01", "9999-12-31", "0001-01-02", "9998-12-30"])(
    "rejects today=%j",
    (today) => {
      const r = parseFrogReportQuery(q({ ...okQuery, today }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/today/);
    },
  );

  it("accepts the edges of the supported range", () => {
    expect(parseFrogReportQuery(q({ ...okQuery, today: "0001-01-03" })).ok).toBe(true);
    expect(parseFrogReportQuery(q({ ...okQuery, today: "9998-12-29" })).ok).toBe(true);
  });
});

describe("rangeStart", () => {
  it("is days-1 before today for a numeric window", () => {
    expect(rangeStart(TODAY, 7)).toBe("2026-10-17");
    expect(rangeStart(TODAY, 30)).toBe("2026-09-24");
  });

  it("crosses a year boundary", () => {
    expect(rangeStart("2026-01-03", 7)).toBe("2025-12-28");
  });

  it("never goes before the supported minimum", () => {
    expect(rangeStart("0001-01-10", 365)).toBe("0001-01-03");
  });

  it("'all' starts at the earliest plan", () => {
    expect(rangeStart(TODAY, "all", "2026-09-01")).toBe("2026-09-01");
  });

  it("'all' shows at least 7 days, with no plans or a plan from today", () => {
    expect(rangeStart(TODAY, "all", null)).toBe("2026-10-17");
    expect(rangeStart(TODAY, "all", TODAY)).toBe("2026-10-17");
    expect(rangeStart(TODAY, "all", "2026-10-21")).toBe("2026-10-17");
  });

  it("'all' is capped at MAX_STRIP_DAYS days", () => {
    const start = rangeStart(TODAY, "all", "2020-01-01");
    expect(start).toBe("2025-09-19");
    const n = (Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
    expect(n).toBe(MAX_STRIP_DAYS);
  });

  it("'all' ignores an earliest plan in the future or an invalid one", () => {
    expect(rangeStart(TODAY, "all", "2026-12-01")).toBe("2026-10-17");
    expect(rangeStart(TODAY, "all", "garbage")).toBe("2026-10-17");
  });
});

describe("earliestPlanDate", () => {
  it("returns the smallest date on or before today", () => {
    expect(earliestPlanDate([{ date: "2026-10-05" }, { date: "2026-09-30" }, { date: "2026-10-23" }], TODAY)).toBe("2026-09-30");
  });
  it("ignores future and invalid dates; null for none", () => {
    expect(earliestPlanDate([{ date: "2026-10-24" }, { date: "nope" }], TODAY)).toBeNull();
    expect(earliestPlanDate([], TODAY)).toBeNull();
  });
});

describe("buildDailyStrip", () => {
  const eaten = (date: string, iso: string) => ({ date, frogTask: { completedAt: iso } });
  const open = (date: string) => ({ date, frogTask: { completedAt: null } });

  it("has one entry per day, oldest first, ending today", () => {
    const strip = buildDailyStrip([], NY, "2026-10-17", TODAY);
    expect(strip).toHaveLength(7);
    expect(strip[0].date).toBe("2026-10-17");
    expect(strip[6].date).toBe(TODAY);
    expect(strip.every((d) => !d.planned && !d.eaten && !d.beforeNoon)).toBe(true);
  });

  it("marks eaten, planned-but-uneaten and empty days", () => {
    const strip = buildDailyStrip(
      [eaten("2026-10-21", "2026-10-21T13:00:00Z"), open("2026-10-22"), { date: "2026-10-20", frogTask: null }],
      NY,
      "2026-10-20",
      TODAY,
    );
    expect(strip).toEqual([
      { date: "2026-10-20", planned: false, eaten: false, beforeNoon: false }, // plan without a frog
      { date: "2026-10-21", planned: true, eaten: true, beforeNoon: true }, // 09:00 EDT
      { date: "2026-10-22", planned: true, eaten: false, beforeNoon: false },
      { date: "2026-10-23", planned: false, eaten: false, beforeNoon: false },
    ]);
  });

  it("treats a frog eaten the next local day as not eaten", () => {
    const strip = buildDailyStrip([eaten("2026-10-21", "2026-10-22T15:00:00Z")], NY, "2026-10-21", "2026-10-22");
    expect(strip[0]).toMatchObject({ planned: true, eaten: false });
  });

  it("drops plans outside start..today (tomorrow's preselected frog included)", () => {
    const strip = buildDailyStrip([open("2026-10-24"), open("2026-10-10")], NY, "2026-10-21", TODAY);
    expect(strip.map((d) => d.planned)).toEqual([false, false, false]);
  });

  it("is empty when start is after today", () => {
    expect(buildDailyStrip([], NY, "2026-10-24", TODAY)).toEqual([]);
  });

  it("emits one day when start is today", () => {
    expect(buildDailyStrip([open(TODAY)], NY, TODAY, TODAY)).toEqual([{ date: TODAY, planned: true, eaten: false, beforeNoon: false }]);
  });

  it("steps over DST changes without skipping or repeating a date", () => {
    const strip = buildDailyStrip([], NY, "2026-10-30", "2026-11-04"); // fall back on 2026-11-01
    expect(strip.map((d) => d.date)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    const spring = buildDailyStrip([], NY, "2026-03-07", "2026-03-10");
    expect(spring.map((d) => d.date)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
  });

  it("a duplicate date keeps the eaten entry", () => {
    const strip = buildDailyStrip([open("2026-10-22"), eaten("2026-10-22", "2026-10-22T14:00:00Z")], NY, "2026-10-22", "2026-10-22");
    expect(strip[0].eaten).toBe(true);
  });
});

describe("bucketAbcde", () => {
  const t = (abcde: "A" | "B" | "C" | "D" | "E" | null, completedAt: string | null) => ({ abcde, completedAt });

  it("starts from all zeros", () => {
    expect(bucketAbcde([], NY, "2026-10-01", TODAY)).toEqual(emptyAbcdeCounts());
    expect(emptyAbcdeCounts()).toEqual({ A: 0, B: 0, C: 0, D: 0, E: 0, none: 0 });
  });

  it("counts per letter and 'none' for null", () => {
    const counts = bucketAbcde(
      [t("A", "2026-10-22T15:00:00Z"), t("A", "2026-10-22T16:00:00Z"), t("B", "2026-10-21T15:00:00Z"), t(null, "2026-10-21T15:00:00Z"), t("E", "2026-10-20T15:00:00Z")],
      NY, "2026-10-01", TODAY,
    );
    expect(counts).toEqual({ A: 2, B: 1, C: 0, D: 0, E: 1, none: 1 });
  });

  it("skips tasks that were never completed", () => {
    expect(bucketAbcde([t("A", null)], NY, "2026-10-01", TODAY).A).toBe(0);
  });

  it("uses the LOCAL day for the window edges", () => {
    // 2026-10-22T02:30Z is 22:30 EDT on the 21st: before a window starting the 22nd.
    expect(bucketAbcde([t("A", "2026-10-22T02:30:00Z")], NY, "2026-10-22", TODAY).A).toBe(0);
    expect(bucketAbcde([t("A", "2026-10-22T02:30:00Z")], NY, "2026-10-21", TODAY).A).toBe(1);
    // 2026-10-24T02:30Z is 22:30 EDT on the 23rd = today, so it counts although it is UTC-tomorrow.
    expect(bucketAbcde([t("B", "2026-10-24T02:30:00Z")], NY, "2026-10-01", TODAY).B).toBe(1);
    // 2026-10-24T05:00Z is already the 24th in New York: after today.
    expect(bucketAbcde([t("B", "2026-10-24T05:00:00Z")], NY, "2026-10-01", TODAY).B).toBe(0);
  });

  it("a null start means all time", () => {
    expect(bucketAbcde([t("C", "2001-01-01T12:00:00Z")], NY, null, TODAY).C).toBe(1);
  });

  it("accepts Date objects and ignores unparseable dates and unknown letters", () => {
    const counts = bucketAbcde(
      [
        { abcde: "D", completedAt: new Date("2026-10-22T15:00:00Z") },
        { abcde: "A", completedAt: "not a date" },
        { abcde: "Z" as never, completedAt: "2026-10-22T15:00:00Z" },
      ],
      NY, null, TODAY,
    );
    expect(counts).toEqual({ A: 0, B: 0, C: 0, D: 1, E: 0, none: 1 });
  });
});

describe("buildReflections", () => {
  const r = (date: string, o: Partial<ReflectionPlanInput> = {}): ReflectionPlanInput => ({
    date,
    reviewedAt: "2026-10-22T20:00:00Z",
    rating: 4,
    wentWell: null,
    improve: null,
    frogTask: { completedAt: null, title: "Write report" },
    ...o,
  });

  it("returns reviewed days newest first with the frog title and eaten flag", () => {
    const out = buildReflections(
      [
        r("2026-10-20", { wentWell: "Focus" }),
        r("2026-10-22", { improve: "Sleep", frogTask: { completedAt: "2026-10-22T13:00:00Z", title: "Ship it" } }),
        r("2026-10-21", { rating: null, wentWell: "ok" }),
      ],
      NY, TODAY,
    );
    expect(out.map((x) => x.date)).toEqual(["2026-10-22", "2026-10-21", "2026-10-20"]);
    expect(out[0]).toEqual({ date: "2026-10-22", rating: 4, wentWell: null, improve: "Sleep", frogTitle: "Ship it", eaten: true });
    expect(out[2]).toMatchObject({ frogTitle: "Write report", eaten: false, wentWell: "Focus" });
  });

  it("skips days that were never reviewed or hold no reflection", () => {
    const out = buildReflections(
      [
        r("2026-10-22", { reviewedAt: null }),
        r("2026-10-21", { rating: null, wentWell: null, improve: null }),
        r("2026-10-20", { rating: null, wentWell: "   ", improve: "" }),
        r("2026-10-19", { rating: 3 }),
      ],
      NY, TODAY,
    );
    expect(out.map((x) => x.date)).toEqual(["2026-10-19"]);
  });

  it("a rating alone is enough; texts are normalised to null when blank", () => {
    expect(buildReflections([r("2026-10-22", { rating: 5, wentWell: " " })], NY, TODAY)[0]).toMatchObject({ rating: 5, wentWell: null });
  });

  it("has null title and eaten=false without a frog (e.g. an excluded project)", () => {
    expect(buildReflections([r("2026-10-22", { frogTask: null })], NY, TODAY)[0]).toMatchObject({ frogTitle: null, eaten: false });
  });

  it("ignores days after today", () => {
    expect(buildReflections([r("2026-10-24")], NY, TODAY)).toEqual([]);
  });

  it("is capped at 30 by default and honours a custom limit", () => {
    const plans = Array.from({ length: 40 }, (_, i) => r(addDays("2026-09-01", i), { rating: 3 }));
    expect(buildReflections(plans, NY, TODAY)).toHaveLength(MAX_REFLECTIONS);
    expect(buildReflections(plans, NY, TODAY, 5)).toHaveLength(5);
  });

  it("does not mutate its input order", () => {
    const plans = [r("2026-10-20"), r("2026-10-22")];
    buildReflections(plans, NY, TODAY);
    expect(plans.map((p) => p.date)).toEqual(["2026-10-20", "2026-10-22"]);
  });
});
