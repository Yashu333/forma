// M5 tester: edge cases for lib/frog/review.ts beyond review.test.ts.
import { describe, expect, it } from "vitest";
import type { TodayPayload } from "@/types";
import { MAX_PLAN_TASKS } from "./today";
import {
  MAX_REVIEW_MOVES,
  MOVE_ACTIONS,
  buildReviewBody,
  countMoves,
  doneTodayLine,
  frogOutcome,
  initialMoves,
  moveFor,
  parseReviewPost,
  reflectionProblem,
  resolveTomorrowFrog,
  reviewSteps,
  sortDone,
  summarizeReview,
  tomorrowCandidates,
  unfinishedTasks,
  type MoveChoices,
} from "./review";

const base = { date: "2026-10-24", tz: "Europe/Berlin", moves: [] as unknown[] };
const parse = (b: unknown) => parseReviewPost(b);
const isOk = (b: unknown) => parse(b).ok;

describe("parseReviewPost: shape and ordering", () => {
  it("shares the plan size ceiling with PUT /api/today", () => {
    expect(MAX_REVIEW_MOVES).toBe(MAX_PLAN_TASKS);
  });

  it("offers exactly the three actions, in UI order", () => {
    expect([...MOVE_ACTIONS]).toEqual(["tomorrow", "backlog", "archive"]);
  });

  it("returns a fresh object each time (no shared mutable result)", () => {
    const a = parse(base);
    const b = parse(base);
    expect(a).not.toBe(b);
    if (a.ok && b.ok) {
      expect(a.value.moves).not.toBe(b.value.moves);
      a.value.moves.push({ taskId: "x", action: "backlog" });
      expect(b.value.moves).toEqual([]);
    }
  });

  it("does not mutate the body it parses", () => {
    const body = { ...base, moves: [{ taskId: "a", action: "archive" }], wentWell: "  hi  " };
    const copy = JSON.parse(JSON.stringify(body));
    parse(body);
    expect(body).toEqual(copy);
  });

  it("checks the date before everything else (a bad date wins over bad moves)", () => {
    const r = parse({ date: "nope", tz: "nope", moves: "nope", rating: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^date/);
  });

  it("accepts the supported calendar ends but not their neighbours", () => {
    expect(isOk({ ...base, date: "0001-01-03" })).toBe(true);
    expect(isOk({ ...base, date: "0001-01-02" })).toBe(false);
    expect(isOk({ ...base, date: "9998-12-28" })).toBe(true);
    expect(isOk({ ...base, date: "9998-12-29" })).toBe(false);
  });

  it.each(["europe/berlin", "UTC", "Etc/GMT+12", "Pacific/Kiritimati", "America/Argentina/Buenos_Aires"])("accepts the tz %s", (tz) => {
    expect(isOk({ ...base, tz })).toBe(true);
  });

  it.each(["GMT+2", "Berlin", " Europe/Berlin", "Europe/Berlin ", "UTC+1", "-05:00", "Z"])("rejects the tz %j", (tz) => {
    expect(isOk({ ...base, tz })).toBe(false);
  });

  it("treats moves that are array-likes, sparse or class instances as invalid", () => {
    expect(isOk({ ...base, moves: { length: 0 } })).toBe(false);
    expect(isOk({ ...base, moves: new Set() })).toBe(false);
    expect(isOk({ ...base, moves: [, { taskId: "a", action: "backlog" }] })).toBe(false);
  });

  it("rejects a move that is an array even though arrays are objects", () => {
    expect(isOk({ ...base, moves: [["a", "backlog"]] })).toBe(false);
  });

  it("an id that looks like an Object.prototype key is still just an id (dedupe uses a Set)", () => {
    expect(isOk({ ...base, moves: [{ taskId: "__proto__", action: "backlog" }, { taskId: "constructor", action: "archive" }] })).toBe(true);
    expect(isOk({ ...base, moves: [{ taskId: "__proto__", action: "backlog" }, { taskId: "__proto__", action: "archive" }] })).toBe(false);
  });

  it("accepts ids with spaces, unicode and 10k characters (existence is the route's job)", () => {
    expect(isOk({ ...base, moves: [{ taskId: " a b ", action: "backlog" }, { taskId: "日本語", action: "backlog" }, { taskId: "x".repeat(10_000), action: "backlog" }] })).toBe(true);
  });

  it("a parsed body survives a JSON round trip (JSON.parse of the wire form)", () => {
    const wire = JSON.parse(JSON.stringify({ ...base, moves: [{ taskId: "a", action: "tomorrow" }], wentWell: null, rating: null, tomorrowFrogTaskId: "a" }));
    const r = parse(wire);
    expect(r.ok && r.value).toMatchObject({ wentWell: null, rating: null, tomorrowFrogTaskId: "a", improve: undefined });
  });

  it("a JSON body with an own `__proto__` key doesn't break parsing", () => {
    const wire = JSON.parse('{"date":"2026-10-24","tz":"UTC","moves":[],"__proto__":{"rating":9}}');
    const r = parse(wire);
    expect(r.ok && r.value.rating).toBeUndefined();
  });
});

describe("parseReviewPost: text", () => {
  it("trims every kind of JS whitespace, including NBSP and line separators", () => {
    const r = parse({ ...base, wentWell: "   x  ﻿", improve: "  " });
    expect(r.ok && r.value.wentWell).toBe("x");
    expect(r.ok && r.value.improve).toBeNull();
  });

  it("counts length in UTF-16 code units, the same unit the textarea's maxLength uses", () => {
    expect(isOk({ ...base, wentWell: "🐸".repeat(1000) })).toBe(true);
    expect(isOk({ ...base, wentWell: "🐸".repeat(1001) })).toBe(false);
  });

  it("a text that is long only because of padding is accepted once trimmed", () => {
    expect(isOk({ ...base, wentWell: ` ${"x".repeat(2000)} `.padEnd(5000, " ") })).toBe(true);
  });

  it("inner whitespace is kept as typed", () => {
    const r = parse({ ...base, wentWell: "a\n\n  b\t c" });
    expect(r.ok && r.value.wentWell).toBe("a\n\n  b\t c");
  });
});

describe("parseReviewPost: rating", () => {
  it.each([-0, 0.5, 5.000001, Number.MAX_SAFE_INTEGER, -Infinity, "5", [5], { valueOf: () => 5 }])("rejects %j", (rating) => {
    // -0 is not in 1..5; the rest are non-integers or wrong types
    expect(isOk({ ...base, rating })).toBe(false);
  });
});

describe("parseReviewPost: tomorrowFrogTaskId vs moves", () => {
  it("is fine when the frog is moved to tomorrow, or not moved at all", () => {
    expect(isOk({ ...base, moves: [{ taskId: "a", action: "tomorrow" }], tomorrowFrogTaskId: "a" })).toBe(true);
    expect(isOk({ ...base, moves: [{ taskId: "b", action: "archive" }], tomorrowFrogTaskId: "a" })).toBe(true);
  });

  it("is rejected when it is moved elsewhere, wherever it sits in the list", () => {
    const moves = [{ taskId: "x", action: "tomorrow" }, { taskId: "y", action: "tomorrow" }, { taskId: "a", action: "backlog" }];
    expect(isOk({ ...base, moves, tomorrowFrogTaskId: "a" })).toBe(false);
  });

  it("null never conflicts with a move", () => {
    expect(isOk({ ...base, moves: [{ taskId: "a", action: "archive" }], tomorrowFrogTaskId: null })).toBe(true);
  });
});

describe("client and server agree on the reflection limits", () => {
  const texts = [
    "",
    " ",
    "x".repeat(1999),
    "x".repeat(2000),
    "x".repeat(2001),
    ` ${"x".repeat(2000)}`,
    `${"x".repeat(2000)} `,
    ` ${"x".repeat(2001)} `,
    "\n".repeat(2500),
    `${"\n".repeat(2500)}x`,
    "🐸".repeat(1000),
    "🐸".repeat(1001),
    " ".repeat(3000) + "ok",
  ];
  it.each(texts.map((t, i) => [i, t] as const))("text #%i: reflectionProblem is null exactly when the server accepts it", (_i, text) => {
    for (const field of ["wentWell", "improve"] as const) {
      const draft = { rating: null, wentWell: "", improve: "", [field]: text };
      expect(reflectionProblem(draft) === null).toBe(isOk({ ...base, [field]: text }));
    }
  });

  it.each([null, 1, 3, 5, 0, 6, 2.5, -1, NaN])("rating %s: the client check matches the server", (rating) => {
    const draft = { rating, wentWell: "", improve: "" };
    expect(reflectionProblem(draft) === null).toBe(isOk({ ...base, rating }));
  });
});

describe("buildReviewBody always produces a body the server accepts", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, completedAt: null }));
  const reflection = { rating: 3, wentWell: ` ${"x".repeat(2000)} `, improve: "" };

  it.each([
    ["everything to tomorrow", () => ({})],
    ["a mix", () => ({ t0: "backlog", t1: "archive", t3: "backlog" })],
    ["everything archived", () => Object.fromEntries(mk(6).map((t) => [t.id, "archive"]))],
  ])("%s, with the frog resolved the way the flow does", (_name, choicesFn) => {
    const unfinished = mk(6);
    const moves = choicesFn() as MoveChoices;
    for (const choice of [undefined, null, "t0", "t2", "gone"] as const) {
      const frog = resolveTomorrowFrog(tomorrowCandidates(unfinished, moves), choice);
      const body = buildReviewBody({ date: "2026-10-24", tz: "Europe/Berlin", unfinished, moves, reflection, tomorrowFrogTaskId: frog });
      const parsed = parse(JSON.parse(JSON.stringify(body)));
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      if (parsed.ok && frog) {
        // the frog is always among the tasks that go to tomorrow
        expect(parsed.value.moves.find((m) => m.taskId === frog)?.action).toBe("tomorrow");
      }
    }
  });

  it("200 unfinished tasks fit; 201 would be a 400 (more than the plan cap)", () => {
    const body = (n: number) => buildReviewBody({ date: "2026-10-24", tz: "UTC", unfinished: mk(n), moves: {}, reflection, tomorrowFrogTaskId: null });
    expect(parse(body(200)).ok).toBe(true);
    expect(parse(body(201)).ok).toBe(false);
  });

  it("sends the trimmed text but the untrimmed length never matters: whitespace-only becomes '' and is stored as null", () => {
    const body = buildReviewBody({ date: "2026-10-24", tz: "UTC", unfinished: [], moves: {}, reflection: { rating: null, wentWell: "  \n ", improve: " x " }, tomorrowFrogTaskId: null });
    expect(body.wentWell).toBe("");
    expect(body.improve).toBe("x");
    const r = parse(body);
    expect(r.ok && [r.value.wentWell, r.value.improve]).toEqual([null, "x"]);
  });

  it("always sends rating and both texts (never omitted), so the form state is what gets stored", () => {
    const body = buildReviewBody({ date: "2026-10-24", tz: "UTC", unfinished: [], moves: {}, reflection: { rating: null, wentWell: "", improve: "" }, tomorrowFrogTaskId: null });
    expect(Object.keys(body)).toEqual(expect.arrayContaining(["rating", "wentWell", "improve", "tomorrowFrogTaskId", "moves"]));
    expect(body.rating).toBeNull();
  });

  it("ignores move choices for tasks that aren't unfinished (e.g. stale ids)", () => {
    const body = buildReviewBody({ date: "2026-10-24", tz: "UTC", unfinished: mk(2), moves: { t0: "archive", ghost: "archive" }, reflection, tomorrowFrogTaskId: null });
    expect(body.moves).toEqual([{ taskId: "t0", action: "archive" }, { taskId: "t1", action: "tomorrow" }]);
  });

  it("keeps duplicate ids out when the payload has none (one move per task)", () => {
    const body = buildReviewBody({ date: "2026-10-24", tz: "UTC", unfinished: mk(5), moves: {}, reflection, tomorrowFrogTaskId: null });
    expect(new Set(body.moves.map((m) => m.taskId)).size).toBe(5);
  });
});

