import { describe, expect, it } from "vitest";
import type { TodayPayload } from "@/types";
import {
  MAX_REVIEW_MOVES,
  MAX_REVIEW_TEXT,
  buildReviewBody,
  countMoves,
  doneTodayLine,
  frogOutcome,
  initialMoves,
  initialReflection,
  isReviewed,
  moveFor,
  parseRating,
  parseReviewPost,
  reflectionProblem,
  resolveTomorrowFrog,
  reviewSteps,
  sortDone,
  summarizeReview,
  tomorrowCandidates,
  unfinishedTasks,
} from "./review";

const base = { date: "2026-10-24", tz: "Europe/Berlin", moves: [] as unknown[] };
const ok = (body: unknown) => {
  const r = parseReviewPost(body);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (body: unknown) => {
  const r = parseReviewPost(body);
  if (r.ok) throw new Error("expected a failure");
  return r.error;
};

describe("parseReviewPost", () => {
  it("rejects a NUL character in the text fields, task ids and the frog id (a 400, not a database error)", () => {
    expect(err({ ...base, wentWell: "a\u0000b" })).toMatch(/wentWell.*NUL/);
    expect(err({ ...base, improve: "\u0000" })).toMatch(/improve.*NUL/);
    expect(err({ ...base, moves: [{ taskId: "a\u0000b", action: "tomorrow" }] })).toMatch(/NUL/);
    expect(err({ ...base, tomorrowFrogTaskId: "a\u0000b" })).toMatch(/NUL/);
    // Still fine without one.
    expect(ok({ ...base, wentWell: "fine", moves: [{ taskId: "a", action: "tomorrow" }] }).wentWell).toBe("fine");
  });
  it("accepts the minimal body and computes tomorrow", () => {
    expect(ok(base)).toEqual({
      date: "2026-10-24",
      tomorrow: "2026-10-25",
      tz: "Europe/Berlin",
      moves: [],
      wentWell: undefined,
      improve: undefined,
      rating: undefined,
      tomorrowFrogTaskId: null,
    });
  });

  it("computes tomorrow across month and year ends and leap days", () => {
    expect(ok({ ...base, date: "2026-12-31" }).tomorrow).toBe("2027-01-01");
    expect(ok({ ...base, date: "2028-02-28" }).tomorrow).toBe("2028-02-29");
    expect(ok({ ...base, date: "2027-02-28" }).tomorrow).toBe("2027-03-01");
  });

  it("rejects non-object bodies", () => {
    for (const b of [null, undefined, "x", 3, [], true]) expect(err(b)).toMatch(/object/);
  });

  it.each([undefined, null, "", "2026-2-3", "2026-02-30", "nope", 20261024])("rejects the date %j", (date) => {
    expect(err({ ...base, date })).toMatch(/date/);
  });

  it("rejects dates outside the supported range, and a date whose tomorrow is outside it", () => {
    expect(err({ ...base, date: "0000-01-01" })).toMatch(/between/);
    expect(err({ ...base, date: "9998-12-29" })).toMatch(/next day/);
    expect(ok({ ...base, date: "9998-12-28" }).tomorrow).toBe("9998-12-29");
  });

  it.each([undefined, null, "", "Mars/Olympus", "+05:00", 5])("rejects the tz %j", (tz) => {
    expect(err({ ...base, tz })).toMatch(/tz/);
  });

  it("requires moves to be an array of at most 200", () => {
    expect(err({ ...base, moves: undefined })).toMatch(/moves/);
    expect(err({ ...base, moves: "x" })).toMatch(/moves/);
    expect(err({ ...base, moves: {} })).toMatch(/moves/);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ taskId: `t${i}`, action: "backlog" }));
    expect(ok({ ...base, moves: many(MAX_REVIEW_MOVES) }).moves).toHaveLength(MAX_REVIEW_MOVES);
    expect(err({ ...base, moves: many(MAX_REVIEW_MOVES + 1) })).toMatch(/at most/);
  });

  it("validates each move", () => {
    expect(err({ ...base, moves: [null] })).toMatch(/object/);
    expect(err({ ...base, moves: [{ action: "tomorrow" }] })).toMatch(/taskId/);
    expect(err({ ...base, moves: [{ taskId: "", action: "tomorrow" }] })).toMatch(/taskId/);
    expect(err({ ...base, moves: [{ taskId: 1, action: "tomorrow" }] })).toMatch(/taskId/);
    expect(err({ ...base, moves: [{ taskId: "a" }] })).toMatch(/action/);
    expect(err({ ...base, moves: [{ taskId: "a", action: "delete" }] })).toMatch(/action/);
    expect(err({ ...base, moves: [{ taskId: "a", action: "TOMORROW" }] })).toMatch(/action/);
  });

  it("rejects the same task twice, even with two different actions", () => {
    const m = [{ taskId: "a", action: "tomorrow" }, { taskId: "a", action: "backlog" }];
    expect(err({ ...base, moves: m })).toMatch(/twice/);
  });

  it("keeps move order and ignores extra keys", () => {
    const v = ok({ ...base, moves: [{ taskId: "b", action: "archive", extra: 1 }, { taskId: "a", action: "tomorrow" }] });
    expect(v.moves).toEqual([{ taskId: "b", action: "archive" }, { taskId: "a", action: "tomorrow" }]);
  });

  describe("text fields", () => {
    it("trims, keeps null, leaves an omitted field undefined", () => {
      const v = ok({ ...base, wentWell: "  fine  ", improve: null });
      expect(v.wentWell).toBe("fine");
      expect(v.improve).toBeNull();
      expect(ok(base).wentWell).toBeUndefined();
    });

    it("turns empty and whitespace-only text into null", () => {
      expect(ok({ ...base, wentWell: "", improve: " \n\t " })).toMatchObject({ wentWell: null, improve: null });
    });

    it("caps at 2000 characters after trimming", () => {
      const max = "x".repeat(MAX_REVIEW_TEXT);
      expect(ok({ ...base, wentWell: ` ${max} ` }).wentWell).toBe(max);
      expect(err({ ...base, wentWell: max + "x" })).toMatch(/wentWell/);
      expect(err({ ...base, improve: max + "x" })).toMatch(/improve/);
    });

    it("rejects non-strings", () => {
      expect(err({ ...base, wentWell: 5 })).toMatch(/wentWell/);
      expect(err({ ...base, improve: {} })).toMatch(/improve/);
      expect(err({ ...base, wentWell: ["a"] })).toMatch(/wentWell/);
    });
  });

  describe("rating", () => {
    it.each([1, 2, 3, 4, 5])("accepts %i", (n) => expect(ok({ ...base, rating: n }).rating).toBe(n));
    it("accepts null (clear) and treats absent as undefined (keep)", () => {
      expect(ok({ ...base, rating: null }).rating).toBeNull();
      expect(ok(base).rating).toBeUndefined();
    });
    it.each([0, 6, -1, 2.5, "3", NaN, Infinity, true, {}])("rejects %j", (rating) => {
      expect(err({ ...base, rating })).toMatch(/rating/);
    });
  });

  describe("tomorrowFrogTaskId", () => {
    it("defaults absent and null to null", () => {
      expect(ok(base).tomorrowFrogTaskId).toBeNull();
      expect(ok({ ...base, tomorrowFrogTaskId: null }).tomorrowFrogTaskId).toBeNull();
    });
    it("accepts an id, with or without a tomorrow move", () => {
      expect(ok({ ...base, tomorrowFrogTaskId: "a" }).tomorrowFrogTaskId).toBe("a");
      expect(ok({ ...base, tomorrowFrogTaskId: "a", moves: [{ taskId: "a", action: "tomorrow" }] }).tomorrowFrogTaskId).toBe("a");
    });
    it("rejects non-strings and the empty string", () => {
      expect(err({ ...base, tomorrowFrogTaskId: 5 })).toMatch(/tomorrowFrogTaskId/);
      expect(err({ ...base, tomorrowFrogTaskId: "" })).toMatch(/tomorrowFrogTaskId/);
      expect(err({ ...base, tomorrowFrogTaskId: {} })).toMatch(/tomorrowFrogTaskId/);
    });
    it("rejects a frog that is being sent to the backlog or archived", () => {
      for (const action of ["backlog", "archive"]) {
        expect(err({ ...base, tomorrowFrogTaskId: "a", moves: [{ taskId: "a", action }] })).toMatch(/backlog or archived/);
      }
    });
  });
});

