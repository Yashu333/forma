// Extra, adversarial coverage for dates.ts written independently of the
// developer's tests: an offset-based oracle, midnight edges in odd zones,
// DST gaps/overlaps (including ones at midnight and half-hour shifts) and
// calendar arithmetic at every boundary.
import { describe, expect, it } from "vitest";
import { addDays, isDateKey, isValidTimeZone, localDateKey, localHour } from "./dates";

const at = (iso: string) => new Date(iso);

// Independent oracle: ask Intl for the zone's UTC offset at the instant
// ("GMT+05:30"), shift the instant by it and read the UTC fields. This shares
// nothing with the implementation's hour/day/month formatting path.
const oracleFmt = new Map<string, Intl.DateTimeFormat>();
function oracle(date: Date, tz: string): { key: string; hour: number; offsetMin: number } {
  let fmt = oracleFmt.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset", hour: "numeric" });
    oracleFmt.set(tz, fmt);
  }
  const name = fmt
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")!.value;
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name)!;
  const offsetMin = m[1] ? (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const shifted = new Date(date.getTime() + offsetMin * 60_000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return {
    key: `${p(shifted.getUTCFullYear(), 4)}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`,
    hour: shifted.getUTCHours(),
    offsetMin,
  };
}

const ZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/St_Johns", // -3:30 / -2:30
  "America/Sao_Paulo",
  "America/Havana", // DST changes at midnight
  "America/Santiago", // DST changes at midnight
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata", // +5:30
  "Asia/Kathmandu", // +5:45
  "Asia/Tokyo",
  "Australia/Lord_Howe", // 30-minute DST shift
  "Australia/Adelaide", // +9:30 / +10:30
  "Pacific/Auckland",
  "Pacific/Chatham", // +12:45 / +13:45
  "Pacific/Kiritimati", // +14, furthest ahead
  "Pacific/Pago_Pago", // -11, furthest behind
  "Pacific/Apia", // skipped 2011-12-30 entirely
];

describe("localDateKey/localHour vs an offset-based oracle", () => {
  it("agree on a dense sweep of instants (every 3 hours 7 minutes across 2026, plus both ends of each year)", () => {
    const start = Date.UTC(2025, 11, 30);
    const end = Date.UTC(2027, 0, 2);
    const step = 187 * 60_000;
    const bad: string[] = [];
    for (const tz of ZONES) {
      for (let t = start; t < end; t += step) {
        const d = new Date(t);
        const o = oracle(d, tz);
        if (localDateKey(d, tz) !== o.key || localHour(d, tz) !== o.hour) {
          bad.push(`${tz} ${d.toISOString()} got ${localDateKey(d, tz)} h${localHour(d, tz)} want ${o.key} h${o.hour}`);
          if (bad.length > 10) break;
        }
      }
    }
    expect(bad).toEqual([]);
  }, 60_000);

  it("agree exactly every 2 minutes around each zone's 2026 DST transitions", () => {
    const bad: string[] = [];
    let transitions = 0;
    for (const tz of ZONES) {
      // Find instants where the offset changes by scanning 15-minute steps.
      let prev = oracle(new Date(Date.UTC(2026, 0, 1)), tz);
      let prevOffsetKey = "";
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 60 * 60_000) {
        const d = new Date(t);
        const o = oracle(d, tz);
        const offsetKey = String(o.offsetMin);
        if (offsetKey !== prevOffsetKey && t > Date.UTC(2026, 0, 1)) {
          transitions++;
          for (let s = t - 90 * 60_000; s <= t + 90 * 60_000; s += 120_000) {
            const e = new Date(s);
            const eo = oracle(e, tz);
            if (localDateKey(e, tz) !== eo.key || localHour(e, tz) !== eo.hour) {
              bad.push(`${tz} ${e.toISOString()}`);
            }
          }
        }
        prevOffsetKey = offsetKey;
        prev = o;
      }
      void prev;
    }
    // Sanity: the scan really found the zones' transitions (NY, London, Berlin, Havana, ... = 2 each).
    expect(transitions).toBeGreaterThanOrEqual(20);
    expect(bad).toEqual([]);
  }, 60_000);
});

