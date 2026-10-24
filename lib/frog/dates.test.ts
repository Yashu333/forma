import { describe, expect, it } from "vitest";
import { addDays, isDateKey, isValidTimeZone, localDateKey, localHour } from "./dates";

const NY = "America/New_York";
const AKL = "Pacific/Auckland";
const PAGO = "Pacific/Pago_Pago"; // UTC-11 all year, the far-west counterpart

const at = (iso: string) => new Date(iso);

describe("isDateKey", () => {
  it("accepts real dates, including leap days", () => {
    expect(isDateKey("2026-10-23")).toBe(true);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2000-02-29")).toBe(true);
    expect(isDateKey("2026-12-31")).toBe(true);
    expect(isDateKey("2026-01-01")).toBe(true);
  });

  it("rejects dates that don't exist", () => {
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2100-02-29")).toBe(false);
    expect(isDateKey("2026-04-31")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-00-10")).toBe(false);
    expect(isDateKey("2026-10-00")).toBe(false);
    expect(isDateKey("2026-10-32")).toBe(false);
  });

  it("rejects malformed strings", () => {
    for (const s of ["", "2026-1-1", "20261023", "2026/10/23", " 2026-10-23", "2026-10-23 ", "2026-10-23\n", "2026-10-23T00:00:00Z", "abcd-ef-gh"]) {
      expect(isDateKey(s), JSON.stringify(s)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    for (const v of [null, undefined, 20261023, new Date(), {}, []]) {
      expect(isDateKey(v)).toBe(false);
    }
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names", () => {
    expect(isValidTimeZone(NY)).toBe(true);
    expect(isValidTimeZone(AKL)).toBe(true);
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects unknown names and garbage", () => {
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("America/Nowhere")).toBe(false);
    expect(isValidTimeZone("not a zone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("rejects fixed offsets", () => {
    expect(isValidTimeZone("+05:00")).toBe(false);
    expect(isValidTimeZone("-0800")).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const v of [null, undefined, 5, {}, []]) {
      expect(isValidTimeZone(v)).toBe(false);
    }
  });
});

describe("localDateKey", () => {
  it("is the same date as UTC in UTC", () => {
    expect(localDateKey(at("2026-10-23T23:59:59Z"), "UTC")).toBe("2026-10-23");
    expect(localDateKey(at("2026-10-24T00:00:00Z"), "UTC")).toBe("2026-10-24");
  });

  it("puts 23:30 New York time on the previous UTC day", () => {
    // 23:30 EDT on Oct 23 is 03:30Z on Oct 24.
    expect(localDateKey(at("2026-10-24T03:30:00Z"), NY)).toBe("2026-10-23");
  });

  it("switches at local midnight around NY spring-forward (2026-03-08)", () => {
    expect(localDateKey(at("2026-03-08T04:59:59Z"), NY)).toBe("2026-03-07"); // 23:59:59 EST
    expect(localDateKey(at("2026-03-08T05:00:00Z"), NY)).toBe("2026-03-08"); // 00:00 EST
    expect(localDateKey(at("2026-03-09T03:59:59Z"), NY)).toBe("2026-03-08"); // 23:59:59 EDT
    expect(localDateKey(at("2026-03-09T04:00:00Z"), NY)).toBe("2026-03-09"); // 00:00 EDT
  });

  it("switches at local midnight around NY fall-back (2026-11-01)", () => {
    expect(localDateKey(at("2026-11-01T03:59:59Z"), NY)).toBe("2026-10-31"); // 23:59:59 EDT
    expect(localDateKey(at("2026-11-01T04:00:00Z"), NY)).toBe("2026-11-01"); // 00:00 EDT
    expect(localDateKey(at("2026-11-02T04:59:59Z"), NY)).toBe("2026-11-01"); // 23:59:59 EST
    expect(localDateKey(at("2026-11-02T05:00:00Z"), NY)).toBe("2026-11-02"); // 00:00 EST
  });

  it("gives the same date for both passes of the repeated fall-back hour", () => {
    expect(localDateKey(at("2026-11-01T05:30:00Z"), NY)).toBe("2026-11-01"); // 01:30 EDT
    expect(localDateKey(at("2026-11-01T06:30:00Z"), NY)).toBe("2026-11-01"); // 01:30 EST
  });

  it("runs ahead of UTC in Auckland (NZDT, UTC+13)", () => {
    expect(localDateKey(at("2026-01-01T10:59:59Z"), AKL)).toBe("2026-01-01");
    expect(localDateKey(at("2026-01-01T11:00:00Z"), AKL)).toBe("2026-01-02");
  });

  it("uses UTC+12 in Auckland winter", () => {
    expect(localDateKey(at("2026-07-01T11:59:59Z"), AKL)).toBe("2026-07-01");
    expect(localDateKey(at("2026-07-01T12:00:00Z"), AKL)).toBe("2026-07-02");
  });

  it("crosses the year boundary in zones on either side of UTC", () => {
    expect(localDateKey(at("2025-12-31T10:59:59Z"), AKL)).toBe("2025-12-31");
    expect(localDateKey(at("2025-12-31T11:00:00Z"), AKL)).toBe("2026-01-01");
    expect(localDateKey(at("2026-01-01T10:59:59Z"), PAGO)).toBe("2025-12-31"); // 23:59:59 on Dec 31
    expect(localDateKey(at("2026-01-01T11:00:00Z"), PAGO)).toBe("2026-01-01");
  });

  it("crosses a month boundary and the leap day", () => {
    expect(localDateKey(at("2026-09-30T10:59:59Z"), AKL)).toBe("2026-09-30"); // NZDT, UTC+13
    expect(localDateKey(at("2026-09-30T11:00:00Z"), AKL)).toBe("2026-10-01");
    expect(localDateKey(at("2028-02-29T12:00:00Z"), NY)).toBe("2028-02-29");
    expect(localDateKey(at("2028-03-01T04:59:59Z"), NY)).toBe("2028-02-29");
  });

  it("handles Auckland's own DST transitions", () => {
    // Spring forward 2026-09-27: 02:00 NZST -> 03:00 NZDT at 14:00Z on Sep 26.
    expect(localDateKey(at("2026-09-26T13:59:59Z"), AKL)).toBe("2026-09-27");
    expect(localDateKey(at("2026-09-26T14:00:00Z"), AKL)).toBe("2026-09-27");
    // Fall back 2026-04-05: 03:00 NZDT -> 02:00 NZST at 14:00Z on Apr 4.
    expect(localDateKey(at("2026-04-04T13:59:59Z"), AKL)).toBe("2026-04-05");
    expect(localDateKey(at("2026-04-04T14:00:00Z"), AKL)).toBe("2026-04-05");
  });

  it("zero-pads month and day", () => {
    expect(localDateKey(at("2026-02-03T12:00:00Z"), "UTC")).toBe("2026-02-03");
  });

  it("throws RangeError for an invalid time zone", () => {
    expect(() => localDateKey(at("2026-10-23T12:00:00Z"), "Nope/Zone")).toThrow(RangeError);
    expect(() => localDateKey(at("2026-10-23T12:00:00Z"), "")).toThrow(RangeError);
  });

  it("throws RangeError for an invalid Date", () => {
    expect(() => localDateKey(new Date("garbage"), NY)).toThrow(RangeError);
  });
});

describe("localHour", () => {
  it("returns the wall-clock hour", () => {
    expect(localHour(at("2026-07-01T13:45:00Z"), NY)).toBe(9); // EDT
    expect(localHour(at("2026-01-01T13:45:00Z"), NY)).toBe(8); // EST
    expect(localHour(at("2026-07-01T13:45:00Z"), "UTC")).toBe(13);
  });

  it("returns 0 at local midnight and 23 just before it", () => {
    expect(localHour(at("2026-07-01T04:00:00Z"), NY)).toBe(0);
    expect(localHour(at("2026-07-01T03:59:59Z"), NY)).toBe(23);
    expect(localHour(at("2026-07-01T00:00:00Z"), "UTC")).toBe(0);
  });

  it("is < 12 up to 11:59:59 and 12 at noon", () => {
    expect(localHour(at("2026-07-01T15:59:59Z"), NY)).toBe(11);
    expect(localHour(at("2026-07-01T16:00:00Z"), NY)).toBe(12);
  });

  it("skips the missing hour on NY spring-forward", () => {
    expect(localHour(at("2026-03-08T06:59:59Z"), NY)).toBe(1); // 01:59:59 EST
    expect(localHour(at("2026-03-08T07:00:00Z"), NY)).toBe(3); // 03:00 EDT, no 2 o'clock
  });

  it("repeats the hour on NY fall-back", () => {
    expect(localHour(at("2026-11-01T05:30:00Z"), NY)).toBe(1); // 01:30 EDT
    expect(localHour(at("2026-11-01T06:30:00Z"), NY)).toBe(1); // 01:30 EST
    expect(localHour(at("2026-11-01T07:30:00Z"), NY)).toBe(2);
  });

  it("works in zones far from UTC", () => {
    expect(localHour(at("2026-01-01T11:00:00Z"), AKL)).toBe(0); // midnight NZDT
    expect(localHour(at("2026-07-01T00:00:00Z"), AKL)).toBe(12); // NZST
    expect(localHour(at("2026-09-26T13:59:59Z"), AKL)).toBe(1);
    expect(localHour(at("2026-09-26T14:00:00Z"), AKL)).toBe(3);
    expect(localHour(at("2026-01-01T00:00:00Z"), PAGO)).toBe(13);
  });

  it("handles a half-hour offset zone", () => {
    expect(localHour(at("2026-07-01T18:29:59Z"), "Asia/Kolkata")).toBe(23);
    expect(localHour(at("2026-07-01T18:30:00Z"), "Asia/Kolkata")).toBe(0);
  });

  it("throws RangeError for an invalid time zone or Date", () => {
    expect(() => localHour(at("2026-10-23T12:00:00Z"), "Nope/Zone")).toThrow(RangeError);
    expect(() => localHour(new Date(NaN), NY)).toThrow(RangeError);
  });
});

describe("addDays", () => {
  it("adds and subtracts within a month", () => {
    expect(addDays("2026-10-23", 1)).toBe("2026-10-24");
    expect(addDays("2026-10-23", -1)).toBe("2026-10-22");
    expect(addDays("2026-10-23", 0)).toBe("2026-10-23");
    expect(addDays("2026-10-23", 8)).toBe("2026-10-31");
  });

  it("crosses month boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses the year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("handles leap years, including century rules", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01"); // not a leap year
    expect(addDays("2000-02-28", 1)).toBe("2000-02-29"); // leap year
  });

  it("is one calendar day across DST transitions", () => {
    // US: spring forward 2026-03-08, fall back 2026-11-01.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-03-09", -1)).toBe("2026-03-08");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    // NZ: spring forward 2026-09-27, fall back 2026-04-05.
    expect(addDays("2026-09-26", 1)).toBe("2026-09-27");
    expect(addDays("2026-09-27", 1)).toBe("2026-09-28");
    expect(addDays("2026-04-04", 1)).toBe("2026-04-05");
    expect(addDays("2026-04-05", 1)).toBe("2026-04-06");
  });

  it("steps across the whole spring-forward week one day at a time", () => {
    let key = "2026-03-05";
    const seen = [key];
    for (let i = 0; i < 6; i++) seen.push((key = addDays(key, 1)));
    expect(seen).toEqual(["2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11"]);
  });

  it("handles large offsets", () => {
    expect(addDays("2026-01-01", 365)).toBe("2027-01-01");
    expect(addDays("2028-01-01", 366)).toBe("2029-01-01");
    expect(addDays("2026-01-01", -365)).toBe("2025-01-01");
    expect(addDays("2026-10-23", 10000)).toBe("2054-03-10");
    expect(addDays(addDays("2026-10-23", 10000), -10000)).toBe("2026-10-23");
  });

  it("stays within years 0000-9999 and throws past either end", () => {
    expect(addDays("9999-12-30", 1)).toBe("9999-12-31");
    expect(addDays("0000-01-02", -1)).toBe("0000-01-01");
    expect(() => addDays("9999-12-31", 1)).toThrow(RangeError);
    expect(() => addDays("0000-01-01", -1)).toThrow(RangeError);
    expect(() => addDays("2026-10-23", 1e9)).toThrow(RangeError);
    expect(() => addDays("2026-10-23", -1e9)).toThrow(RangeError);
  });

  it("doesn't mangle years below 100", () => {
    expect(addDays("0099-12-31", 1)).toBe("0100-01-01");
    expect(addDays("0001-01-01", 1)).toBe("0001-01-02");
  });

  it("throws RangeError for an invalid key", () => {
    for (const k of ["", "2026-02-30", "2026-1-1", "nope"]) {
      expect(() => addDays(k, 1), JSON.stringify(k)).toThrow(RangeError);
    }
  });

  it("throws RangeError for a non-integer offset", () => {
    expect(() => addDays("2026-10-23", 1.5)).toThrow(RangeError);
    expect(() => addDays("2026-10-23", NaN)).toThrow(RangeError);
    expect(() => addDays("2026-10-23", Infinity)).toThrow(RangeError);
  });
});