describe("parseRating", () => {
  it("accepts null and 1-5 only", () => {
    expect(parseRating(null)).toEqual({ ok: true, value: null });
    expect(parseRating(3)).toEqual({ ok: true, value: 3 });
    expect(parseRating(undefined).ok).toBe(false);
    expect(parseRating(0).ok).toBe(false);
  });
});

const T = (id: string, extra: object = {}) => ({ id, completedAt: null, ...extra });

describe("unfinished tasks and move choices", () => {
  it("unfinishedTasks keeps the open ones in order", () => {
    const tasks = [T("a"), T("b", { completedAt: "2026-10-24T08:00:00Z" }), T("c")];
    expect(unfinishedTasks(tasks).map((t) => t.id)).toEqual(["a", "c"]);
    expect(unfinishedTasks([])).toEqual([]);
  });

  it("initialMoves sends everything to tomorrow", () => {
    expect(initialMoves([T("a"), T("b")])).toEqual({ a: "tomorrow", b: "tomorrow" });
    expect(initialMoves([])).toEqual({});
  });

  it("moveFor falls back to tomorrow for a task with no choice", () => {
    expect(moveFor({ a: "archive" }, "a")).toBe("archive");
    expect(moveFor({}, "zzz")).toBe("tomorrow");
  });

  it("tomorrowCandidates keeps list order and drops backlog/archive", () => {
    const list = [T("a"), T("b"), T("c"), T("d")];
    expect(tomorrowCandidates(list, { a: "backlog", b: "tomorrow", c: "archive" }).map((t) => t.id)).toEqual(["b", "d"]);
    expect(tomorrowCandidates(list, { a: "backlog", b: "archive", c: "archive", d: "backlog" })).toEqual([]);
    expect(tomorrowCandidates([], {})).toEqual([]);
  });

  it("countMoves counts each action", () => {
    const list = [T("a"), T("b"), T("c")];
    expect(countMoves(list, { a: "backlog", b: "archive" })).toEqual({ tomorrow: 1, backlog: 1, archive: 1 });
    expect(countMoves([], {})).toEqual({ tomorrow: 0, backlog: 0, archive: 0 });
  });
});