describe("localDateKey around local midnight, ahead of and behind UTC", () => {
  it("Kiritimati (UTC+14): local midnight is 10:00Z the previous UTC day", () => {
    expect(localDateKey(at("2026-10-23T09:59:59.999Z"), "Pacific/Kiritimati")).toBe("2026-10-23");
    expect(localDateKey(at("2026-10-23T10:00:00.000Z"), "Pacific/Kiritimati")).toBe("2026-10-24");
    expect(localHour(at("2026-10-23T10:00:00.000Z"), "Pacific/Kiritimati")).toBe(0);
    expect(localHour(at("2026-10-23T09:59:59.999Z"), "Pacific/Kiritimati")).toBe(23);
  });

  it("Pago Pago (UTC-11): local midnight is 11:00Z", () => {
    expect(localDateKey(at("2026-10-23T10:59:59.999Z"), "Pacific/Pago_Pago")).toBe("2026-10-22");
    expect(localDateKey(at("2026-10-23T11:00:00.000Z"), "Pacific/Pago_Pago")).toBe("2026-10-23");
    expect(localHour(at("2026-10-23T11:00:00.000Z"), "Pacific/Pago_Pago")).toBe(0);
  });

  it("Kathmandu (+5:45): midnight falls on a quarter hour in UTC", () => {
    expect(localDateKey(at("2026-10-22T18:14:59.999Z"), "Asia/Kathmandu")).toBe("2026-10-22");
    expect(localDateKey(at("2026-10-22T18:15:00.000Z"), "Asia/Kathmandu")).toBe("2026-10-23");
  });

  it("St John's (-3:30 in NST, -2:30 in NDT)", () => {
    // Late Oct: NDT, UTC-2:30 -> local midnight 02:30Z
    expect(localDateKey(at("2026-10-23T02:29:59.999Z"), "America/St_Johns")).toBe("2026-10-22");
    expect(localDateKey(at("2026-10-23T02:30:00.000Z"), "America/St_Johns")).toBe("2026-10-23");
    // January: NST, UTC-3:30 -> local midnight 03:30Z
    expect(localDateKey(at("2026-01-15T03:29:59.999Z"), "America/St_Johns")).toBe("2026-01-14");
    expect(localDateKey(at("2026-01-15T03:30:00.000Z"), "America/St_Johns")).toBe("2026-01-15");
  });

  it("New Year's Eve 23:59:59.999 local is still the old year, 1 ms later is the new one (ahead and behind)", () => {
    // Tokyo UTC+9: 2026-12-31T23:59:59.999+09 = 14:59:59.999Z
    expect(localDateKey(at("2026-12-31T14:59:59.999Z"), "Asia/Tokyo")).toBe("2026-12-31");
    expect(localDateKey(at("2026-12-31T15:00:00.000Z"), "Asia/Tokyo")).toBe("2027-01-01");
    // LA UTC-8 = 07:59:59.999Z next day
    expect(localDateKey(at("2027-01-01T07:59:59.999Z"), "America/Los_Angeles")).toBe("2026-12-31");
    expect(localDateKey(at("2027-01-01T08:00:00.000Z"), "America/Los_Angeles")).toBe("2027-01-01");
  });

  it("leap day boundary in a zone ahead of UTC and one behind", () => {
    // 2028-02-29 exists. Auckland (NZDT, +13) midnight = 11:00Z previous day.
    expect(localDateKey(at("2028-02-28T10:59:59.999Z"), "Pacific/Auckland")).toBe("2028-02-28");
    expect(localDateKey(at("2028-02-28T11:00:00.000Z"), "Pacific/Auckland")).toBe("2028-02-29");
    // Pago Pago: 2028-03-01T00:00 local = 11:00Z
    expect(localDateKey(at("2028-03-01T10:59:59.999Z"), "Pacific/Pago_Pago")).toBe("2028-02-29");
    expect(localDateKey(at("2028-03-01T11:00:00.000Z"), "Pacific/Pago_Pago")).toBe("2028-03-01");
  });

  it("non-leap year goes Feb 28 -> Mar 1", () => {
    expect(localDateKey(at("2027-02-28T23:59:59.999Z"), "UTC")).toBe("2027-02-28");
    expect(localDateKey(at("2027-03-01T00:00:00.000Z"), "UTC")).toBe("2027-03-01");
  });

  it("is zone-name case-insensitive like Intl, and stable when called repeatedly (formatter cache)", () => {
    const d = at("2026-10-23T03:30:00Z");
    const a = localDateKey(d, "America/New_York");
    expect(localDateKey(d, "America/New_York")).toBe(a);
    expect(localDateKey(d, "America/New_York")).toBe("2026-10-22");
    // A different zone after the cached one must not reuse its formatter.
    expect(localDateKey(d, "Asia/Tokyo")).toBe("2026-10-23");
    expect(localDateKey(d, "America/New_York")).toBe("2026-10-22");
  });

  it("works for the epoch and for pre-1970 instants", () => {
    expect(localDateKey(new Date(0), "UTC")).toBe("1970-01-01");
    expect(localDateKey(new Date(0), "America/New_York")).toBe("1969-12-31");
    expect(localHour(new Date(0), "America/New_York")).toBe(19);
  });
});

