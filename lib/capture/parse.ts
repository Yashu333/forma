import type { Priority } from "@/types";
import { addDays, isDateKey } from "@/lib/frog/dates";
import { nextOccurrence, weekdayOf, type RepeatRule } from "@/lib/recurrence/rule";

// Quick-capture text parser: "call dentist tmr 3pm #personal !high" becomes a
// title plus a project, a due date and time, and a priority. Pure and
// deterministic: the caller supplies today's date key, so nothing reads a clock.

export interface CaptureProject {
  id: string;
  name: string;
}

export type CaptureTokenKind = "project" | "priority" | "date" | "time" | "plan" | "repeat";

export interface CaptureToken {
  start: number;
  end: number;
  kind: CaptureTokenKind;
}

export interface ParsedCapture {
  title: string;
  groupId: string | null;
  priority: Priority | null;
  due: { date: string; time: string | null } | null;
  planToday: boolean;
  repeat: RepeatRule | null;
  tokens: CaptureToken[];
}

export interface ParseOptions {
  /** The user's local date, "YYYY-MM-DD". */
  today: string;
  /** The user's local time now, "HH:MM". Used to decide if a bare time has passed. */
  nowTime?: string;
  projects: CaptureProject[];
  /** Raw token texts (lowercased) the user dismissed; they stay in the title. */
  ignore?: readonly string[];
}

interface Match {
  start: number;
  end: number;
}

const BEFORE = String.raw`(?<![\w@#!/:.-])`;
const AFTER = String.raw`(?![\w@#/:-]|\.\d)`;

function rx(body: string): RegExp {
  return new RegExp(`${BEFORE}(?:${body})${AFTER}`, "gi");
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};
const WEEKDAY_RE = "sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec";

const PRIORITY_WORDS: Record<string, Priority> = {
  urgent: "URGENT", high: "HIGH", medium: "MEDIUM", low: "LOW",
  "1": "URGENT", "2": "HIGH", "3": "MEDIUM", "4": "LOW",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dayOfWeek(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/** The next given weekday strictly after `today` (same weekday means next week). */
export function nextWeekday(today: string, target: number): string {
  const delta = (target - dayOfWeek(today) + 7) % 7 || 7;
  return addDays(today, delta);
}

/** A month and day in the current year, or next year if it has already passed. */
function monthDay(today: string, month: number, day: number): string | null {
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const key = `${String(y).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
    if (isDateKey(key) && key >= today) return key;
  }
  return null;
}

interface Found<T> extends Match {
  value: T;
}

function overlaps(a: Match, b: Match): boolean {
  return a.start < b.end && b.start < a.end;
}

function* matches(text: string, re: RegExp): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) re.lastIndex++;
    else yield m;
  }
}

function findDates(text: string, today: string, claimed: Match[]): Found<string>[] {
  const out: Found<string>[] = [];
  const push = (m: RegExpExecArray, value: string | null) => {
    if (value === null) return;
    const f = { start: m.index, end: m.index + m[0].length, value };
    if (!claimed.some((c) => overlaps(c, f))) out.push(f);
  };

  for (const m of matches(text, rx(String.raw`\d{4}-\d{2}-\d{2}`))) push(m, isDateKey(m[0]) ? m[0] : null);
  for (const m of matches(text, rx(String.raw`in\s+(\d{1,3})\s+(days?|weeks?)`))) {
    const n = Number(m[1]);
    push(m, n > 0 ? addDays(today, /^w/i.test(m[2]) ? n * 7 : n) : null);
  }
  for (const m of matches(text, rx(String.raw`next\s+week`))) push(m, nextWeekday(today, 1));
  for (const m of matches(text, rx(String.raw`tomorrow|tmrw|tmr`))) push(m, addDays(today, 1));
  for (const m of matches(text, rx(String.raw`today|tod`))) push(m, today);
  for (const m of matches(text, rx(WEEKDAY_RE))) push(m, nextWeekday(today, WEEKDAYS[m[0].toLowerCase()]));
  for (const m of matches(text, rx(String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_RE})`))) {
    push(m, monthDay(today, MONTHS[m[2].toLowerCase()], Number(m[1])));
  }
  for (const m of matches(text, rx(String.raw`(${MONTH_RE})\s+(\d{1,2})(?:st|nd|rd|th)?`))) {
    push(m, monthDay(today, MONTHS[m[1].toLowerCase()], Number(m[2])));
  }
  for (const m of matches(text, rx(String.raw`(\d{1,2})/(\d{1,2})`))) {
    push(m, monthDay(today, Number(m[2]), Number(m[1])));
  }
  return out;
}

