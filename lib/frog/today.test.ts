import { describe, expect, it } from "vitest";
import { completedOnLocalDate, MAX_PLAN_TASKS, parseTodayPut, utcWindowForLocalDate } from "./today";

const base = { date: "2026-10-24", tz: "Europe/Berlin", taskIds: ["a", "b"], frogTaskId: "a" };
const errorOf = (body: unknown) => {
  const r = parseTodayPut(body);
  if (r.ok) throw new Error("expected a failure");
  return r.error;
};

describe("parseTodayPut", () => {
  it("accepts a minimal body and fills defaults", () => {
    expect(parseTodayPut(base)).toEqual({ ok: true, value: { ...base, ranks: {}, finalize: false } });
  });

  it("accepts a null frog and an empty plan", () => {
    const r = parseTodayPut({ ...base, taskIds: [], frogTaskId: null });
    expect(r.ok).toBe(true);
  });

  it("accepts ranks, finalize, and treats a missing abcdeRank as null", () => {
    const r = parseTodayPut({
      ...base,
      finalize: true,
      ranks: { a: { abcde: "A", abcdeRank: 1 }, b: { abcde: "B" } },
    });
    expect(r).toEqual({
      ok: true,
      value: { ...base, finalize: true, ranks: { a: { abcde: "A", abcdeRank: 1 }, b: { abcde: "B", abcdeRank: null } } },
    });
  });

  it("a null letter with a null rank clears both", () => {
    const r = parseTodayPut({ ...base, ranks: { a: { abcde: null, abcdeRank: null } } });
    expect(r.ok && r.value.ranks.a).toEqual({ abcde: null, abcdeRank: null });
  });

  it.each([null, undefined, [], "x", 3])("rejects a non-object body %j", (b) => {
    expect(errorOf(b)).toMatch(/object/);
  });

  it.each([undefined, null, "2026-02-30", "26-10-24", 20261024])("rejects date %j", (date) => {
    expect(errorOf({ ...base, date })).toMatch(/date/);
  });

  it.each([undefined, "", "Mars/Olympus", "+05:00", 5])("rejects tz %j", (tz) => {
    expect(errorOf({ ...base, tz })).toMatch(/tz/);
  });

  it("rejects bad taskIds", () => {
    expect(errorOf({ ...base, taskIds: undefined })).toMatch(/array/);
    expect(errorOf({ ...base, taskIds: "a" })).toMatch(/array/);
    expect(errorOf({ ...base, taskIds: ["a", 1] })).toMatch(/strings/);
    expect(errorOf({ ...base, taskIds: ["a", ""] })).toMatch(/strings/);
    expect(errorOf({ ...base, taskIds: ["a", "a"] })).toMatch(/duplicates/);
  });

  it("caps taskIds", () => {
    const ids = Array.from({ length: MAX_PLAN_TASKS }, (_, i) => `t${i}`);
    expect(parseTodayPut({ ...base, taskIds: ids, frogTaskId: null }).ok).toBe(true);
    expect(errorOf({ ...base, taskIds: [...ids, "extra"], frogTaskId: null })).toMatch(/at most/);
  });

  it("requires frogTaskId to be null or in taskIds", () => {
    expect(errorOf({ ...base, frogTaskId: "zzz" })).toMatch(/frogTaskId/);
    expect(errorOf({ ...base, frogTaskId: 5 })).toMatch(/frogTaskId/);
    expect(errorOf({ date: base.date, tz: base.tz, taskIds: base.taskIds })).toMatch(/frogTaskId/);
  });

  it("validates ranks", () => {
    expect(errorOf({ ...base, ranks: [] })).toMatch(/ranks/);
    expect(errorOf({ ...base, ranks: { zzz: { abcde: "A", abcdeRank: 1 } } })).toMatch(/not in taskIds/);
    expect(errorOf({ ...base, ranks: { a: null } })).toMatch(/object/);
    expect(errorOf({ ...base, ranks: { a: {} } })).toMatch(/abcde must/);
    expect(errorOf({ ...base, ranks: { a: { abcde: "Z", abcdeRank: null } } })).toMatch(/abcde must/);
    expect(errorOf({ ...base, ranks: { a: { abcde: "A", abcdeRank: 0 } } })).toMatch(/abcdeRank/);
    expect(errorOf({ ...base, ranks: { a: { abcde: "A", abcdeRank: 1.5 } } })).toMatch(/abcdeRank/);
    expect(errorOf({ ...base, ranks: { a: { abcde: null, abcdeRank: 2 } } })).toMatch(/requires/);
  });

  it("rejects a non-boolean finalize", () => {
    expect(errorOf({ ...base, finalize: "yes" })).toMatch(/finalize/);
    expect(errorOf({ ...base, finalize: null })).toMatch(/finalize/);
  });
});

describe("utcWindowForLocalDate", () => {
  it("covers the whole local day in the most extreme zones", () => {
    const w = utcWindowForLocalDate("2026-10-24")!;
    // Pacific/Kiritimati (UTC+14) starts the day at 10:00Z the day before.
    expect(w.gte.toISOString()).toBe("2026-10-23T10:00:00.000Z");
    // Etc/GMT+12 (UTC-12) ends the day at 12:00Z the day after.
    expect(w.lt.toISOString()).toBe("2026-10-25T12:00:00.000Z");
  });

  it("returns null for years Postgres can't be asked about sensibly", () => {
    expect(utcWindowForLocalDate("0000-06-01")).toBeNull();
    expect(utcWindowForLocalDate("9999-06-01")).toBeNull();
    expect(utcWindowForLocalDate("0001-06-01")).not.toBeNull();
  });

  it("throws for an invalid key", () => {
    expect(() => utcWindowForLocalDate("nope")).toThrow(RangeError);
  });
});

describe("completedOnLocalDate", () => {
  const items = [
    { id: "late", completedAt: new Date("2026-10-24T22:30:00Z") }, // 2026-10-25 00:30 Berlin
    { id: "late-evening", completedAt: new Date("2026-10-23T21:30:00Z") }, // 23:30 Berlin on the 23rd
    { id: "noon", completedAt: new Date("2026-10-24T10:00:00Z") },
    { id: "early", completedAt: "2026-10-23T22:30:00Z" }, // 00:30 Berlin on the 24th (string input)
    { id: "open", completedAt: null },
  ];

  it("filters by the local day, not the UTC day, oldest first", () => {
    expect(completedOnLocalDate(items, "2026-10-24", "Europe/Berlin").map((i) => i.id)).toEqual(["early", "noon"]);
    expect(completedOnLocalDate(items, "2026-10-23", "Europe/Berlin").map((i) => i.id)).toEqual(["late-evening"]);
  });

  it("23:30 local the evening before is the previous UTC day in a UTC+ zone but the same day in a UTC- zone", () => {
    const t = [{ completedAt: new Date("2026-10-24T03:30:00Z") }]; // 23:30 on the 23rd in New York (EDT)
    expect(completedOnLocalDate(t, "2026-10-23", "America/New_York")).toHaveLength(1);
    expect(completedOnLocalDate(t, "2026-10-24", "America/New_York")).toHaveLength(0);
    expect(completedOnLocalDate(t, "2026-10-24", "UTC")).toHaveLength(1);
  });

  it("returns an empty list for no input", () => {
    expect(completedOnLocalDate([], "2026-10-24", "UTC")).toEqual([]);
  });
});
