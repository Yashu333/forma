import { addDays, isDateKey } from "@/lib/frog/dates";

// Repeat rules for recurring tasks. Pure date-key maths: a rule is anchored on
// a task's due date key, and every function works on "YYYY-MM-DD" strings so DST
// and time zones can't shift a day.

export type RepeatRule =
  | { freq: "day"; interval: number }
  | { freq: "week"; interval: number; weekdays: number[] } // 0 = Sunday … 6 = Saturday
  | { freq: "month"; interval: number; day: number | "last" }
  | { freq: "year"; interval: number };

const MAX_INTERVAL = 365;

function isInterval(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_INTERVAL;
}

/** Strictly validates untrusted JSON; returns null when it isn't a rule. */
export function parseRepeatRule(v: unknown): RepeatRule | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!isInterval(o.interval)) return null;
  switch (o.freq) {
    case "day":
      return { freq: "day", interval: o.interval };
    case "year":
      return { freq: "year", interval: o.interval };
    case "week": {
      if (!Array.isArray(o.weekdays) || o.weekdays.length === 0 || o.weekdays.length > 7) return null;
      if (!o.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
      const weekdays = [...new Set(o.weekdays as number[])].sort((a, b) => a - b);
      return { freq: "week", interval: o.interval, weekdays };
    }
    case "month": {
      const day = o.day;
      if (day !== "last" && !(typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 31)) return null;
      return { freq: "month", interval: o.interval, day: day as number | "last" };
    }
    default:
      return null;
  }
}

// ── Date-key helpers ───────────────────────────────────────

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

function key(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function dayNumber(k: string): number {
  return Math.floor(new Date(`${k}T00:00:00Z`).getTime() / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(k: string): number {
  return new Date(`${k}T00:00:00Z`).getUTCDay();
}

/** The Monday of the week (Monday–Sunday) that holds `k`. */
export function mondayOf(k: string): string {
  return addDays(k, -((weekdayOf(k) + 6) % 7));
}

function monthIndex(k: string): number {
  const [y, m] = parts(k);
  return y * 12 + (m - 1);
}

function monthKey(idx: number, day: number | "last"): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const dim = daysInMonth(y, m);
  return key(y, m, day === "last" ? dim : Math.min(day, dim));
}

// ── Next occurrence ────────────────────────────────────────

/**
 * The first occurrence of the series (anchored on `dueKey`) that falls strictly
 * after `afterKey` and not before `dueKey`. Callers pass
 * `afterKey = max(dueKey, completedLocalKey)`, so finishing a daily task three
 * days late gives tomorrow, not three overdue copies.
 */
export function nextOccurrence(rule: RepeatRule, dueKey: string, afterKey: string): string {
  if (!isDateKey(dueKey) || !isDateKey(afterKey)) throw new RangeError("Invalid date key");

  switch (rule.freq) {
    case "day": {
      if (dueKey > afterKey) return dueKey;
      const n = Math.floor((dayNumber(afterKey) - dayNumber(dueKey)) / rule.interval) + 1;
      return addDays(dueKey, n * rule.interval);
    }
    case "week": {
      const anchor = dayNumber(mondayOf(dueKey));
      let d = dueKey > afterKey ? dueKey : addDays(afterKey, 1);
      // Within `interval` weeks there is always a matching weekday.
      for (let i = 0; i < 7 * rule.interval + 7; i++, d = addDays(d, 1)) {
        const weeks = Math.round((dayNumber(mondayOf(d)) - anchor) / 7);
        if (weeks % rule.interval === 0 && rule.weekdays.includes(weekdayOf(d))) return d;
      }
      throw new RangeError("No occurrence found");
    }
    case "month": {
      const anchor = monthIndex(dueKey);
      const gap = Math.max(0, monthIndex(afterKey) - anchor);
      let n = Math.max(0, Math.floor(gap / rule.interval) - 1);
      for (let i = 0; i < 40; i++, n++) {
        const k = monthKey(anchor + n * rule.interval, rule.day);
        if (k > afterKey && k >= dueKey) return k;
      }
      throw new RangeError("No occurrence found");
    }
    case "year": {
      const [y, m, d] = parts(dueKey);
      const gap = Math.max(0, parts(afterKey)[0] - y);
      let n = Math.max(0, Math.floor(gap / rule.interval) - 1);
      for (let i = 0; i < 40; i++, n++) {
        const yr = y + n * rule.interval;
        const k = key(yr, m, Math.min(d, daysInMonth(yr, m)));
        if (k > afterKey && k >= dueKey) return k;
      }
      throw new RangeError("No occurrence found");
    }
  }
}

/** Occurrences strictly after `dueKey` that fall in [fromKey, toKey], for the calendar's faded entries. */
export function occurrencesBetween(rule: RepeatRule, dueKey: string, fromKey: string, toKey: string, limit = 60): string[] {
  const out: string[] = [];
  let cur = addDays(fromKey, -1) > dueKey ? addDays(fromKey, -1) : dueKey;
  while (out.length < limit) {
    const next = nextOccurrence(rule, dueKey, cur);
    if (next > toKey) break;
    if (next >= fromKey) out.push(next);
    cur = next;
  }
  return out;
}

// ── Labels ─────────────────────────────────────────────────

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Sentence-case label for a rule: "Every Mon, Wed, Fri", "Every month on the 1st". */
export function formatRepeat(rule: RepeatRule): string {
  const n = rule.interval;
  switch (rule.freq) {
    case "day":
      return n === 1 ? "Every day" : `Every ${n} days`;
    case "week": {
      const wk = rule.weekdays.join(",");
      if (n === 1 && wk === "1,2,3,4,5") return "Weekdays";
      if (n === 1 && wk === "0,1,2,3,4,5,6") return "Every day";
      const days = rule.weekdays.map((d) => DAY_SHORT[d]).join(", ");
      return n === 1 ? `Every ${days}` : `Every ${n} weeks on ${days}`;
    }
    case "month": {
      const on = rule.day === "last" ? "the last day" : `the ${ordinal(rule.day)}`;
      return n === 1 ? `Every month on ${on}` : `Every ${n} months on ${on}`;
    }
    case "year":
      return n === 1 ? "Every year" : `Every ${n} years`;
  }
}
