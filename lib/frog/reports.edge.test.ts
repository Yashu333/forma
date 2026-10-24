// Edge cases for lib/frog/reports.ts beyond reports.test.ts: calendar ends, leap
// years, DST, duplicate plans, odd letters, whitespace-only reflections, the 30/31
// reflection cut, and the invariant that the strip and frogStats agree on the window.
import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { frogStats } from "./stats";
import {
  MAX_REFLECTIONS,
  MAX_STRIP_DAYS,
  MIN_STRIP_DAYS,
  bucketAbcde,
  buildDailyStrip,
  buildReflections,
  earliestPlanDate,
  parseFrogReportQuery,
  rangeStart,
  type ReflectionPlanInput,
} from "./reports";

const NY = "America/New_York";
const q = (o: Record<string, string | undefined>) => ({ get: (k: string) => o[k] ?? null });
const span = (start: string, today: string) => (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
const eatenPlan = (date: string, hourUtc = 13) => ({ date, frogTask: { completedAt: `${date}T${String(hourUtc).padStart(2, "0")}:00:00Z` } });
const openPlan = (date: string) => ({ date, frogTask: { completedAt: null } });

describe("parseFrogReportQuery: more shapes", () => {
  it("accepts any casing the platform knows for tz and keeps the caller's spelling", () => {
    const r = parseFrogReportQuery(q({ tz: "america/new_york", today: "2026-10-24" }));
    expect(r).toEqual({ ok: true, value: { tz: "america/new_york", today: "2026-10-24", days: 30 } });
  });

  it.each([
    ["000007", 7],
    ["00000", 7],
    ["000365", 365],
    ["366", 365],
    ["999999", 365],
    ["10", 10],
  ])("days=%s → %i", (raw, expected) => {
    const r = parseFrogReportQuery(q({ tz: "UTC", today: "2026-10-24", days: raw }));
    expect(r).toEqual({ ok: true, value: { tz: "UTC", today: "2026-10-24", days: expected } });
  });

  it.each(["٣٠", "３０", "3_0", "0b11", "30.0", "30\n", "\t30", "--30", "all ", "All", "null", "undefined", "true"])("rejects days=%j", (days) => {
    expect(parseFrogReportQuery(q({ tz: "UTC", today: "2026-10-24", days })).ok).toBe(false);
  });

  it("the errors are messages that never echo the input", () => {
    for (const [k, v] of [["tz", "Mars/SECRET"], ["today", "SECRET-DATE"], ["days", "SECRET-DAYS"]] as const) {
      const r = parseFrogReportQuery(q({ tz: "UTC", today: "2026-10-24", [k]: v }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toContain("SECRET");
    }
  });

  it("tz is checked before today, today before days (first error wins)", () => {
    const r = parseFrogReportQuery(q({ tz: "nope", today: "nope", days: "nope" }));
    expect(!r.ok && r.error).toMatch(/tz/);
    const r2 = parseFrogReportQuery(q({ tz: "UTC", today: "nope", days: "nope" }));
    expect(!r2.ok && r2.error).toMatch(/today/);
  });

  it("accepts a plain object whose get returns undefined for missing keys as missing", () => {
    expect(parseFrogReportQuery({ get: () => null }).ok).toBe(false);
  });
});

describe("rangeStart: calendar edges", () => {
  it("month boundaries: 30 days from 2026-03-05 starts on 2026-02-04; 7 days from 2026-03-01 starts on 2026-02-23", () => {
    expect(rangeStart("2026-03-05", 30)).toBe("2026-02-04");
    expect(rangeStart("2026-03-01", 7)).toBe("2026-02-23");
    expect(rangeStart("2028-03-01", 7)).toBe("2028-02-24"); // leap year: 02-29 exists
    expect(rangeStart("2027-03-01", 7)).toBe("2027-02-23");
  });

  it("year boundaries and 365 days across leap and non-leap years", () => {
    expect(rangeStart("2027-01-01", 7)).toBe("2026-12-26");
    expect(rangeStart("2028-12-31", 365)).toBe("2028-01-02"); // 366-day year
    expect(rangeStart("2027-12-31", 365)).toBe("2027-01-01");
    expect(rangeStart("2028-02-29", 365)).toBe("2027-03-02");
    expect(rangeStart("2026-10-24", 365)).toBe("2025-10-25");
  });

  it("clamps at the calendar start: any window ending in the first days of year 1 starts on 0001-01-03", () => {
    expect(rangeStart("0001-01-03", 7)).toBe("0001-01-03");
    expect(rangeStart("0001-01-03", 365)).toBe("0001-01-03");
    expect(rangeStart("0001-01-04", "all", "0001-01-03")).toBe("0001-01-03");
    expect(rangeStart("0001-02-01", 365)).toBe("0001-01-03");
    expect(rangeStart("0001-01-03", "all", null)).toBe("0001-01-03");
  });

  it("works at the calendar end", () => {
    expect(rangeStart("9998-12-29", 7)).toBe("9998-12-23");
    expect(rangeStart("9998-12-29", "all", "9998-01-01")).toBe("9998-01-01");
  });

  it("'all': exactly 7 days back is 8 days; 6 days back is still 7", () => {
    expect(rangeStart("2026-10-24", "all", "2026-10-17")).toBe("2026-10-17");
    expect(span(rangeStart("2026-10-24", "all", "2026-10-17"), "2026-10-24")).toBe(8);
    expect(span(rangeStart("2026-10-24", "all", "2026-10-18"), "2026-10-24")).toBe(MIN_STRIP_DAYS);
  });

  it("'all' cap: 399 days back → 400 days, 400 back → still 400, 5000 back → 400", () => {
    for (const back of [399, 400, 401, 5000]) {
      const earliest = addDays("2026-10-24", -back);
      expect(span(rangeStart("2026-10-24", "all", earliest), "2026-10-24")).toBe(Math.min(back + 1, MAX_STRIP_DAYS));
    }
  });

  it("'all' across a leap day counts the real number of days", () => {
    // 2028-02-28 .. 2028-03-02 = 4 days (leap) → floor of 7
    expect(span(rangeStart("2028-03-02", "all", "2028-02-28"), "2028-03-02")).toBe(7);
    // 2028-01-01 .. 2028-12-31 = 366 days
    expect(rangeStart("2028-12-31", "all", "2028-01-01")).toBe("2028-01-01");
    expect(span("2028-01-01", "2028-12-31")).toBe(366);
  });

  it("'all' with an earliest plan at or after today, or an invalid one, falls back to 7 days", () => {
    expect(span(rangeStart("2026-10-24", "all", "2026-10-24"), "2026-10-24")).toBe(7);
    expect(span(rangeStart("2026-10-24", "all", "2026-10-25"), "2026-10-24")).toBe(7);
    expect(span(rangeStart("2026-10-24", "all", "2026-02-30"), "2026-10-24")).toBe(7);
    expect(span(rangeStart("2026-10-24", "all", ""), "2026-10-24")).toBe(7);
  });
});

describe("earliestPlanDate", () => {
  it("returns today itself when that is the only plan on or before today", () => {
    expect(earliestPlanDate([{ date: "2026-10-24" }], "2026-10-24")).toBe("2026-10-24");
  });
  it("copes with unsorted input, duplicates and calendar-start dates", () => {
    expect(earliestPlanDate([{ date: "2026-10-05" }, { date: "0001-01-03" }, { date: "0001-01-03" }, { date: "2026-10-05" }], "2026-10-24")).toBe("0001-01-03");
  });
  it("skips non-date strings and impossible dates", () => {
    expect(earliestPlanDate([{ date: "" }, { date: "2026-02-30" }, { date: "2026-1-1" }, { date: "2026-10-01" }], "2026-10-24")).toBe("2026-10-01");
  });
});

describe("buildDailyStrip: edges", () => {
  it("365 days over a leap year: unique consecutive dates, includes 02-29", () => {
    const strip = buildDailyStrip([], NY, "2027-12-31", "2028-12-30");
    expect(strip).toHaveLength(366);
    expect(new Set(strip.map((d) => d.date)).size).toBe(366);
    expect(strip.some((d) => d.date === "2028-02-29")).toBe(true);
    for (let i = 1; i < strip.length; i++) expect(strip[i].date).toBe(addDays(strip[i - 1].date, 1));
  });

  it("a 400-day strip is exactly 400 long and fast", () => {
    const today = "2026-10-24";
    const start = rangeStart(today, "all", "2020-01-01");
    const plans = Array.from({ length: 400 }, (_, k) => eatenPlan(addDays(today, -k)));
    const t0 = performance.now();
    const strip = buildDailyStrip(plans, NY, start, today);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(strip).toHaveLength(MAX_STRIP_DAYS);
    expect(strip.every((d) => d.planned && d.eaten)).toBe(true);
  });

  it("across every DST change of 2026 in New York and Auckland: one entry per date, none doubled, none skipped", () => {
    for (const tz of [NY, "Pacific/Auckland", "Europe/London", "Australia/Lord_Howe"]) {
      const strip = buildDailyStrip([], tz, "2026-01-01", "2026-12-31");
      expect(strip).toHaveLength(365);
      for (let i = 1; i < strip.length; i++) expect(strip[i].date).toBe(addDays(strip[i - 1].date, 1));
    }
  });

  it("a plan on the DST fall-back day is judged in local time (the repeated 01:30 hour is before noon both times)", () => {
    // 2026-11-01 in New York: 05:30Z = 01:30 EDT, 06:30Z = 01:30 EST.
    for (const at of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]) {
      const [d] = buildDailyStrip([{ date: "2026-11-01", frogTask: { completedAt: at } }], NY, "2026-11-01", "2026-11-01");
      expect(d).toEqual({ date: "2026-11-01", planned: true, eaten: true, beforeNoon: true });
    }
  });

  it("a plan on the spring-forward day: the skipped hour never appears, 07:30Z is 03:30 EDT", () => {
    const [d] = buildDailyStrip([{ date: "2026-03-08", frogTask: { completedAt: "2026-03-08T07:30:00Z" } }], NY, "2026-03-08", "2026-03-08");
    expect(d).toEqual({ date: "2026-03-08", planned: true, eaten: true, beforeNoon: true });
  });

  describe("duplicate dates (unique in the DB, but the function must stay deterministic)", () => {
    const none = { date: "2026-10-22", frogTask: null };
    it.each([
      ["eaten, open", [eatenPlan("2026-10-22"), openPlan("2026-10-22")], { planned: true, eaten: true }],
      ["open, eaten", [openPlan("2026-10-22"), eatenPlan("2026-10-22")], { planned: true, eaten: true }],
      ["no frog, open", [none, openPlan("2026-10-22")], { planned: true, eaten: false }],
      ["open, no frog", [openPlan("2026-10-22"), none], { planned: true, eaten: false }],
      ["no frog, eaten", [none, eatenPlan("2026-10-22")], { planned: true, eaten: true }],
      ["no frog, no frog", [none, none], { planned: false, eaten: false }],
    ])("%s", (_label, plans, expected) => {
      const [d] = buildDailyStrip(plans, NY, "2026-10-22", "2026-10-22");
      expect(d).toMatchObject(expected);
    });

    it("duplicates do not change the strip length", () => {
      const plans = [eatenPlan("2026-10-22"), eatenPlan("2026-10-22"), openPlan("2026-10-23")];
      expect(buildDailyStrip(plans, NY, "2026-10-20", "2026-10-24")).toHaveLength(5);
    });
  });

  it("ignores plans with an invalid date and does not mutate the input", () => {
    const plans = [openPlan("not-a-date"), openPlan("2026-02-30"), eatenPlan("2026-10-23")];
    const copy = JSON.stringify(plans);
    const strip = buildDailyStrip(plans, NY, "2026-10-22", "2026-10-24");
    expect(strip.filter((d) => d.planned).map((d) => d.date)).toEqual(["2026-10-23"]);
    expect(JSON.stringify(plans)).toBe(copy);
  });

  it("an unparseable completedAt is planned but not eaten", () => {
    const [d] = buildDailyStrip([{ date: "2026-10-22", frogTask: { completedAt: "garbage" } }], NY, "2026-10-22", "2026-10-22");
    expect(d).toEqual({ date: "2026-10-22", planned: true, eaten: false, beforeNoon: false });
  });

  it("works at the calendar start (0001-01-03) and end (9998-12-29)", () => {
    expect(buildDailyStrip([], "UTC", "0001-01-03", "0001-01-05").map((d) => d.date)).toEqual(["0001-01-03", "0001-01-04", "0001-01-05"]);
    expect(buildDailyStrip([], "UTC", "9998-12-27", "9998-12-29").map((d) => d.date)).toEqual(["9998-12-27", "9998-12-28", "9998-12-29"]);
  });
});

describe("the strip and frogStats agree on the window", () => {
  const today = "2028-03-05";
  // One eaten plan for each of the last 900 days.
  const plans = Array.from({ length: 900 }, (_, k) => eatenPlan(addDays(today, -k)));

  it.each([7, 8, 29, 30, 31, 89, 90, 91, 180, 364, 365])("days=%i: strip has that many days and planned count equals stats.plannedDays", (n) => {
    const start = rangeStart(today, n);
    const strip = buildDailyStrip(plans, NY, start, today);
    const stats = frogStats(plans, NY, today, n);
    expect(strip).toHaveLength(n);
    expect(strip.filter((d) => d.planned)).toHaveLength(stats.plannedDays);
    expect(strip.filter((d) => d.eaten)).toHaveLength(stats.eatenDays);
    expect(stats.plannedDays).toBe(n);
  });

  it("'all' with 900 days of history: the strip is capped at 400, the stats count everything", () => {
    const start = rangeStart(today, "all", earliestPlanDate(plans, today));
    const strip = buildDailyStrip(plans, NY, start, today);
    const stats = frogStats(plans, NY, today, "all");
    expect(strip).toHaveLength(MAX_STRIP_DAYS);
    expect(stats.plannedDays).toBe(900);
    expect(stats.current).toBe(900);
  });

  it("'all' with 120 days of history: strip length equals the number of planned days", () => {
    const some = plans.slice(0, 120);
    const start = rangeStart(today, "all", earliestPlanDate(some, today));
    const strip = buildDailyStrip(some, NY, start, today);
    expect(strip).toHaveLength(120);
    expect(strip.filter((d) => d.planned)).toHaveLength(frogStats(some, NY, today, "all").plannedDays);
  });
});

describe("bucketAbcde: odd input", () => {
  const T = "2026-10-22T15:00:00Z";
  it.each(["a", "b", "AB", "", " A", "A ", "Z", "none", "constructor", "__proto__", "toString", "hasOwnProperty", "0", "null"])("letter %j goes to 'none' and never corrupts the counts object", (letter) => {
    const counts = bucketAbcde([{ abcde: letter as never, completedAt: T }], NY, null, "2026-10-24");
    expect(counts).toEqual({ A: 0, B: 0, C: 0, D: 0, E: 0, none: 1 });
    expect(Object.keys(counts).sort()).toEqual(["A", "B", "C", "D", "E", "none"]);
  });

  it("undefined letter (field missing) is 'none'", () => {
    expect(bucketAbcde([{ completedAt: T }], NY, null, "2026-10-24").none).toBe(1);
  });

  it("completedAt: empty string, 'Invalid Date' and NaN-ish values are skipped", () => {
    const counts = bucketAbcde(
      [
        { abcde: "A", completedAt: "" },
        { abcde: "A", completedAt: "Invalid Date" },
        { abcde: "A", completedAt: new Date(NaN) },
        { abcde: "A", completedAt: undefined as never },
      ],
      NY, null, "2026-10-24",
    );
    expect(counts.A).toBe(0);
  });

  it("start after today counts nothing; start equal to today counts only today's tasks", () => {
    const tasks = [{ abcde: "A" as const, completedAt: "2026-10-24T14:00:00Z" }, { abcde: "B" as const, completedAt: "2026-10-23T14:00:00Z" }];
    expect(bucketAbcde(tasks, NY, "2026-10-25", "2026-10-24")).toEqual({ A: 0, B: 0, C: 0, D: 0, E: 0, none: 0 });
    expect(bucketAbcde(tasks, NY, "2026-10-24", "2026-10-24")).toEqual({ A: 1, B: 0, C: 0, D: 0, E: 0, none: 0 });
  });

  it("both bounds are inclusive local days in New York, Auckland, Kolkata and on DST days", () => {
    const edges: [string, string, string, string, string][] = [
      // tz, start, today, instant just in, instant just out
      [NY, "2026-10-20", "2026-10-22", "2026-10-23T03:59:00Z", "2026-10-23T04:00:00Z"], // 23:59 on the 22nd / 00:00 on the 23rd
      [NY, "2026-10-20", "2026-10-22", "2026-10-20T04:00:00Z", "2026-10-20T03:59:00Z"], // 00:00 on the 20th / 23:59 on the 19th
      ["Pacific/Auckland", "2026-10-20", "2026-10-22", "2026-10-22T10:59:00Z", "2026-10-22T11:00:00Z"],
      ["Pacific/Auckland", "2026-10-20", "2026-10-22", "2026-10-19T11:00:00Z", "2026-10-19T10:59:00Z"],
      ["Asia/Kolkata", "2026-10-20", "2026-10-22", "2026-10-22T18:29:00Z", "2026-10-22T18:30:00Z"],
      ["Asia/Kolkata", "2026-10-20", "2026-10-22", "2026-10-19T18:30:00Z", "2026-10-19T18:29:00Z"],
      [NY, "2026-11-01", "2026-11-01", "2026-11-02T04:59:00Z", "2026-11-02T05:00:00Z"], // the 25-hour fall-back day ends 05:00Z
      [NY, "2026-11-01", "2026-11-01", "2026-11-01T04:00:00Z", "2026-11-01T03:59:00Z"], // starts 04:00Z (EDT)
      [NY, "2026-03-08", "2026-03-08", "2026-03-09T03:59:00Z", "2026-03-09T04:00:00Z"], // the 23-hour spring day ends 04:00Z
    ];
    for (const [tz, start, today, inside, outside] of edges) {
      expect(bucketAbcde([{ abcde: "A", completedAt: inside }], tz, start, today).A, `${tz} in ${inside}`).toBe(1);
      expect(bucketAbcde([{ abcde: "A", completedAt: outside }], tz, start, today).A, `${tz} out ${outside}`).toBe(0);
    }
  });

  it("counts 2000 tasks quickly", () => {
    const tasks = Array.from({ length: 2000 }, (_, i) => ({ abcde: (["A", "B", "C", "D", "E", null] as const)[i % 6], completedAt: new Date(Date.UTC(2026, 9, 24, 12) - (i % 300) * 86_400_000) }));
    const t0 = performance.now();
    const counts = bucketAbcde(tasks, NY, null, "2026-10-24");
    expect(performance.now() - t0).toBeLessThan(500);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(2000);
  });

  it("does not mutate its input", () => {
    const tasks = [{ abcde: "A" as const, completedAt: T }];
    const copy = JSON.stringify(tasks);
    bucketAbcde(tasks, NY, null, "2026-10-24");
    expect(JSON.stringify(tasks)).toBe(copy);
  });
});

describe("buildReflections: edges", () => {
  const r = (date: string, o: Partial<ReflectionPlanInput> = {}): ReflectionPlanInput => ({
    date,
    reviewedAt: "2026-10-22T20:00:00Z",
    rating: null,
    wentWell: null,
    improve: null,
    frogTask: { completedAt: null, title: "Frog" },
    ...o,
  });
  const today = "2026-10-24";

  it.each([" ", "   ", "\n", "\t\n ", " ", " ", "\r\n\r\n"])("whitespace-only text %j (no rating) is not a reflection", (ws) => {
    expect(buildReflections([r("2026-10-22", { wentWell: ws }), r("2026-10-21", { improve: ws }), r("2026-10-20", { wentWell: ws, improve: ws })], NY, today)).toEqual([]);
  });

  it("whitespace-only text next to a real one becomes null; the real text is returned as written", () => {
    const [x] = buildReflections([r("2026-10-22", { wentWell: "  padded  ", improve: "\n\n" })], NY, today);
    expect(x.wentWell).toBe("  padded  ");
    expect(x.improve).toBeNull();
  });

  it("a rating alone is a reflection for every value 1..5", () => {
    const out = buildReflections([1, 2, 3, 4, 5].map((n) => r(`2026-10-1${n}`, { rating: n })), NY, today);
    expect(out.map((x) => x.rating)).toEqual([5, 4, 3, 2, 1]);
    for (const x of out) expect(x).toMatchObject({ wentWell: null, improve: null });
  });

  it("reviewedAt as a Date, an ISO string, and missing", () => {
    const out = buildReflections(
      [r("2026-10-22", { reviewedAt: new Date("2026-10-22T20:00:00Z"), rating: 3 }), r("2026-10-21", { reviewedAt: "2026-10-21T20:00:00Z", rating: 3 }), r("2026-10-20", { reviewedAt: undefined as never, rating: 3 })],
      NY, today,
    );
    expect(out.map((x) => x.date)).toEqual(["2026-10-22", "2026-10-21"]);
  });

  it("exactly 29, 30, 31 and 100 reflections → 29, 30, 30, 30, always the newest", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => r(addDays("2026-06-01", i), { rating: 3 }));
    for (const [n, want] of [[29, 29], [30, 30], [31, 30], [100, 30]] as const) {
      const out = buildReflections(make(n), NY, today);
      expect(out).toHaveLength(want);
      expect(out[0].date).toBe(addDays("2026-06-01", n - 1));
      expect(out[out.length - 1].date).toBe(addDays("2026-06-01", n - want));
    }
    expect(MAX_REFLECTIONS).toBe(30);
  });

  it("the limit applies after dropping unreviewed, empty and future plans", () => {
    const plans = [
      ...Array.from({ length: 5 }, (_, i) => r(addDays("2026-10-25", i), { rating: 5 })), // future
      ...Array.from({ length: 5 }, (_, i) => r(addDays("2026-10-19", i), { reviewedAt: null, rating: 5 })), // unreviewed
      ...Array.from({ length: 31 }, (_, i) => r(addDays("2026-09-01", i), { rating: 2 })), // 31 valid
    ];
    const out = buildReflections(plans, NY, today);
    expect(out).toHaveLength(30);
    expect(out[0].date).toBe("2026-10-01");
  });

  it("sorts by date, not by input order or by rating", () => {
    const out = buildReflections([r("2026-10-01", { rating: 5 }), r("2026-10-20", { rating: 1 }), r("2026-09-30", { rating: 3 })], NY, today);
    expect(out.map((x) => x.date)).toEqual(["2026-10-20", "2026-10-01", "2026-09-30"]);
  });

  it("a plan dated exactly today is included; tomorrow is not", () => {
    expect(buildReflections([r(today, { rating: 3 }), r("2026-10-25", { rating: 3 })], NY, today).map((x) => x.date)).toEqual([today]);
  });

  it("eaten follows the same local-day rule as the stats (done a day late = not eaten; done early = eaten)", () => {
    const out = buildReflections(
      [
        r("2026-10-22", { rating: 3, frogTask: { completedAt: "2026-10-23T04:30:00Z", title: "late" } }), // 00:30 on the 23rd in New York
        r("2026-10-21", { rating: 3, frogTask: { completedAt: "2026-10-22T03:30:00Z", title: "on time" } }), // 23:30 on the 21st
        r("2026-10-20", { rating: 3, frogTask: { completedAt: "2026-10-18T10:00:00Z", title: "early" } }),
        r("2026-10-19", { rating: 3, frogTask: { completedAt: "garbage", title: "bad" } }),
      ],
      NY, today,
    );
    expect(out.map((x) => [x.frogTitle, x.eaten])).toEqual([["late", false], ["on time", true], ["early", true], ["bad", false]]);
  });

  it("an empty frog title is kept as an empty string (not turned into null)", () => {
    expect(buildReflections([r("2026-10-22", { rating: 3, frogTask: { completedAt: null, title: "" } })], NY, today)[0].frogTitle).toBe("");
  });

  it("ignores plans with an invalid date key", () => {
    expect(buildReflections([r("2026-02-30", { rating: 3 }), r("garbage", { rating: 3 })], NY, today)).toEqual([]);
  });

  it("limit 0 returns nothing", () => {
    expect(buildReflections([r("2026-10-22", { rating: 3 })], NY, today, 0)).toEqual([]);
  });
});