function to24h(hour: number, minute: number, meridiem: string | undefined): string | null {
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.toLowerCase() === "pm";
    hour = (hour % 12) + (pm ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return `${pad2(hour)}:${pad2(minute)}`;
}

function findTimes(text: string, claimed: Match[]): Found<string>[] {
  const out: Found<string>[] = [];
  const push = (m: RegExpExecArray, value: string | null) => {
    if (value === null) return;
    const f = { start: m.index, end: m.index + m[0].length, value };
    if (!claimed.some((c) => overlaps(c, f)) && !out.some((o) => overlaps(o, f))) out.push(f);
  };
  for (const m of matches(text, rx(String.raw`at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`))) {
    push(m, to24h(Number(m[1]), Number(m[2] ?? 0), m[3]));
  }
  for (const m of matches(text, rx(String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)`))) {
    push(m, to24h(Number(m[1]), Number(m[2] ?? 0), m[3]));
  }
  for (const m of matches(text, rx(String.raw`(\d{1,2}):(\d{2})`))) {
    push(m, to24h(Number(m[1]), Number(m[2]), undefined));
  }
  return out;
}

/** "1st", "15th" → the number. */
function ordinalDay(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s);
  return n >= 1 && n <= 31 ? n : null;
}

const LIST_SEP = String.raw`(?:\s*,\s*|\s+and\s+|\s*&\s*|\s+)`;

// Repeat phrases. `build` gets the date the series is anchored on, for the
// parts a phrase leaves open ("every week" = the weekday of the due date).
function findRepeats(text: string, claimed: Match[]): Found<(anchor: string) => RepeatRule>[] {
  const out: Found<(anchor: string) => RepeatRule>[] = [];
  const push = (m: RegExpExecArray, build: (anchor: string) => RepeatRule | null) => {
    const f = { start: m.index, end: m.index + m[0].length, value: build as (anchor: string) => RepeatRule };
    if (!claimed.some((c) => overlaps(c, f))) out.push(f);
  };
  for (const m of matches(text, rx(String.raw`every\s+weekday|weekdays`))) {
    push(m, () => ({ freq: "week", interval: 1, weekdays: [1, 2, 3, 4, 5] }));
  }
  for (const m of matches(text, rx(String.raw`every\s*day|daily`))) push(m, () => ({ freq: "day", interval: 1 }));
  for (const m of matches(text, rx(String.raw`every\s+week|weekly`))) {
    push(m, (a) => ({ freq: "week", interval: 1, weekdays: [weekdayOf(a)] }));
  }
  for (const m of matches(text, rx(String.raw`every\s+((?:${WEEKDAY_RE})(?:${LIST_SEP}(?:${WEEKDAY_RE}))*)`))) {
    const days = [...new Set([...m[1].matchAll(new RegExp(WEEKDAY_RE, "gi"))].map((w) => WEEKDAYS[w[0].toLowerCase()]))].sort((a, b) => a - b);
    push(m, () => ({ freq: "week", interval: 1, weekdays: days }));
  }
  for (const m of matches(text, rx(String.raw`every\s+(\d{1,3})\s+(day|week|month|year)s?`))) {
    const n = Number(m[1]);
    if (n < 1) continue;
    const unit = m[2].toLowerCase();
    push(m, (a) =>
      unit === "day" ? { freq: "day", interval: n }
      : unit === "week" ? { freq: "week", interval: n, weekdays: [weekdayOf(a)] }
      : unit === "month" ? { freq: "month", interval: n, day: Number(a.slice(8, 10)) }
      : { freq: "year", interval: n });
  }
  for (const m of matches(text, rx(String.raw`every\s+month(?:\s+on\s+the\s+(?:(\d{1,2})(?:st|nd|rd|th)?|last\s+day))?|monthly`))) {
    const fixed = ordinalDay(m[1]);
    const last = /last\s+day/i.test(m[0]);
    push(m, (a) => ({ freq: "month", interval: 1, day: last ? "last" : fixed ?? Number(a.slice(8, 10)) }));
  }
  for (const m of matches(text, rx(String.raw`every\s+year|yearly|annually`))) push(m, () => ({ freq: "year", interval: 1 }));
  return out;
}

function matchProject(name: string, projects: CaptureProject[]): CaptureProject | null {
  const needle = name.toLowerCase();
  const norm = (p: CaptureProject) => p.name.toLowerCase().replace(/\s+/g, "");
  const exact = projects.find((p) => norm(p) === needle);
  if (exact) return exact;
  const starts = projects.filter((p) => norm(p).startsWith(needle));
  if (starts.length === 0) return null;
  return starts.reduce((a, b) => (norm(b).length < norm(a).length ? b : a));
}

export function parseCapture(text: string, opts: ParseOptions): ParsedCapture {
  const ignore = new Set((opts.ignore ?? []).map((s) => s.toLowerCase()));
  const claimed: Match[] = [];
  const tokens: CaptureToken[] = [];
  const claim = (m: Match, kind: CaptureTokenKind) => {
    claimed.push({ start: m.start, end: m.end });
    tokens.push({ start: m.start, end: m.end, kind });
  };
  const ignored = (m: Match) => ignore.has(text.slice(m.start, m.end).toLowerCase());

  let groupId: string | null = null;
  for (const m of matches(text, rx(String.raw`#([^\s#!@]+)`))) {
    const f = { start: m.index, end: m.index + m[0].length };
    const project = ignored(f) ? null : matchProject(m[1], opts.projects);
    if (project) {
      groupId = project.id;
      claim(f, "project");
    }
  }

  let priority: Priority | null = null;
  for (const m of matches(text, rx(String.raw`!(urgent|high|medium|low|[1-4])`))) {
    const f = { start: m.index, end: m.index + m[0].length };
    if (ignored(f)) continue;
    priority = PRIORITY_WORDS[m[1].toLowerCase()];
    claim(f, "priority");
  }

  let planToday = false;
  for (const m of matches(text, rx(String.raw`@today`))) {
    const f = { start: m.index, end: m.index + m[0].length };
    if (ignored(f)) continue;
    planToday = true;
    claim(f, "plan");
  }

  // Repeat phrases go before dates so "every mon" isn't read as a date; the last one wins.
  const repeats = findRepeats(text, claimed)
    .filter((r) => !ignored(r))
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const keptRepeats: typeof repeats = [];
  for (const r of repeats) if (!keptRepeats.some((k) => overlaps(k, r))) keptRepeats.push(r);
  const repeatFound = keptRepeats.length ? keptRepeats[keptRepeats.length - 1] : null;
  if (repeatFound) claim(repeatFound, "repeat");

  // Times first so "3pm" can't be read as part of a date; the last one wins.
  const times = findTimes(text, claimed).filter((t) => !ignored(t));
  const time = times.length ? times.reduce((a, b) => (b.start > a.start ? b : a)) : null;
  if (time) claim(time, "time");

  // Overlapping date readings: keep the longest. The last remaining one wins.
  const dates = findDates(text, opts.today, claimed)
    .filter((d) => !ignored(d))
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Found<string>[] = [];
  for (const d of dates) if (!kept.some((k) => overlaps(k, d))) kept.push(d);
  const date = kept.length ? kept[kept.length - 1] : null;
  if (date) claim(date, "date");

  let due: ParsedCapture["due"] = null;
  if (date) {
    due = { date: date.value, time: time?.value ?? null };
  } else if (time && !repeatFound) {
    const passed = opts.nowTime !== undefined && time.value <= opts.nowTime;
    due = { date: passed ? addDays(opts.today, 1) : opts.today, time: time.value };
  }

  // A repeat anchors on the due date; with none, the first occurrence from today.
  let repeat: RepeatRule | null = null;
  if (repeatFound) {
    repeat = repeatFound.value(due?.date ?? opts.today);
    if (!due) due = { date: nextOccurrence(repeat, opts.today, addDays(opts.today, -1)), time: time?.value ?? null };
  }

  tokens.sort((a, b) => a.start - b.start);
  let title = "";
  let cursor = 0;
  for (const t of tokens) {
    title += text.slice(cursor, t.start) + " ";
    cursor = t.end;
  }
  title += text.slice(cursor);
  title = title.replace(/\s+/g, " ").trim();

  return { title, groupId, priority, due, planToday, repeat, tokens };
}
