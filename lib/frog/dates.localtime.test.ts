import { describe, expect, it } from "vitest";
import { localDateKey, localDateTimeToInstant, localTimeOfDay } from "./dates";

describe("localDateTimeToInstant", () => {
  it("converts a wall time in a summer-time zone", () => {
    expect(localDateTimeToInstant("2026-10-24", "09:00", "America/New_York").toISOString()).toBe("2026-10-24T13:00:00.000Z");
  });

  it("converts a wall time after the clocks go back", () => {
    expect(localDateTimeToInstant("2026-11-01", "09:00", "America/New_York").toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("a time skipped by spring-forward lands an hour later", () => {
    // 02:30 on 2026-03-08 never happens in New York; 03:30 EDT is 07:30Z
    expect(localDateTimeToInstant("2026-03-08", "02:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("handles half-hour offsets and zones east of UTC", () => {
    expect(localDateTimeToInstant("2026-10-24", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-10-24T03:30:00.000Z");
    expect(localDateTimeToInstant("2026-10-24", "00:30", "Pacific/Auckland").toISOString()).toBe("2026-10-23T11:30:00.000Z");
  });

  it("UTC is the identity", () => {
    expect(localDateTimeToInstant("2026-10-24", "23:59", "UTC").toISOString()).toBe("2026-10-24T23:59:00.000Z");
  });

  it("round-trips through localDateKey and localTimeOfDay", () => {
    for (const tz of ["America/New_York", "Europe/Berlin", "Asia/Kolkata", "Pacific/Auckland", "UTC"]) {
      for (const [key, time] of [["2026-06-15", "07:45"], ["2026-12-31", "23:30"], ["2027-01-01", "00:00"]]) {
        const instant = localDateTimeToInstant(key, time, tz);
        expect(localDateKey(instant, tz)).toBe(key);
        expect(localTimeOfDay(instant, tz)).toBe(time);
      }
    }
  });

  it("midnight is 00:00, not 24:00", () => {
    expect(localTimeOfDay(new Date("2026-10-24T04:00:00Z"), "America/New_York")).toBe("00:00");
  });

  it("throws on a bad key, time or zone", () => {
    expect(() => localDateTimeToInstant("2026-02-30", "09:00", "UTC")).toThrow(RangeError);
    expect(() => localDateTimeToInstant("2026-10-24", "9:00", "UTC")).toThrow(RangeError);
    expect(() => localDateTimeToInstant("2026-10-24", "24:00", "UTC")).toThrow(RangeError);
    expect(() => localDateTimeToInstant("2026-10-24", "09:60", "UTC")).toThrow(RangeError);
    expect(() => localDateTimeToInstant("2026-10-24", "09:00", "Mars/Olympus")).toThrow(RangeError);
  });
});