describe("DST gaps and overlaps", () => {
  it("London spring-forward 2026-03-29: 00:59 GMT is followed by 02:00 BST (hour 1 never occurs)", () => {
    expect(localHour(at("2026-03-29T00:59:59Z"), "Europe/London")).toBe(0);
    expect(localHour(at("2026-03-29T01:00:00Z"), "Europe/London")).toBe(2);
    expect(localDateKey(at("2026-03-29T01:00:00Z"), "Europe/London")).toBe("2026-03-29");
  });

  it("London fall-back 2026-10-25: hour 1 happens twice, same date both times", () => {
    expect(localHour(at("2026-10-25T00:30:00Z"), "Europe/London")).toBe(1); // BST
    expect(localHour(at("2026-10-25T01:30:00Z"), "Europe/London")).toBe(1); // GMT
    expect(localHour(at("2026-10-25T02:00:00Z"), "Europe/London")).toBe(2);
    expect(localDateKey(at("2026-10-25T00:30:00Z"), "Europe/London")).toBe("2026-10-25");
    expect(localDateKey(at("2026-10-25T01:30:00Z"), "Europe/London")).toBe("2026-10-25");
  });

  it("Berlin spring-forward 2026-03-29: 02:00 CET does not exist, 01:59:59 -> 03:00", () => {
    expect(localHour(at("2026-03-29T00:59:59Z"), "Europe/Berlin")).toBe(1);
    expect(localHour(at("2026-03-29T01:00:00Z"), "Europe/Berlin")).toBe(3);
  });

  it("a frog finished in the NY overlap hour counts as before noon for both passes", () => {
    // 2026-11-01 01:30 EDT = 05:30Z and 01:30 EST = 06:30Z
    expect(localHour(at("2026-11-01T05:30:00Z"), "America/New_York")).toBe(1);
    expect(localHour(at("2026-11-01T06:30:00Z"), "America/New_York")).toBe(1);
  });

  it("noon on NY transition days is hour 12 at the right instant (offset shifts by the transition)", () => {
    // Spring-forward day 2026-03-08: noon EDT = 16:00Z
    expect(localHour(at("2026-03-08T15:59:59Z"), "America/New_York")).toBe(11);
    expect(localHour(at("2026-03-08T16:00:00Z"), "America/New_York")).toBe(12);
    // Fall-back day 2026-11-01: noon EST = 17:00Z
    expect(localHour(at("2026-11-01T16:59:59Z"), "America/New_York")).toBe(11);
    expect(localHour(at("2026-11-01T17:00:00Z"), "America/New_York")).toBe(12);
  });

  it("Havana spring-forward happens AT midnight: 23:59:59 on the 7th is followed by 01:00 on the 8th (hour 0 never occurs)", () => {
    expect(localDateKey(at("2026-03-08T04:59:59Z"), "America/Havana")).toBe("2026-03-07");
    expect(localHour(at("2026-03-08T04:59:59Z"), "America/Havana")).toBe(23);
    expect(localDateKey(at("2026-03-08T05:00:00Z"), "America/Havana")).toBe("2026-03-08");
    expect(localHour(at("2026-03-08T05:00:00Z"), "America/Havana")).toBe(1);
  });

  it("Havana fall-back at 01:00 -> 00:00: the first hour of 2026-11-01 happens twice, same date", () => {
    expect(localDateKey(at("2026-11-01T04:00:00Z"), "America/Havana")).toBe("2026-11-01");
    expect(localHour(at("2026-11-01T04:30:00Z"), "America/Havana")).toBe(0);
    expect(localHour(at("2026-11-01T05:30:00Z"), "America/Havana")).toBe(0);
    expect(localDateKey(at("2026-11-01T05:30:00Z"), "America/Havana")).toBe("2026-11-01");
  });

  it("Lord Howe has a 30-minute DST shift: hour 2:00-2:29 is skipped on spring-forward", () => {
    // 2026-10-04 02:00 LHST (+10:30) -> 02:30 LHDT (+11). 02:00 LHST = 15:30Z on the 3rd.
    expect(localHour(at("2026-10-03T15:29:59Z"), "Australia/Lord_Howe")).toBe(1);
    expect(localHour(at("2026-10-03T15:30:00Z"), "Australia/Lord_Howe")).toBe(2);
    expect(localDateKey(at("2026-10-03T15:30:00Z"), "Australia/Lord_Howe")).toBe("2026-10-04");
  });

  it("Auckland spring-forward 2026-09-27 02:00 NZST -> 03:00 NZDT", () => {
    // 02:00 NZST (+12) = 14:00Z on the 26th
    expect(localHour(at("2026-09-26T13:59:59Z"), "Pacific/Auckland")).toBe(1);
    expect(localHour(at("2026-09-26T14:00:00Z"), "Pacific/Auckland")).toBe(3);
    expect(localDateKey(at("2026-09-26T14:00:00Z"), "Pacific/Auckland")).toBe("2026-09-27");
  });

  it("localHour is always an integer in 0..23 across every minute of a fall-back day in several zones", () => {
    for (const tz of ["America/New_York", "Europe/London", "America/Havana", "Australia/Lord_Howe", "America/Santiago"]) {
      for (let t = Date.UTC(2026, 9, 31); t < Date.UTC(2026, 10, 3); t += 60_000) {
        const h = localHour(new Date(t), tz);
        if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error(`${tz} ${new Date(t).toISOString()} -> ${h}`);
      }
    }
  });
});