describe("resolveTomorrowFrog", () => {
  const cands = [{ id: "a" }, { id: "b" }];
  it("suggests the first candidate until the user chooses", () => {
    expect(resolveTomorrowFrog(cands, undefined)).toBe("a");
  });
  it("keeps a pick that is still a candidate", () => {
    expect(resolveTomorrowFrog(cands, "b")).toBe("b");
  });
  it("treats null as an explicit skip", () => {
    expect(resolveTomorrowFrog(cands, null)).toBeNull();
  });
  it("falls back to the suggestion when the pick left the candidates", () => {
    expect(resolveTomorrowFrog(cands, "gone")).toBe("a");
  });
  it("is null with no candidates, whatever was chosen", () => {
    expect(resolveTomorrowFrog([], undefined)).toBeNull();
    expect(resolveTomorrowFrog([], "a")).toBeNull();
  });
});

describe("reflection", () => {
  it("initialReflection is blank without a plan and prefilled with one", () => {
    expect(initialReflection(null)).toEqual({ rating: null, wentWell: "", improve: "" });
    expect(initialReflection(undefined)).toEqual({ rating: null, wentWell: "", improve: "" });
    expect(initialReflection({ rating: 4, wentWell: "a", improve: "b" })).toEqual({ rating: 4, wentWell: "a", improve: "b" });
    expect(initialReflection({ rating: null, wentWell: null, improve: undefined })).toEqual({ rating: null, wentWell: "", improve: "" });
  });

  it("reflectionProblem accepts a blank, a full and a boundary draft", () => {
    expect(reflectionProblem({ rating: null, wentWell: "", improve: "" })).toBeNull();
    expect(reflectionProblem({ rating: 5, wentWell: "x".repeat(MAX_REVIEW_TEXT), improve: "y".repeat(MAX_REVIEW_TEXT) })).toBeNull();
  });

  it("reflectionProblem flags a bad rating and over-long text, trimming first", () => {
    expect(reflectionProblem({ rating: 0, wentWell: "", improve: "" })).toMatch(/rating/i);
    expect(reflectionProblem({ rating: 6, wentWell: "", improve: "" })).toMatch(/rating/i);
    expect(reflectionProblem({ rating: 2.5, wentWell: "", improve: "" })).toMatch(/rating/i);
    expect(reflectionProblem({ rating: null, wentWell: "x".repeat(MAX_REVIEW_TEXT + 1), improve: "" })).toMatch(/went well/);
    expect(reflectionProblem({ rating: null, wentWell: "", improve: "x".repeat(MAX_REVIEW_TEXT + 1) })).toMatch(/differently/);
    expect(reflectionProblem({ rating: null, wentWell: ` ${"x".repeat(MAX_REVIEW_TEXT)} `, improve: "" })).toBeNull();
  });
});

