// Extra, adversarial coverage for computeStreaks, including a brute-force oracle.
import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { computeStreaks, type StreakDay } from "./streak";

const TODAY = "2026-10-23";
const e = (...dates: string[]): StreakDay[] => dates.map((date) => ({ date, eaten: true }));
const m = (...dates: string[]): StreakDay[] => dates.map((date) => ({ date, eaten: false }));

// Tiny deterministic PRNG so the property test is reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function bruteForce(days: StreakDay[], today: string) {
  const eaten = new Set(days.filter((d) => d.eaten && d.date <= today).map((d) => d.date));
  // current: walk back from today (or yesterday if today isn't eaten)
  let current = 0;
  let c = eaten.has(today) ? today : addDays(today, -1);
  while (eaten.has(c)) {
    current++;
    c = addDays(c, -1);
  }
  // longest: for each eaten date that starts a run (previous day not eaten), walk forward
  let longest = 0;
  for (const d of eaten) {
    if (eaten.has(addDays(d, -1))) continue;
    let n = 0;
    let x = d;
    while (eaten.has(x)) {
      n++;
      x = addDays(x, 1);
    }
    longest = Math.max(longest, n);
  }
  return { current, longest };
}

describe("computeStreaks (adversarial)", () => {
  it("matches a brute-force oracle on 500 random histories straddling a year boundary and a leap day", () => {
    const rand = rng(12345);
    for (const today of ["2026-10-23", "2027-01-02", "2028-03-02", "2026-03-09"]) {
      for (let iter = 0; iter < 125; iter++) {
        const days: StreakDay[] = [];
        const n = Math.floor(rand() * 40);
        for (let i = 0; i < n; i++) {
          days.push({ date: addDays(today, Math.floor(rand() * 70) - 62), eaten: rand() < 0.7 });
        }
        const copy = JSON.parse(JSON.stringify(days));
        expect(computeStreaks(days, today), `${today} ${JSON.stringify(days)}`).toEqual(bruteForce(days, today));
        expect(days).toEqual(copy);
      }
    }
  });

  it("input order is irrelevant: reversed and shuffled give the same answer", () => {
    const days = [...e("2026-10-20", "2026-10-21", "2026-10-22"), ...m("2026-10-19"), ...e("2026-10-10", "2026-10-11")];
    const base = computeStreaks(days, TODAY);
    expect(computeStreaks([...days].reverse(), TODAY)).toEqual(base);
    expect(computeStreaks([days[3], days[0], days[5], days[2], days[4], days[1]], TODAY)).toEqual(base);
    expect(base).toEqual({ current: 3, longest: 3 });
  });

  it("duplicate dates: eaten wins regardless of which duplicate comes first", () => {
    expect(computeStreaks([...e("2026-10-22"), ...m("2026-10-22")], TODAY)).toEqual({ current: 1, longest: 1 });
    expect(computeStreaks([...m("2026-10-22"), ...e("2026-10-22")], TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it("many duplicates of one day don't inflate the run length", () => {
    const dup = Array.from({ length: 50 }, () => ({ date: "2026-10-22", eaten: true }));
    expect(computeStreaks(dup, TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it("duplicate of an eaten today alongside an uneaten today still counts today", () => {
    expect(computeStreaks([...m(TODAY), ...e(TODAY), ...e("2026-10-22")], TODAY)).toEqual({ current: 2, longest: 2 });
  });

  it("future dates (tomorrow, next year) never extend current or longest", () => {
    const days = [...e("2026-10-22"), ...e("2026-10-24", "2026-10-25", "2026-10-26", "2027-10-23")];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it("only-future eaten days give 0/0", () => {
    expect(computeStreaks(e("2026-10-24", "2026-10-25"), TODAY)).toEqual({ current: 0, longest: 0 });
  });

  it("a future eaten day does not bridge a gap on today", () => {
    // yesterday eaten, today missing, tomorrow eaten: current counts back from yesterday = 1, not 3
    expect(computeStreaks(e("2026-10-22", "2026-10-24"), TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it("today eaten + yesterday uneaten = current 1 (today alone)", () => {
    expect(computeStreaks([...m("2026-10-22"), ...e(TODAY, "2026-10-21")], TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it("uneaten today with eaten yesterday AND a long older run: current is only the run ending yesterday", () => {
    const days = [...e("2026-10-22", "2026-10-21"), ...m(TODAY), ...e("2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13")];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 2, longest: 4 });
  });

  it("two equal-length runs: longest is that length, current is the later one if it reaches yesterday/today", () => {
    expect(computeStreaks(e("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-21", "2026-10-22", "2026-10-23"), TODAY)).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it("current can exceed an older longest candidate only via longest = max(all runs)", () => {
    const r = computeStreaks(e("2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20", "2026-10-01", "2026-10-02"), TODAY);
    expect(r.longest).toBeGreaterThanOrEqual(r.current);
    expect(r).toEqual({ current: 4, longest: 4 });
  });

  it("longest >= current for every random history", () => {
    const rand = rng(99);
    for (let i = 0; i < 300; i++) {
      const days: StreakDay[] = Array.from({ length: Math.floor(rand() * 30) }, () => ({
        date: addDays(TODAY, -Math.floor(rand() * 40)),
        eaten: rand() < 0.6,
      }));
      const r = computeStreaks(days, TODAY);
      expect(r.longest).toBeGreaterThanOrEqual(r.current);
      expect(r.current).toBeGreaterThanOrEqual(0);
    }
  });

  it("a one-day-old streak that ended the day before yesterday is 0 current (needs yesterday or today)", () => {
    expect(computeStreaks(e("2026-10-20", "2026-10-21"), TODAY)).toEqual({ current: 0, longest: 2 });
  });

  it("streak running through both DST transition dates in NY (keys, so no 23/25h days)", () => {
    const days = e("2026-03-07", "2026-03-08", "2026-03-09", "2026-10-31", "2026-11-01", "2026-11-02");
    expect(computeStreaks(days, "2026-03-09")).toEqual({ current: 3, longest: 3 });
    expect(computeStreaks(days, "2026-11-02")).toEqual({ current: 3, longest: 3 });
  });

  it("a streak crossing 2100-02-28 -> 2100-03-01 (no leap day in 2100)", () => {
    // 2100-02-29 doesn't exist, so 02-28 and 03-01 are consecutive days.
    expect(computeStreaks(e("2100-02-27", "2100-02-28", "2100-03-01"), "2100-03-01")).toEqual({ current: 3, longest: 3 });
    expect(computeStreaks(e("2100-02-27", "2100-02-28", "2100-03-01"), "2100-03-02")).toEqual({ current: 3, longest: 3 });
    // ...whereas in 2096 (leap) 02-28 -> 03-01 skips the 29th and is a gap.
    expect(computeStreaks(e("2096-02-27", "2096-02-28", "2096-03-01"), "2096-03-01")).toEqual({ current: 1, longest: 2 });
  });

  it("ignores date strings with a time part or other junk instead of mis-sorting them", () => {
    const days = [...e("2026-10-22"), { date: "2026-10-21T00:00:00Z", eaten: true }, { date: "", eaten: true }, { date: "garbage", eaten: true }];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 1, longest: 1 });
  });

  it("handles a 5,000-day unbroken streak quickly and exactly", () => {
    const days: StreakDay[] = [];
    for (let i = 0; i < 5000; i++) days.push({ date: addDays(TODAY, -i), eaten: true });
    const t0 = Date.now();
    expect(computeStreaks(days, TODAY)).toEqual({ current: 5000, longest: 5000 });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("rejects a non-date today in every flavour", () => {
    for (const t of ["", "2026-02-30", "2026-10-23T00:00:00Z", "today"]) {
      expect(() => computeStreaks([], t), t).toThrow(RangeError);
    }
  });
});
