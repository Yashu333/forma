import { describe, expect, it } from "vitest";
import { isDateKey, isValidTimeZone } from "./dates";
import { hasNul, parseAbcde, parseAbcdeRank, parsePlannedFor } from "./validate";

describe("parseAbcde", () => {
  it.each(["A", "B", "C", "D", "E"])("accepts %s", (l) => {
    expect(parseAbcde(l)).toEqual({ ok: true, value: l });
  });
  it("accepts null", () => {
    expect(parseAbcde(null)).toEqual({ ok: true, value: null });
  });
  it.each(["a", "F", "", "AB", " A", 1, true, undefined, {}, ["A"]])("rejects %j", (v) => {
    expect(parseAbcde(v).ok).toBe(false);
  });
});

describe("parseAbcdeRank", () => {
  it.each([1, 2, 99, 2_147_483_647])("accepts %d", (n) => {
    expect(parseAbcdeRank(n)).toEqual({ ok: true, value: n });
  });
  it("accepts null", () => {
    expect(parseAbcdeRank(null)).toEqual({ ok: true, value: null });
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648, "1", true, undefined, {}])("rejects %j", (v) => {
    expect(parseAbcdeRank(v).ok).toBe(false);
  });
});

describe("parsePlannedFor", () => {
  it("accepts a real date key and null", () => {
    expect(parsePlannedFor("2026-10-24")).toEqual({ ok: true, value: "2026-10-24" });
    expect(parsePlannedFor("2028-02-29")).toEqual({ ok: true, value: "2028-02-29" });
    expect(parsePlannedFor(null)).toEqual({ ok: true, value: null });
  });
  it.each(["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-1", "26-10-24", "2026-10-24T00:00", "", 20261024, undefined])(
    "rejects %j",
    (v) => {
      expect(parsePlannedFor(v).ok).toBe(false);
    },
  );
});

describe("hasNul", () => {
  it.each(["\u0000", "a\u0000b", "abc\u0000", "\u0000abc", "a\u0000\u0000"])("finds a NUL in %j", (s) => {
    expect(hasNul(s)).toBe(true);
  });
  it.each(["", "abc", " ", "0", "\\u0000", "\u0001", "\u2400", "line\nbreak", "😀"])("passes %j", (s) => {
    expect(hasNul(s)).toBe(false);
  });
});

describe("strings with a NUL never pass the date and time zone checks", () => {
  // These two guard GET /api/today's query params, so a NUL there is a 400.
  it.each(["2026-10-24\u0000", "\u00002026-10-24", "2026-10\u0000-24"])("isDateKey rejects %j", (s) => {
    expect(isDateKey(s)).toBe(false);
  });
  it.each(["UTC\u0000", "\u0000UTC", "Europe/Ber\u0000lin"])("isValidTimeZone rejects %j", (s) => {
    expect(isValidTimeZone(s)).toBe(false);
  });
});
