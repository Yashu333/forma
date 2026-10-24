import { describe, expect, it } from "vitest";
import { parseAbcde, parseAbcdeRank, parsePlannedFor } from "./validate";

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