describe("move choice helpers: odd inputs", () => {
  it("initialMoves of the same task twice is still one choice", () => {
    expect(initialMoves([{ id: "a" }, { id: "a" }])).toEqual({ a: "tomorrow" });
  });
  it("countMoves ignores choices for tasks that aren't listed", () => {
    expect(countMoves([{ id: "a" }], { a: "archive", b: "archive", c: "backlog" })).toEqual({ tomorrow: 0, backlog: 0, archive: 1 });
  });
  it("tomorrowCandidates doesn't mutate and returns a new array", () => {
    const list = [{ id: "a" }];
    const out = tomorrowCandidates(list, {});
    expect(out).toEqual(list);
    expect(out).not.toBe(list);
  });
  it("moveFor reads own choices (a real task id is never inherited from Object.prototype)", () => {
    expect(moveFor(initialMoves([{ id: "abc" }]), "abc")).toBe("tomorrow");
    expect(moveFor({}, "zzz")).toBe("tomorrow");
  });
  it("the first candidate is the suggestion whatever the choice object's key order", () => {
    const cands = [{ id: "b" }, { id: "a" }];
    expect(resolveTomorrowFrog(cands, undefined)).toBe("b");
  });
  it("a frog choice of '' is not a candidate and falls back to the suggestion", () => {
    expect(resolveTomorrowFrog([{ id: "a" }], "")).toBe("a");
  });
  it("unfinishedTasks: a completedAt of '' or 0 counts as done only if the API ever sends it (!= null)", () => {
    expect(unfinishedTasks([{ completedAt: "" }, { completedAt: undefined }, {}])).toHaveLength(2);
  });
  it("unfinishedTasks accepts Date values", () => {
    expect(unfinishedTasks([{ completedAt: new Date() }, { completedAt: null }])).toHaveLength(1);
  });
});

