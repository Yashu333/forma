// Date helpers for the Eat That Frog feature. "Today" is always the user's
// local calendar date, sent by the browser as a "YYYY-MM-DD" key plus an IANA
// time zone, so everything here works on keys and explicit zones and never
// reads the server's clock or time zone.

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Builds a UTC-midnight Date from y/m/d. Date.UTC would map years 0-99 to
// 1900-1999, so go through setUTCFullYear instead.
function utcDate(y: number, m: number, d: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function keyFromUtc(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** True for a real calendar date written as "YYYY-MM-DD" (so not "2026-02-30"). */
export function isDateKey(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_KEY_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // A day that doesn't exist rolls over into the next month, which the round
  // trip exposes.
  return keyFromUtc(utcDate(y, mo, d)) === s;
}

/**
 * True for a time zone name Intl understands ("America/New_York", "UTC", …).
 * Fixed-offset strings like "+05:00" are rejected: the API contract is IANA
 * names, and offsets can't follow DST.
 */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz === "" || /^[+-]/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Building an Intl.DateTimeFormat is slow and these run in loops over every
// plan, so keep one per zone.
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(date: Date, tz: string): Record<string, string> {
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
  let fmt = formatters.get(tz);
  if (!fmt) {
    // Throws RangeError for an unknown time zone, which we let propagate.
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    });
    formatters.set(tz, fmt);
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/**
 * The calendar date ("YYYY-MM-DD") that `date` falls on in time zone `tz`.
 * Throws RangeError for an invalid Date or time zone.
 */
export function localDateKey(date: Date, tz: string): string {
  const p = partsIn(date, tz);
  return `${pad(Number(p.year), 4)}-${p.month}-${p.day}`;
}

/**
 * The wall-clock hour (0-23) of `date` in time zone `tz`. On a DST fall-back
 * day the repeated hour is returned for both passes; on a spring-forward day
 * the skipped hour never appears. Throws RangeError like localDateKey.
 */
export function localHour(date: Date, tz: string): number {
  // Some engines report midnight as "24" even with h23, hence the modulo.
  return Number(partsIn(date, tz).hour) % 24;
}

/**
 * `key` shifted by `n` calendar days (negative goes back). Works on the date
 * key itself, in UTC, so DST can't make a day 23 or 25 hours long.
 * Throws RangeError for an invalid key, a non-integer `n`, or a result outside
 * 0000-01-01..9999-12-31 (the only years a "YYYY-MM-DD" key can hold).
 */
export function addDays(key: string, n: number): string {
  if (!isDateKey(key)) throw new RangeError(`Invalid date key: ${String(key)}`);
  if (!Number.isInteger(n)) throw new RangeError(`Day offset must be an integer: ${n}`);
  const m = DATE_KEY_RE.exec(key)!;
  const date = utcDate(Number(m[1]), Number(m[2]), Number(m[3]));
  date.setUTCDate(date.getUTCDate() + n);
  // A huge |n| overflows Date's range and leaves an Invalid Date; a smaller one
  // can still land in a year that doesn't fit four digits ("10000-01-01").
  const year = date.getUTCFullYear();
  if (Number.isNaN(date.getTime()) || year < 0 || year > 9999) {
    throw new RangeError(`Day offset out of range: ${key} + ${n}`);
  }
  return keyFromUtc(date);
}