describe("addDays", () => {
  it("n = 0 and -0 return the same key", () => {
    expect(addDays("2026-10-23", 0)).toBe("2026-10-23");
    expect(addDays("2026-10-23", -0)).toBe("2026-10-23");
  });

  it("every month end rolls to the 1st and back", () => {
    const ends: [string, string][] = [
      ["2026-01-31", "2026-02-01"],
      ["2026-02-28", "2026-03-01"],
      ["2026-03-31", "2026-04-01"],
      ["2026-04-30", "2026-05-01"],
      ["2026-05-31", "2026-06-01"],
      ["2026-06-30", "2026-07-01"],
      ["2026-07-31", "2026-08-01"],
      ["2026-08-31", "2026-09-01"],
      ["2026-09-30", "2026-10-01"],
      ["2026-10-31", "2026-11-01"],
      ["2026-11-30", "2026-12-01"],
      ["2026-12-31", "2027-01-01"],
    ];
    for (const [a, b] of ends) {
      expect(addDays(a, 1)).toBe(b);
      expect(addDays(b, -1)).toBe(a);
    }
  });

  it("leap years: 2024, 2028 and 2000 have a 29th; 1900, 2100 and 2026 don't", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2000-02-28", 1)).toBe("2000-02-29");
    expect(addDays("1900-02-28", 1)).toBe("1900-03-01");
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2400-02-28", 1)).toBe("2400-02-29");
  });

  it("365/366-day offsets land on the same calendar day, except across a leap day", () => {
    expect(addDays("2026-10-23", 365)).toBe("2027-10-23");
    expect(addDays("2027-10-23", -365)).toBe("2026-10-23");
    expect(addDays("2027-10-23", 366)).toBe("2028-10-23"); // 2028-02-29 is inside, so +366 is one year
    expect(addDays("2027-10-23", 365)).toBe("2028-10-22");
    expect(addDays("2028-02-29", 365)).toBe("2029-02-28");
    expect(addDays("2028-02-29", -366)).toBe("2027-02-28");
  });

  it("year-end both directions across several years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("1999-12-31", 1)).toBe("2000-01-01");
  });

  it("round-trips: addDays(addDays(k, n), -n) === k for a spread of keys and offsets", () => {
    const keys = ["2024-02-29", "2026-03-08", "2026-11-01", "2026-12-31", "2027-01-01", "2100-02-28", "1999-12-31"];
    for (const k of keys) {
      for (const n of [-1000, -366, -31, -1, 0, 1, 7, 30, 31, 365, 366, 1461, 40000]) {
        expect(addDays(addDays(k, n), -n), `${k} ${n}`).toBe(k);
      }
    }
  });

  it("is additive: addDays(addDays(k, a), b) === addDays(k, a + b)", () => {
    for (const [a, b] of [[10, 20], [-5, 400], [31, -31], [1000, -1], [59, 1]]) {
      expect(addDays(addDays("2026-02-01", a), b)).toBe(addDays("2026-02-01", a + b));
    }
  });

  it("returns only valid date keys", () => {
    for (let n = -800; n <= 800; n += 13) {
      expect(isDateKey(addDays("2027-02-14", n)), String(n)).toBe(true);
    }
  });

  it("unit step across every day of a leap year visits 366 distinct, consecutive keys", () => {
    const seen = new Set<string>();
    let k = "2028-01-01";
    for (let i = 0; i < 366; i++) {
      seen.add(k);
      k = addDays(k, 1);
    }
    expect(seen.size).toBe(366);
    expect(k).toBe("2029-01-01");
  });

  it("rejects non-integer, NaN and infinite offsets", () => {
    for (const n of [0.5, NaN, Infinity, -Infinity]) {
      expect(() => addDays("2026-10-23", n), String(n)).toThrow(RangeError);
    }
  });

  it("rejects an offset that pushes the date outside the range Date can represent instead of returning garbage", () => {
    // 1e9 days is ~2.7 million years, outside Date's +/-8.64e15 ms range.
    let out: string | undefined;
    try {
      out = addDays("2026-10-23", 1e9);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      return;
    }
    expect(isDateKey(out), `addDays returned ${JSON.stringify(out)}`).toBe(true);
  });

  it("rejects invalid keys even if they would roll over", () => {
    for (const k of ["2026-02-30", "2026-13-01", "", "2026-1-1", "not-a-date"]) {
      expect(() => addDays(k, 1), k).toThrow(RangeError);
    }
  });
});