describe("buildReviewBody", () => {
  const args = {
    date: "2026-10-24",
    tz: "Europe/Berlin",
    unfinished: [T("a"), T("b"), T("c")],
    moves: { b: "backlog", c: "archive" } as const,
    reflection: { rating: 4, wentWell: "  good ", improve: "" },
    tomorrowFrogTaskId: "a",
  };

  it("sends one move per unfinished task, trimmed text and the frog", () => {
    expect(buildReviewBody({ ...args, moves: { ...args.moves } })).toEqual({
      date: "2026-10-24",
      tz: "Europe/Berlin",
      moves: [
        { taskId: "a", action: "tomorrow" },
        { taskId: "b", action: "backlog" },
        { taskId: "c", action: "archive" },
      ],
      wentWell: "good",
      improve: "",
      rating: 4,
      tomorrowFrogTaskId: "a",
    });
  });

  it("works with nothing unfinished and nothing written", () => {
    const body = buildReviewBody({ ...args, unfinished: [], moves: {}, reflection: { rating: null, wentWell: "", improve: "" }, tomorrowFrogTaskId: null });
    expect(body.moves).toEqual([]);
    expect(body.rating).toBeNull();
    expect(body.tomorrowFrogTaskId).toBeNull();
  });

  it("produces a body the server parser accepts", () => {
    const body = buildReviewBody({ ...args, moves: { ...args.moves } });
    expect(parseReviewPost(JSON.parse(JSON.stringify(body))).ok).toBe(true);
  });
});

describe("reviewSteps", () => {
  it("leaves out Unfinished and Frog when there is nothing to decide", () => {
    expect(reviewSteps(true, true)).toEqual(["done", "unfinished", "reflect", "frog"]);
    expect(reviewSteps(true, false)).toEqual(["done", "unfinished", "reflect"]);
    expect(reviewSteps(false, false)).toEqual(["done", "reflect"]);
    expect(reviewSteps(false, true)).toEqual(["done", "reflect", "frog"]);
  });
});

const frogTask = (completedAt: string | null, extra: object = {}) =>
  ({ id: "f", title: "Frog task", completedAt, archivedAt: null, ...extra }) as unknown as TodayPayload["frog"];
const pay = (o: Partial<TodayPayload> = {}) =>
  ({
    date: "2026-10-24",
    plan: null,
    frog: null,
    tasks: [],
    completedToday: [],
    openA: 0,
    streak: { current: 0, longest: 0 },
    ...o,
  }) as TodayPayload;