describe("reviewSteps: the stepper the user sees", () => {
  it("always starts with Done and has Reflect before Frog", () => {
    for (const a of [true, false]) {
      for (const b of [true, false]) {
        const s = reviewSteps(a, b);
        expect(s[0]).toBe("done");
        expect(s.indexOf("reflect")).toBeGreaterThan(0);
        if (b) expect(s.indexOf("frog")).toBeGreaterThan(s.indexOf("reflect"));
        expect(new Set(s).size).toBe(s.length);
      }
    }
  });
  it("candidates without unfinished tasks can't happen from the UI but still yields a frog step", () => {
    expect(reviewSteps(false, true)).toEqual(["done", "reflect", "frog"]);
  });
});

describe("frogOutcome and the summary at the edges", () => {
  const pay = (o: Partial<TodayPayload>) =>
    ({ date: "2026-10-24", plan: null, frog: null, tasks: [], completedToday: [], openA: 0, streak: { current: 0, longest: 0 }, ...o }) as TodayPayload;
  const frog = (o: object) => ({ id: "f", title: "F", completedAt: null, archivedAt: null, ...o }) as unknown as TodayPayload["frog"];

  it("an archived frog that was eaten counts as eaten (and keeps its title in the summary)", () => {
    const p = pay({ frog: frog({ completedAt: "2026-10-24T07:00:00Z", archivedAt: "2026-10-24T20:00:00Z" }) });
    expect(frogOutcome(p, "Europe/Berlin")).toBe("eaten");
    expect(summarizeReview(p, "Europe/Berlin").frogTitle).toBe("F");
  });
  it("a frog completed the day before the plan date is 'eaten'", () => {
    expect(frogOutcome(pay({ frog: frog({ completedAt: "2026-10-01T07:00:00Z" }) }), "Europe/Berlin")).toBe("eaten");
  });
  it("completion exactly at local midnight belongs to the new day", () => {
    // 2026-10-23T22:00:00Z = 2026-10-24 00:00 in Berlin (UTC+2): eaten on the 24th
    expect(frogOutcome(pay({ frog: frog({ completedAt: "2026-10-23T22:00:00Z" }) }), "Europe/Berlin")).toBe("eaten");
    // one millisecond earlier is still the 23rd, which is before the date: also eaten
    expect(frogOutcome(pay({ frog: frog({ completedAt: "2026-10-23T21:59:59.999Z" }) }), "Europe/Berlin")).toBe("eaten");
    // 2026-10-24T22:00:00Z is 00:00 on the 25th: after the plan date
    expect(frogOutcome(pay({ frog: frog({ completedAt: "2026-10-24T22:00:00Z" }) }), "Europe/Berlin")).toBe("not-eaten");
  });
  it("an eliminated frog gives no frog title and a 'none' outcome", () => {
    const s = summarizeReview(pay({ frog: frog({ archivedAt: "2026-10-24T10:00:00Z" }) }), "UTC");
    expect(s).toMatchObject({ outcome: "none", frogTitle: null });
  });
  it("the streak text has one phrase for a running streak and one for none, and the numbers pass through", () => {
    expect(summarizeReview(pay({ streak: { current: 1, longest: 1 } }), "UTC").streakText).toMatch(/1-day frog streak/);
    expect(summarizeReview(pay({ streak: { current: 0, longest: 7 } }), "UTC")).toMatchObject({ streakLongest: 7, streakCurrent: 0 });
  });
  it("doneTodayLine with the frog eaten ignores the count", () => {
    expect(doneTodayLine(0, "eaten")).toBe(doneTodayLine(9, "eaten"));
  });
  it("sortDone with the frog in the middle of many keeps the others in order", () => {
    const d = (id: string) => ({ id }) as unknown as TodayPayload["completedToday"][number];
    expect(sortDone([d("a"), d("b"), d("f"), d("c"), d("e")], "f").map((x) => x.id)).toEqual(["f", "a", "b", "c", "e"]);
  });
});