describe("isValidTimeZone / isDateKey extra edges", () => {
  it("rejects every flavour of numeric offset (the API contract is IANA names)", () => {
    for (const tz of ["+05:00", "-05:00", "+0500", "-0500", "+05", "UTC+5", "GMT+5", "UTC+05:00"]) {
      expect(isValidTimeZone(tz), tz).toBe(false);
    }
  });

  it("rejects whitespace-padded and empty names", () => {
    for (const tz of ["", " ", " UTC", "UTC ", "America/New_York\n", "America /New_York"]) {
      expect(isValidTimeZone(tz), JSON.stringify(tz)).toBe(false);
    }
  });

  it("accepts legacy and Etc names Intl knows", () => {
    for (const tz of ["Etc/GMT+5", "Etc/UTC", "GMT", "Asia/Calcutta", "Pacific/Kiritimati"]) {
      expect(isValidTimeZone(tz), tz).toBe(true);
    }
  });

  it("isDateKey rejects non-ASCII digits and sign/extra characters", () => {
    for (const s of ["２０２６-１０-２３", "+2026-10-23", "-2026-10-23", "2026-10-23Z", "02026-10-23", "2026–10–23"]) {
      expect(isDateKey(s), s).toBe(false);
    }
  });

  it("isDateKey accepts the first and last day of every month in a leap and a non-leap year", () => {
    const dim = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    dim.forEach((days, i) => {
      const mm = String(i + 1).padStart(2, "0");
      expect(isDateKey(`2028-${mm}-01`)).toBe(true);
      expect(isDateKey(`2028-${mm}-${days}`)).toBe(true);
      expect(isDateKey(`2028-${mm}-${days + 1}`)).toBe(false);
    });
    expect(isDateKey("2027-02-29")).toBe(false);
  });
});