describe("frogOutcome", () => {
  it("is none without a frog and for an eliminated (archived, uneaten) one", () => {
    expect(frogOutcome(pay(), "Europe/Berlin")).toBe("none");
    expect(frogOutcome(pay({ frog: frogTask(null, { archivedAt: "2026-10-24T10:00:00Z" }) }), "Europe/Berlin")).toBe("none");
  });
  it("is eaten when completed on the date or before, not-eaten otherwise", () => {
    expect(frogOutcome(pay({ frog: frogTask("2026-10-24T07:00:00Z") }), "Europe/Berlin")).toBe("eaten");
    expect(frogOutcome(pay({ frog: frogTask("2026-10-20T07:00:00Z") }), "Europe/Berlin")).toBe("eaten");
    expect(frogOutcome(pay({ frog: frogTask(null) }), "Europe/Berlin")).toBe("not-eaten");
    expect(frogOutcome(pay({ frog: frogTask("2026-10-26T07:00:00Z") }), "Europe/Berlin")).toBe("not-eaten");
  });
  it("uses the time zone: 23:30 UTC is already tomorrow in Berlin", () => {
    expect(frogOutcome(pay({ frog: frogTask("2026-10-24T23:30:00Z") }), "Europe/Berlin")).toBe("not-eaten");
    expect(frogOutcome(pay({ frog: frogTask("2026-10-24T23:30:00Z") }), "America/New_York")).toBe("eaten");
  });
});

describe("doneTodayLine", () => {
  it("has distinct copy for every case", () => {
    const lines = [
      doneTodayLine(3, "eaten"),
      doneTodayLine(0, "not-eaten"),
      doneTodayLine(0, "none"),
      doneTodayLine(2, "not-eaten"),
      doneTodayLine(2, "none"),
    ];
    expect(new Set(lines).size).toBe(lines.length);
  });
  it("celebrates the frog even when nothing else (or nothing today) was completed", () => {
    expect(doneTodayLine(0, "eaten")).toMatch(/ate the frog/);
    expect(doneTodayLine(1, "eaten")).toMatch(/ate the frog/);
  });
  it("counts tasks and pluralises", () => {
    expect(doneTodayLine(1, "none")).toMatch(/^1 task done/);
    expect(doneTodayLine(4, "none")).toMatch(/^4 tasks done/);
    expect(doneTodayLine(1, "not-eaten")).toMatch(/frog is still waiting/);
  });
});

describe("sortDone", () => {
  const d = (id: string) => ({ id }) as unknown as TodayPayload["completedToday"][number];
  it("puts the frog first and keeps the rest in order", () => {
    expect(sortDone([d("a"), d("b"), d("c")], "c").map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
  it("leaves the order alone without a frog or when the frog isn't in the list", () => {
    expect(sortDone([d("a"), d("b")], null).map((t) => t.id)).toEqual(["a", "b"]);
    expect(sortDone([d("a"), d("b")], "x").map((t) => t.id)).toEqual(["a", "b"]);
    expect(sortDone([], "x")).toEqual([]);
  });
  it("does not mutate its input", () => {
    const input = [d("a"), d("b")];
    sortDone(input, "b");
    expect(input.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("summarizeReview and isReviewed", () => {
  it("summarises an eaten frog with a streak", () => {
    const s = summarizeReview(
      pay({ frog: frogTask("2026-10-24T07:00:00Z"), completedToday: [{}, {}] as never, streak: { current: 4, longest: 9 } }),
      "Europe/Berlin",
    );
    expect(s).toMatchObject({ outcome: "eaten", frogTitle: "Frog task", doneCount: 2, streakCurrent: 4, streakLongest: 9 });
    expect(s.streakText).toBe("🔥 4-day frog streak");
  });
  it("has a gentle line when no streak is running", () => {
    const s = summarizeReview(pay(), "Europe/Berlin");
    expect(s).toMatchObject({ outcome: "none", frogTitle: null, doneCount: 0, streakCurrent: 0 });
    expect(s.streakText).toMatch(/No frog streak yet/);
  });
  it("isReviewed follows plan.reviewedAt", () => {
    expect(isReviewed({ plan: null })).toBe(false);
    expect(isReviewed({ plan: { reviewedAt: null } as never })).toBe(false);
    expect(isReviewed({ plan: { reviewedAt: "2026-10-24T20:00:00Z" } as never })).toBe(true);
  });
});
