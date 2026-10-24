// M5: POST /api/today/review. Real handler + real Postgres. Every test asserts the
// DB state afterwards, and every rejection asserts that NOTHING was written
// (snapshot of tasks, plans, activity and comments, like today-put.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { POST as postReview } from "@/app/api/today/review/route";
import {
  DATE,
  TZ,
  get,
  snapshot,
  seedForeignUser,
  expectNoForeignData,
  ids,
  titles,
  type Json,
} from "./today-helpers";

const TOMORROW = "2026-10-25";

function reviewRaw(raw: string) {
  return postReview(
    new Request("http://localhost/api/today/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    }),
  );
}
const review = (body: unknown) => reviewRaw(JSON.stringify(body));

const taskRow = (id: string) => db.task.findUnique({ where: { id } });
const planRow = (date = DATE, userId = "owner-1") => db.dailyPlan.findUnique({ where: { userId_date: { userId, date } } });
const archivedActivity = () => db.activity.findMany({ where: { action: "archived" }, orderBy: { id: "asc" } });

describe("POST /api/today/review", () => {
  let T: Record<string, { id: string; [k: string]: unknown }>;
  let H: Record<string, { id: string; [k: string]: unknown }>;
  let base: { date: string; tz: string; moves: { taskId: string; action: string }[] };
  let before: Awaited<ReturnType<typeof snapshot>>;
  let foreign: Awaited<ReturnType<typeof seedForeignUser>>;

  beforeEach(async () => {
    const seeded = await seedGroup("owner-1", {
      groupName: "Work",
      tasks: [
        { title: "T1", extra: { plannedFor: DATE, abcde: "A", abcdeRank: 1 } },
        { title: "T2", extra: { plannedFor: DATE, abcde: "B" } },
        { title: "T3", extra: { plannedFor: DATE } },
        { title: "T4", extra: { plannedFor: DATE, abcde: "C", abcdeRank: 3 } },
        { title: "Parent", extra: { plannedFor: DATE } },
        { title: "Sub1", parentTitle: "Parent" },
        { title: "Sub2", parentTitle: "Parent" },
        { title: "SubGone", parentTitle: "Parent", deletedAt: new Date("2026-10-01T00:00:00Z") },
        { title: "DoneT", status: "Done", completedAt: new Date("2026-10-24T14:00:00Z"), extra: { plannedFor: DATE, abcde: "B" } },
        { title: "Backlog" },
        { title: "Later", extra: { plannedFor: "2026-10-30" } },
        { title: "Trashed", deletedAt: new Date("2026-10-01T00:00:00Z"), extra: { plannedFor: DATE } },
        { title: "Archived", archivedAt: new Date("2026-10-01T00:00:00Z"), extra: { plannedFor: DATE } },
      ],
    });
    T = seeded.tasks;
    const home = await seedGroup("owner-1", {
      groupName: "Home",
      tasks: [{ title: "H1", extra: { plannedFor: DATE } }, { title: "H2", extra: { plannedFor: DATE } }],
    });
    H = home.tasks;
    foreign = await seedForeignUser();
    // A plan another user has for the same day, and for tomorrow: must never be touched.
    await db.dailyPlan.create({ data: { userId: "stranger", date: TOMORROW, frogTaskId: foreign.tasks["SECRET backlog"].id } });
    // State a bad request must not disturb: today's plan with a frog, a reflection and a stamp.
    await db.dailyPlan.create({
      data: {
        userId: "owner-1",
        date: DATE,
        frogTaskId: T["T1"].id,
        plannedAt: new Date("2026-10-24T07:00:00Z"),
        wentWell: "kept well",
        improve: "kept improve",
        rating: 4,
      },
    });
    base = { date: DATE, tz: TZ, moves: [] };
    signInAs("owner-1");
    before = await snapshot();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Asserts a request was rejected with `status` and left the database exactly as it was. */
  async function expectRejected(res: Response, status: number) {
    expect(res.status).toBe(status);
    const b = await res.json();
    expect(typeof b.error).toBe("string");
    expect(await snapshot()).toEqual(before);
    return b;
  }

  const move = (title: string, action: string, group = T) => ({ taskId: group[title].id, action });

  // ───────────────────────────── auth ─────────────────────────────

  describe("auth", () => {
    it("401 with no user, nothing written", async () => {
      setFakeUser(null);
      await expectRejected(await review({ ...base, moves: [move("T2", "archive")], wentWell: "x" }), 401);
    });
    it("401 comes before body parsing", async () => {
      setFakeUser(null);
      await expectRejected(await reviewRaw("not json"), 401);
    });
  });

  // ───────────────────────────── 400 ─────────────────────────────

  describe("400 for invalid input, and nothing is written", () => {
    const withoutKey = (k: string) => {
      const { [k]: _omitted, ...rest } = { ...base } as Json; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    };

    it.each([
      ["missing", undefined],
      ["null", null],
      ["empty", ""],
      ["a number", 20261024],
      ["unpadded", "2026-1-5"],
      ["impossible day", "2026-02-30"],
      ["impossible month", "2026-13-01"],
      ["datetime", "2026-10-24T10:00:00Z"],
      ["padded with space", " 2026-10-24"],
      ["garbage", "tomorrow"],
      ["an array", ["2026-10-24"]],
    ])("date %s", async (_name, date) => {
      const b = date === undefined ? withoutKey("date") : { ...base, date };
      await expectRejected(await review(b), 400);
    });

    it.each(["0000-01-01", "0001-01-01", "0001-01-02", "9998-12-29", "9998-12-30", "9999-12-31"])("date %s is outside the supported range (or has no supported tomorrow)", async (date) => {
      await expectRejected(await review({ ...base, date, wentWell: "must not be saved" }), 400);
    });

    it.each([
      ["missing", undefined],
      ["null", null],
      ["empty", ""],
      ["unknown zone", "Mars/Olympus"],
      ["an offset", "+05:00"],
      ["a number", 5],
      ["an object", {}],
    ])("tz %s", async (_name, tz) => {
      const b = tz === undefined ? withoutKey("tz") : { ...base, tz };
      await expectRejected(await review(b), 400);
    });

    it.each([
      ["missing", undefined],
      ["null", null],
      ["a string", "x"],
      ["an object", {}],
      ["a number", 1],
    ])("moves %s", async (_name, moves) => {
      const b = moves === undefined ? withoutKey("moves") : { ...base, moves };
      await expectRejected(await review(b), 400);
    });

    it("a move that is not an object / lacks taskId / has a bad taskId", async () => {
      for (const m of [null, "T2", 5, [], { action: "tomorrow" }, { taskId: "", action: "tomorrow" }, { taskId: 5, action: "tomorrow" }, { taskId: null, action: "tomorrow" }, { taskId: ["a"], action: "tomorrow" }]) {
        await expectRejected(await review({ ...base, moves: [m] }), 400);
      }
    });

    it("a move with a missing or unknown action", async () => {
      for (const action of [undefined, null, "", "delete", "TOMORROW", "Tomorrow", "done", 1, ["archive"]]) {
        await expectRejected(await review({ ...base, moves: [{ taskId: T["T2"].id, action }] }), 400);
      }
    });

    it("a bad move after valid ones writes none of them", async () => {
      await expectRejected(await review({ ...base, moves: [move("T2", "archive"), move("T3", "backlog"), { taskId: T["T4"].id, action: "nope" }] }), 400);
    });

    it("duplicate taskIds, with the same or a different action", async () => {
      await expectRejected(await review({ ...base, moves: [move("T2", "tomorrow"), move("T2", "tomorrow")] }), 400);
      await expectRejected(await review({ ...base, moves: [move("T2", "tomorrow"), move("T3", "backlog"), move("T2", "archive")] }), 400);
    });

    it("more than 200 moves, also when the first 200 are real", async () => {
      const many = Array.from({ length: 201 }, (_, i) => ({ taskId: `nope-${i}`, action: "backlog" }));
      await expectRejected(await review({ ...base, moves: many }), 400);
      const real = Array.from({ length: 200 }, (_, i) => ({ taskId: `nope-${i}`, action: "backlog" }));
      await expectRejected(await review({ ...base, moves: [...real, move("T2", "backlog")] }), 400);
    });

    it.each(["wentWell", "improve"])("%s that is not a string", async (field) => {
      for (const v of [5, true, {}, ["a"], 0, false]) {
        await expectRejected(await review({ ...base, [field]: v }), 400);
      }
    });

    it.each(["wentWell", "improve"])("%s over 2000 characters, counted after trimming", async (field) => {
      await expectRejected(await review({ ...base, [field]: "x".repeat(2001) }), 400);
      await expectRejected(await review({ ...base, [field]: `  ${"x".repeat(2001)}  ` }), 400);
      await expectRejected(await review({ ...base, [field]: "x".repeat(100_000) }), 400);
    });

    it("an over-long field rejects the whole request, valid moves and reflection included", async () => {
      await expectRejected(await review({ ...base, moves: [move("T2", "archive")], wentWell: "fine", improve: "y".repeat(2001), rating: 5 }), 400);
    });

    it.each([0, 6, -1, 1.5, 5.0001, "3", "", true, false, {}, [], [3], 1e9])("rating %j", async (rating) => {
      await expectRejected(await review({ ...base, rating }), 400);
    });

    it("tomorrowFrogTaskId of the wrong type", async () => {
      for (const v of [5, true, false, {}, [], [T["T2"].id], ""]) {
        await expectRejected(await review({ ...base, tomorrowFrogTaskId: v }), 400);
      }
    });

    it("the tomorrow frog is also moved to the backlog or archived", async () => {
      for (const action of ["backlog", "archive"]) {
        await expectRejected(
          await review({ ...base, moves: [move("T2", action), move("T3", "tomorrow")], tomorrowFrogTaskId: T["T2"].id, wentWell: "no" }),
          400,
        );
      }
    });

    it("non-JSON, empty and non-object bodies", async () => {
      await expectRejected(await reviewRaw("not json"), 400);
      await expectRejected(await reviewRaw(""), 400);
      await expectRejected(await reviewRaw("{"), 400);
      for (const raw of ["null", "[]", "[{}]", '"str"', "5", "true"]) await expectRejected(await reviewRaw(raw), 400);
    });

    it("bad input is a 400 even when a task id in moves is also unknown (validation first)", async () => {
      await expectRejected(await review({ ...base, moves: [{ taskId: "nope", action: "tomorrow" }], rating: 9 }), 400);
    });

    it("text containing a NUL character (Postgres can't store it) is a 400, not a 500", async () => {
      let res: Response | undefined;
      let thrown: unknown;
      try {
        res = await review({ ...base, wentWell: "a\u0000b" });
      } catch (e) {
        thrown = e;
      }
      expect(thrown, "handler threw (a 500) for a NUL in wentWell").toBeUndefined();
      expect(res!.status).toBe(400);
      expect(await snapshot()).toEqual(before);
    });

    it("a NUL character in a task id is a 404 or 400, not a 500", async () => {
      let res: Response | undefined;
      let thrown: unknown;
      try {
        res = await review({ ...base, moves: [{ taskId: "a\u0000b", action: "tomorrow" }] });
      } catch (e) {
        thrown = e;
      }
      expect(thrown, "handler threw (a 500) for a NUL in a taskId").toBeUndefined();
      expect([400, 404]).toContain(res!.status);
      expect(await snapshot()).toEqual(before);
    });
  });

  // ───────────────────────────── 404 ─────────────────────────────

  describe("404 when any task id isn't the caller's plain, live, top-level task; nothing is written", () => {
    const reflection = { wentWell: "w", improve: "i", rating: 2 };

    it("another user's task in moves", async () => {
      for (const action of ["tomorrow", "backlog", "archive"]) {
        await expectRejected(await review({ ...base, moves: [{ taskId: foreign.tasks["SECRET planned"].id, action }], ...reflection }), 404);
      }
    });

    it("another user's task, mixed with valid ones in any position", async () => {
      const bad = { taskId: foreign.tasks["SECRET backlog"].id, action: "archive" };
      await expectRejected(await review({ ...base, moves: [move("T2", "archive"), move("T3", "backlog"), bad], ...reflection }), 404);
      await expectRejected(await review({ ...base, moves: [bad, move("T2", "archive")], ...reflection }), 404);
      await expectRejected(await review({ ...base, moves: [move("T2", "tomorrow"), bad, move("T3", "tomorrow")], tomorrowFrogTaskId: T["T2"].id }), 404);
    });

    it("a subtask (of the caller's own task), as a move and as the tomorrow frog", async () => {
      await expectRejected(await review({ ...base, moves: [move("Sub1", "archive"), move("T2", "backlog")], ...reflection }), 404);
      await expectRejected(await review({ ...base, moves: [], tomorrowFrogTaskId: T["Sub1"].id, ...reflection }), 404);
    });

    it("another user's subtask", async () => {
      await expectRejected(await review({ ...base, moves: [{ taskId: foreign.tasks["SECRET frog sub"].id, action: "tomorrow" }] }), 404);
    });

    it("a trashed task", async () => {
      await expectRejected(await review({ ...base, moves: [move("Trashed", "backlog"), move("T2", "backlog")], ...reflection }), 404);
      await expectRejected(await review({ ...base, tomorrowFrogTaskId: T["Trashed"].id }), 404);
    });

    it("an archived task, including a repeated archive", async () => {
      await expectRejected(await review({ ...base, moves: [move("Archived", "tomorrow"), move("T2", "tomorrow")], ...reflection }), 404);
      await expectRejected(await review({ ...base, moves: [move("Archived", "archive")] }), 404);
      await expectRejected(await review({ ...base, tomorrowFrogTaskId: T["Archived"].id }), 404);
    });

    it("an unknown id, a long id, and an id that merely looks like a real one", async () => {
      await expectRejected(await review({ ...base, moves: [{ taskId: "nope", action: "tomorrow" }], ...reflection }), 404);
      await expectRejected(await review({ ...base, moves: [{ taskId: "x".repeat(10_000), action: "tomorrow" }] }), 404);
      await expectRejected(await review({ ...base, moves: [{ taskId: T["T2"].id.toUpperCase(), action: "tomorrow" }] }), 404);
      await expectRejected(await review({ ...base, moves: [{ taskId: ` ${T["T2"].id}`, action: "tomorrow" }] }), 404);
    });

    it("an unknown or foreign tomorrowFrogTaskId, alone or with valid moves", async () => {
      await expectRejected(await review({ ...base, tomorrowFrogTaskId: "nope", ...reflection }), 404);
      await expectRejected(await review({ ...base, tomorrowFrogTaskId: foreign.tasks["SECRET frog"].id, ...reflection }), 404);
      await expectRejected(await review({ ...base, moves: [move("T2", "tomorrow"), move("T3", "archive")], tomorrowFrogTaskId: foreign.tasks["SECRET planned"].id, ...reflection }), 404);
      await expectRejected(await review({ ...base, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: "nope" }), 404);
    });

    it("nothing leaks into the 404 body", async () => {
      const b = await expectRejected(await review({ ...base, moves: [{ taskId: foreign.tasks["SECRET planned"].id, action: "archive" }] }), 404);
      expectNoForeignData(b, foreign);
    });

    it("a 404 writes no plan for a day that had none, no reviewedAt, no activity, and leaves plannedFor alone", async () => {
      const day = "2026-11-10";
      const snap = await snapshot();
      const res = await review({ date: day, tz: TZ, moves: [move("T2", "tomorrow"), { taskId: "nope", action: "archive" }], wentWell: "x", tomorrowFrogTaskId: T["T2"].id });
      expect(res.status).toBe(404);
      expect(await snapshot()).toEqual(snap);
      expect(await planRow(day)).toBeNull();
      expect(await planRow("2026-11-11")).toBeNull();
      expect(await db.activity.count()).toBe(snap.activity.length);
      expect((await taskRow(T["T2"].id)).plannedFor).toBe(DATE);
    });
  });

  // ───────────────────────────── moves ─────────────────────────────

  describe("moves", () => {
    it("tomorrow: plannedFor = date + 1, everything else on the task is unchanged", async () => {
      const t = await taskRow(T["T1"].id);
      const res = await review({ ...base, moves: [move("T1", "tomorrow"), move("T2", "tomorrow")] });
      expect(res.status).toBe(200);
      const after = await taskRow(T["T1"].id);
      expect(after.plannedFor).toBe(TOMORROW);
      expect({ ...after, plannedFor: null, updatedAt: null }).toEqual({ ...t, plannedFor: null, updatedAt: null });
      expect((await taskRow(T["T2"].id)).plannedFor).toBe(TOMORROW);
      expect(await db.activity.count()).toBe(before.activity.length); // moving writes no activity
    });

    it("backlog: plannedFor = null; the letter, rank and status stay", async () => {
      const t = await taskRow(T["T1"].id);
      expect((await review({ ...base, moves: [move("T1", "backlog"), move("T3", "backlog")] })).status).toBe(200);
      const after = await taskRow(T["T1"].id);
      expect(after.plannedFor).toBeNull();
      expect({ ...after, plannedFor: null, updatedAt: null }).toEqual({ ...t, plannedFor: null, updatedAt: null });
      expect((await taskRow(T["T3"].id)).plannedFor).toBeNull();
    });

    it("archive: archivedAt is set on the task and on its subtasks, with one 'archived' activity row per task", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T20:15:00Z"));
      const res = await review({ ...base, moves: [move("Parent", "archive"), move("T3", "archive")] });
      expect(res.status).toBe(200);
      const at = new Date("2026-10-24T20:15:00Z");
      expect((await taskRow(T["Parent"].id)).archivedAt).toEqual(at);
      expect((await taskRow(T["Sub1"].id)).archivedAt).toEqual(at);
      expect((await taskRow(T["Sub2"].id)).archivedAt).toEqual(at);
      expect((await taskRow(T["T3"].id)).archivedAt).toEqual(at);
      // plannedFor is left as it was
      expect((await taskRow(T["Parent"].id)).plannedFor).toBe(DATE);
      expect((await taskRow(T["T3"].id)).plannedFor).toBe(DATE);
      const acts = await archivedActivity();
      expect(acts.map((a: Json) => a.taskId).sort()).toEqual([T["Parent"].id, T["T3"].id].sort());
      for (const a of acts) expect(a).toMatchObject({ userId: "owner-1", action: "archived" });
      expect(acts.map((a: Json) => a.taskId)).not.toContain(T["Sub1"].id);
    });

    it("archive matches what PATCH {archived:true} does: same columns, same activity", async () => {
      const { PATCH } = await import("@/app/api/tasks/[id]/route");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T20:15:00Z"));
      await review({ ...base, moves: [move("Parent", "archive")] });
      const viaReview = [await taskRow(T["Parent"].id), await taskRow(T["Sub1"].id), (await archivedActivity())[0]];
      // an equivalent task archived through the existing route
      const eq = await seedGroup("owner-1", { tasks: [{ title: "P2" }, { title: "S2", parentTitle: "P2" }] });
      await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ archived: true }) }), { params: Promise.resolve({ id: eq.tasks["P2"].id }) });
      const p2 = await taskRow(eq.tasks["P2"].id);
      const s2 = await taskRow(eq.tasks["S2"].id);
      expect(p2.archivedAt).toEqual(viaReview[0].archivedAt);
      expect(s2.archivedAt).toEqual(viaReview[1].archivedAt);
      const a2 = (await db.activity.findMany({ where: { taskId: eq.tasks["P2"].id } }))[0];
      expect({ action: a2.action, userId: a2.userId, metadata: a2.metadata }).toEqual({ action: viaReview[2].action, userId: viaReview[2].userId, metadata: viaReview[2].metadata });
    });

    it("archive does not touch completedAt, status or the letter, and an archived done task stays in completedToday", async () => {
      const done = await taskRow(T["DoneT"].id);
      const res = await review({ ...base, moves: [move("DoneT", "archive")] });
      expect(res.status).toBe(200);
      const after = await taskRow(T["DoneT"].id);
      expect(after.completedAt).toEqual(done.completedAt);
      expect(after.statusId).toBe(done.statusId);
      expect(after.abcde).toBe("B");
      expect(after.archivedAt).not.toBeNull();
      const b: Json = await res.json();
      expect(titles(b.completedToday)).toContain("DoneT");
      expect(titles(b.tasks)).not.toContain("DoneT");
    });

    it("done tasks may be moved: completedAt is never cleared", async () => {
      const done = await taskRow(T["DoneT"].id);
      expect((await review({ ...base, moves: [move("DoneT", "tomorrow")] })).status).toBe(200);
      let after = await taskRow(T["DoneT"].id);
      expect(after.plannedFor).toBe(TOMORROW);
      expect(after.completedAt).toEqual(done.completedAt);
      expect((await review({ ...base, moves: [move("DoneT", "backlog")] })).status).toBe(200);
      after = await taskRow(T["DoneT"].id);
      expect(after.plannedFor).toBeNull();
      expect(after.completedAt).toEqual(done.completedAt);
      expect(after.statusId).toBe(done.statusId);
    });

    it("tasks not named in moves stay untouched (still planned for today)", async () => {
      await review({ ...base, moves: [move("T2", "backlog")] });
      for (const name of ["T1", "T3", "T4", "Parent", "DoneT"]) expect((await taskRow(T[name].id)).plannedFor).toBe(DATE);
      expect((await taskRow(H["H1"].id)).plannedFor).toBe(DATE);
      expect((await taskRow(T["Later"].id)).plannedFor).toBe("2026-10-30");
      expect((await taskRow(T["Backlog"].id)).plannedFor).toBeNull();
      // untouched rows are byte-for-byte equal (incl. updatedAt)
      const snap = await snapshot();
      const was = (name: string) => before.tasks.find((t: Json) => t.id === T[name].id);
      const now = (name: string) => snap.tasks.find((t: Json) => t.id === T[name].id);
      for (const name of ["T1", "T3", "T4", "Parent", "Sub1", "DoneT", "Backlog", "Later", "Trashed", "Archived"]) expect(now(name)).toEqual(was(name));
    });

    it("one request can mix every action, across projects", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T21:00:00Z"));
      const res = await review({
        ...base,
        moves: [move("T2", "tomorrow"), move("T3", "backlog"), move("T4", "archive"), move("H1", "tomorrow", H), move("H2", "archive", H)],
      });
      expect(res.status).toBe(200);
      expect((await taskRow(T["T2"].id)).plannedFor).toBe(TOMORROW);
      expect((await taskRow(H["H1"].id)).plannedFor).toBe(TOMORROW);
      expect((await taskRow(T["T3"].id)).plannedFor).toBeNull();
      expect((await taskRow(T["T4"].id)).archivedAt).not.toBeNull();
      expect((await taskRow(H["H2"].id)).archivedAt).not.toBeNull();
      expect((await archivedActivity()).length).toBe(2);
      // the response no longer lists the moved/archived tasks as today's
      const b: Json = await res.json();
      expect(titles(b.tasks).sort()).toEqual(["DoneT", "Parent", "T1"]);
    });

    it("a task that isn't planned for today can still be moved (backlog item to tomorrow, 'Later' to tomorrow)", async () => {
      expect((await review({ ...base, moves: [move("Backlog", "tomorrow"), move("Later", "tomorrow")] })).status).toBe(200);
      expect((await taskRow(T["Backlog"].id)).plannedFor).toBe(TOMORROW);
      expect((await taskRow(T["Later"].id)).plannedFor).toBe(TOMORROW);
    });

    it("moving a task that is already planned for tomorrow to tomorrow is a no-op for plannedFor", async () => {
      await db.task.update({ where: { id: T["T2"].id }, data: { plannedFor: TOMORROW } });
      expect((await review({ ...base, moves: [move("T2", "tomorrow")] })).status).toBe(200);
      expect((await taskRow(T["T2"].id)).plannedFor).toBe(TOMORROW);
    });

    it("an empty moves array writes no task changes", async () => {
      expect((await review({ ...base, moves: [] })).status).toBe(200);
      const snap = await snapshot();
      expect(snap.tasks).toEqual(before.tasks);
      expect(snap.activity).toEqual(before.activity);
    });

    it("the archived task is gone from the next GET /api/today", async () => {
      await review({ ...base, moves: [move("T2", "archive")] });
      const b: Json = await (await get()).json();
      expect(ids(b.tasks)).not.toContain(T["T2"].id);
    });

    it("extra unknown keys in the body or in a move are ignored", async () => {
      const res = await review({ ...base, moves: [{ ...move("T2", "backlog"), plannedFor: "2030-01-01", archivedAt: "x" }], foo: 1, userId: "stranger" });
      expect(res.status).toBe(200);
      expect((await taskRow(T["T2"].id)).plannedFor).toBeNull();
      expect((await planRow()).userId).toBe("owner-1");
      expect((await planRow(DATE, "stranger")).wentWell).toBe("SECRET reflection"); // theirs, untouched
    });
  });

  describe("tomorrow is date + 1 on the calendar, whatever the time zone", () => {
    it.each([
      ["2026-10-31", "2026-11-01", TZ],
      ["2026-12-31", "2027-01-01", TZ],
      ["2027-02-28", "2027-03-01", TZ],
      ["2028-02-28", "2028-02-29", TZ],
      ["2028-02-29", "2028-03-01", TZ],
      ["2100-02-28", "2100-03-01", TZ], // 2100 is not a leap year
      ["2000-02-28", "2000-02-29", TZ],
      ["2026-03-28", "2026-03-29", "Europe/Berlin"], // the day before the spring-forward day
      ["2026-03-29", "2026-03-30", "Europe/Berlin"], // 23-hour day
      ["2026-10-24", "2026-10-25", "Europe/Berlin"],
      ["2026-10-25", "2026-10-26", "Europe/Berlin"], // 25-hour day
      ["2026-03-08", "2026-03-09", "America/New_York"],
      ["2026-11-01", "2026-11-02", "America/New_York"],
      ["2026-04-04", "2026-04-05", "Australia/Sydney"], // southern-hemisphere DST end
      ["2026-09-26", "2026-09-27", "Pacific/Auckland"],
      ["2011-12-29", "2011-12-30", "Pacific/Apia"], // Samoa skipped 2011-12-30 entirely
      ["2026-10-24", "2026-10-25", "Pacific/Kiritimati"], // UTC+14
      ["2026-10-24", "2026-10-25", "Etc/GMT+12"], // UTC-12
      ["2026-10-24", "2026-10-25", "UTC"],
      ["0001-01-03", "0001-01-04", "UTC"],
      ["9998-12-28", "9998-12-29", "UTC"],
    ])("%s -> %s (%s)", async (date, tomorrow, tz) => {
      const res = await review({ date, tz, moves: [move("T2", "tomorrow")] });
      expect(res.status).toBe(200);
      expect((await taskRow(T["T2"].id)).plannedFor).toBe(tomorrow);
      expect((await res.json()).date).toBe(date);
      expect(await planRow(date)).not.toBeNull();
    });

    it("tomorrow's frog goes to the plan of date + 1 across a year boundary", async () => {
      expect((await review({ date: "2026-12-31", tz: TZ, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: T["T2"].id })).status).toBe(200);
      expect((await planRow("2027-01-01")).frogTaskId).toBe(T["T2"].id);
      expect(await planRow("2026-12-32")).toBeNull();
    });

    it("the same date in different zones gives the same tomorrow", async () => {
      for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12", "Europe/Berlin"]) {
        await db.task.update({ where: { id: T["T2"].id }, data: { plannedFor: DATE } });
        await review({ ...base, tz, moves: [move("T2", "tomorrow")] });
        expect((await taskRow(T["T2"].id)).plannedFor).toBe(TOMORROW);
      }
    });
  });

  // ───────────────────────────── reflection ─────────────────────────────

  describe("reflection fields", () => {
    it("are saved on an existing plan (trimmed), without touching the frog or plannedAt", async () => {
      const res = await review({ ...base, wentWell: "  shipped it \n", improve: "\tstart earlier", rating: 5 });
      expect(res.status).toBe(200);
      const p = await planRow();
      expect(p).toMatchObject({ wentWell: "shipped it", improve: "start earlier", rating: 5, frogTaskId: T["T1"].id });
      expect(p.plannedAt).toEqual(new Date("2026-10-24T07:00:00Z"));
      expect(p.reviewedAt).toBeInstanceOf(Date);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: DATE } })).toBe(1);
    });

    it("keep inner whitespace and newlines, emoji and non-latin text", async () => {
      const text = "line one\n\n  line  two 🐸\n日本語 ✓";
      await review({ ...base, wentWell: text, improve: "é x" });
      expect((await planRow()).wentWell).toBe(text);
      expect((await planRow()).improve).toBe("é x");
    });

    it("omitted fields leave the stored values alone", async () => {
      await review({ ...base });
      expect(await planRow()).toMatchObject({ wentWell: "kept well", improve: "kept improve", rating: 4 });
      await review({ ...base, wentWell: "new" });
      expect(await planRow()).toMatchObject({ wentWell: "new", improve: "kept improve", rating: 4 });
      await review({ ...base, improve: "newer" });
      expect(await planRow()).toMatchObject({ wentWell: "new", improve: "newer", rating: 4 });
      await review({ ...base, rating: 1 });
      expect(await planRow()).toMatchObject({ wentWell: "new", improve: "newer", rating: 1 });
    });

    it("null clears each field independently", async () => {
      await review({ ...base, wentWell: null });
      expect(await planRow()).toMatchObject({ wentWell: null, improve: "kept improve", rating: 4 });
      await review({ ...base, improve: null });
      expect(await planRow()).toMatchObject({ wentWell: null, improve: null, rating: 4 });
      await review({ ...base, rating: null });
      expect(await planRow()).toMatchObject({ wentWell: null, improve: null, rating: null });
    });

    it("null clears everything at once", async () => {
      await review({ ...base, wentWell: null, improve: null, rating: null });
      expect(await planRow()).toMatchObject({ wentWell: null, improve: null, rating: null });
    });

    it("empty and whitespace-only text is stored as null, not as an empty string", async () => {
      await review({ ...base, wentWell: "", improve: " \n\t " });
      const p = await planRow();
      expect(p.wentWell).toBeNull();
      expect(p.improve).toBeNull();
      expect(p.rating).toBe(4);
    });

    it("text of exactly 2000 characters is saved whole; with padding it is trimmed first", async () => {
      const max = "x".repeat(2000);
      expect((await review({ ...base, wentWell: max, improve: `   ${max}   ` })).status).toBe(200);
      const p = await planRow();
      expect(p.wentWell).toBe(max);
      expect(p.improve).toBe(max);
    });

    it("2000 UTF-16 units of emoji (1000 of them) is accepted; 1001 is not", async () => {
      expect((await review({ ...base, wentWell: "🐸".repeat(1000) })).status).toBe(200);
      expect((await planRow()).wentWell).toBe("🐸".repeat(1000));
      await expectRejected400();
      async function expectRejected400() {
        const snap = await snapshot();
        expect((await review({ ...base, wentWell: "🐸".repeat(1001) })).status).toBe(400);
        expect(await snapshot()).toEqual(snap);
      }
    });

    it.each([1, 2, 3, 4, 5])("rating %i is stored", async (rating) => {
      expect((await review({ ...base, rating })).status).toBe(200);
      expect((await planRow()).rating).toBe(rating);
    });

    it("a text that looks like JSON, SQL or HTML is stored verbatim", async () => {
      const t = `'); DROP TABLE "DailyPlan";-- <script>alert(1)</script> {"a":1} \\n`;
      expect((await review({ ...base, wentWell: t })).status).toBe(200);
      expect((await planRow()).wentWell).toBe(t.trim());
      expect(await db.dailyPlan.count()).toBeGreaterThan(0);
    });

    it("every new column is read and written: wentWell, improve, rating, reviewedAt, frogTaskId on a fresh plan", async () => {
      const day = "2026-11-20";
      await review({ date: day, tz: TZ, moves: [], wentWell: "a", improve: "b", rating: 3 });
      const p = await planRow(day);
      expect(p).toMatchObject({ userId: "owner-1", date: day, wentWell: "a", improve: "b", rating: 3, frogTaskId: null, plannedAt: null });
      expect(p.reviewedAt).toBeInstanceOf(Date);
    });
  });

  describe("reviewedAt and the plan itself", () => {
    it("reviewedAt is stamped with the server time; the frog and plannedAt of an existing plan are untouched", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T20:30:00Z"));
      expect((await review(base)).status).toBe(200);
      const p = await planRow();
      expect(p.reviewedAt).toEqual(new Date("2026-10-24T20:30:00Z"));
      expect(p.frogTaskId).toBe(T["T1"].id);
      expect(p.plannedAt).toEqual(new Date("2026-10-24T07:00:00Z"));
      expect(p.createdAt).toEqual(before.plans.find((x: Json) => x.date === DATE && x.userId === "owner-1").createdAt);
    });

    it("every POST re-stamps reviewedAt", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T20:30:00Z"));
      await review(base);
      vi.setSystemTime(new Date("2026-10-24T22:45:00Z"));
      await review(base);
      expect((await planRow()).reviewedAt).toEqual(new Date("2026-10-24T22:45:00Z"));
    });

    it("a missing plan is created with a null frog and a null plannedAt (so the day still counts as unplanned)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-20T20:00:00Z"));
      const day = "2026-11-20";
      expect(await planRow(day)).toBeNull();
      const res = await review({ date: day, tz: TZ, moves: [], rating: 2 });
      expect(res.status).toBe(200);
      expect(await planRow(day)).toMatchObject({ frogTaskId: null, plannedAt: null, rating: 2, wentWell: null, improve: null, reviewedAt: new Date("2026-11-20T20:00:00Z") });
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: day } })).toBe(1);
      const b: Json = await res.json();
      expect(b.plan).toMatchObject({ rating: 2, frogTaskId: null, plannedAt: null });
      expect(b.plan.reviewedAt).toBe("2026-11-20T20:00:00.000Z");
    });

    it("a review of a missing plan with omitted reflection creates a plan with null reflections", async () => {
      await review({ date: "2026-11-21", tz: TZ, moves: [] });
      expect(await planRow("2026-11-21")).toMatchObject({ wentWell: null, improve: null, rating: null });
    });

    it("only the caller's plan is written: another user's plan for the same date is untouched", async () => {
      await db.dailyPlan.update({ where: { userId_date: { userId: "stranger", date: DATE } }, data: { rating: 1 } });
      const theirs = await planRow(DATE, "stranger");
      await review({ ...base, wentWell: "mine", rating: 5 });
      expect(await planRow(DATE, "stranger")).toEqual(theirs);
      expect(await planRow()).toMatchObject({ wentWell: "mine", rating: 5 });
    });

    it("the whole foreign data set is untouched by a busy review", async () => {
      const foreignBefore = async () => ({
        tasks: (await snapshot()).tasks.filter((t: Json) => (t.createdBy as string) === "stranger"),
        plans: (await snapshot()).plans.filter((p: Json) => p.userId === "stranger"),
      });
      const prior = await foreignBefore();
      await review({ ...base, moves: [move("T2", "tomorrow"), move("T3", "archive"), move("T4", "backlog")], tomorrowFrogTaskId: T["T2"].id, wentWell: "x", rating: 3 });
      expect(await foreignBefore()).toEqual(prior);
    });
  });

  // ───────────────────────────── tomorrow's frog ─────────────────────────────

  describe("tomorrow's frog", () => {
    it("sets plannedFor = tomorrow and creates tomorrow's plan with only the frog", async () => {
      expect(await planRow(TOMORROW)).toBeNull();
      const res = await review({ ...base, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: T["T2"].id });
      expect(res.status).toBe(200);
      expect((await taskRow(T["T2"].id)).plannedFor).toBe(TOMORROW);
      const p = await planRow(TOMORROW);
      expect(p).toMatchObject({ userId: "owner-1", date: TOMORROW, frogTaskId: T["T2"].id, plannedAt: null, reviewedAt: null, wentWell: null, improve: null, rating: null });
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: TOMORROW } })).toBe(1);
    });

    it("works for a task that isn't in moves: it is planned for tomorrow too", async () => {
      expect((await review({ ...base, tomorrowFrogTaskId: T["Backlog"].id })).status).toBe(200);
      expect((await taskRow(T["Backlog"].id)).plannedFor).toBe(TOMORROW);
      expect((await planRow(TOMORROW)).frogTaskId).toBe(T["Backlog"].id);
    });

    it("works for a task that's planned for another day (it moves to tomorrow)", async () => {
      expect((await review({ ...base, tomorrowFrogTaskId: T["Later"].id })).status).toBe(200);
      expect((await taskRow(T["Later"].id)).plannedFor).toBe(TOMORROW);
    });

    it("works for a done task (its completedAt is kept)", async () => {
      const done = await taskRow(T["DoneT"].id);
      expect((await review({ ...base, tomorrowFrogTaskId: T["DoneT"].id })).status).toBe(200);
      expect((await taskRow(T["DoneT"].id)).completedAt).toEqual(done.completedAt);
      expect((await planRow(TOMORROW)).frogTaskId).toBe(T["DoneT"].id);
    });

    it("an existing tomorrow plan keeps its plannedAt and reflection; only the frog changes", async () => {
      await db.dailyPlan.create({
        data: { userId: "owner-1", date: TOMORROW, frogTaskId: T["T4"].id, plannedAt: new Date("2026-10-24T18:00:00Z"), wentWell: "w", improve: "i", rating: 2, reviewedAt: new Date("2026-10-25T20:00:00Z") },
      });
      expect((await review({ ...base, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: T["T2"].id })).status).toBe(200);
      const p = await planRow(TOMORROW);
      expect(p.frogTaskId).toBe(T["T2"].id);
      expect(p.plannedAt).toEqual(new Date("2026-10-24T18:00:00Z"));
      expect(p).toMatchObject({ wentWell: "w", improve: "i", rating: 2 });
      expect(p.reviewedAt).toEqual(new Date("2026-10-25T20:00:00Z"));
    });

    it("an earlier tomorrow frog is replaced; the old frog stays planned for tomorrow", async () => {
      await db.task.update({ where: { id: T["T4"].id }, data: { plannedFor: TOMORROW } });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: TOMORROW, frogTaskId: T["T4"].id } });
      await review({ ...base, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: T["T2"].id });
      expect((await planRow(TOMORROW)).frogTaskId).toBe(T["T2"].id);
      expect((await taskRow(T["T4"].id)).plannedFor).toBe(TOMORROW);
    });

    it("absent leaves tomorrow's plan alone, and creates none", async () => {
      await review({ ...base, moves: [move("T2", "tomorrow")] });
      expect(await planRow(TOMORROW)).toBeNull();
      expect(await db.dailyPlan.count({ where: { userId: "owner-1" } })).toBe(1);
      await db.dailyPlan.create({ data: { userId: "owner-1", date: TOMORROW, frogTaskId: T["T4"].id, plannedAt: new Date("2026-10-24T18:00:00Z") } });
      const prior = await planRow(TOMORROW);
      await review({ ...base, moves: [move("T3", "tomorrow")] });
      expect(await planRow(TOMORROW)).toEqual(prior);
    });

    it("null leaves tomorrow's plan alone (it does NOT clear the frog), and creates none", async () => {
      await review({ ...base, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: null });
      expect(await planRow(TOMORROW)).toBeNull();
      await db.dailyPlan.create({ data: { userId: "owner-1", date: TOMORROW, frogTaskId: T["T4"].id } });
      const prior = await planRow(TOMORROW);
      await review({ ...base, tomorrowFrogTaskId: null });
      expect(await planRow(TOMORROW)).toEqual(prior);
    });

    it("GET for tomorrow then shows the frog preselected: a plan without plannedAt, the task in tasks", async () => {
      await review({ ...base, moves: [move("T2", "tomorrow"), move("T3", "tomorrow")], tomorrowFrogTaskId: T["T3"].id });
      const b: Json = await (await get(TOMORROW)).json();
      expect(b.plan).toMatchObject({ frogTaskId: T["T3"].id, plannedAt: null, reviewedAt: null });
      expect(b.frog.title).toBe("T3");
      expect(titles(b.tasks).sort()).toEqual(["T2", "T3"]);
    });

    describe("an edited review", () => {
      beforeEach(async () => {
        await review({ ...base, moves: [move("T2", "tomorrow"), move("T3", "tomorrow")], tomorrowFrogTaskId: T["T3"].id });
        expect((await planRow(TOMORROW)).frogTaskId).toBe(T["T3"].id);
      });

      it("sending the tomorrow frog to the backlog clears tomorrow's frog (the plan row stays)", async () => {
        await db.dailyPlan.update({ where: { userId_date: { userId: "owner-1", date: TOMORROW } }, data: { plannedAt: new Date("2026-10-24T22:00:00Z") } });
        expect((await review({ ...base, moves: [move("T3", "backlog")] })).status).toBe(200);
        const p = await planRow(TOMORROW);
        expect(p.frogTaskId).toBeNull();
        expect(p.plannedAt).toEqual(new Date("2026-10-24T22:00:00Z"));
        expect((await taskRow(T["T3"].id)).plannedFor).toBeNull();
      });

      it("archiving the tomorrow frog clears tomorrow's frog", async () => {
        expect((await review({ ...base, moves: [move("T3", "archive")] })).status).toBe(200);
        expect((await planRow(TOMORROW)).frogTaskId).toBeNull();
        expect((await taskRow(T["T3"].id)).archivedAt).not.toBeNull();
      });

      it("moving some other task away leaves tomorrow's frog alone", async () => {
        await review({ ...base, moves: [move("T2", "backlog")] });
        expect((await planRow(TOMORROW)).frogTaskId).toBe(T["T3"].id);
      });

      it("moving the frog away and naming a new frog in one request leaves the new frog", async () => {
        await review({ ...base, moves: [move("T3", "backlog"), move("T2", "tomorrow")], tomorrowFrogTaskId: T["T2"].id });
        expect((await planRow(TOMORROW)).frogTaskId).toBe(T["T2"].id);
      });

      it("only tomorrow's plan is cleared: another day's plan with the same frog is kept", async () => {
        await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-27", frogTaskId: T["T3"].id } });
        await review({ ...base, moves: [move("T3", "backlog")] });
        expect((await planRow("2026-10-27")).frogTaskId).toBe(T["T3"].id);
        // ...and today's plan, which also may name it, is untouched
        await db.dailyPlan.update({ where: { userId_date: { userId: "owner-1", date: DATE } }, data: { frogTaskId: T["T3"].id } });
        await review({ ...base, moves: [move("T3", "archive")] });
        expect((await planRow(DATE)).frogTaskId).toBe(T["T3"].id);
      });

      it("re-sending 'tomorrow' for the same frog is stable", async () => {
        await review({ ...base, moves: [move("T3", "tomorrow")], tomorrowFrogTaskId: T["T3"].id });
        expect((await planRow(TOMORROW)).frogTaskId).toBe(T["T3"].id);
        expect((await taskRow(T["T3"].id)).plannedFor).toBe(TOMORROW);
        expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: TOMORROW } })).toBe(1);
      });
    });

    it("today's own frog moved to the backlog or archived: today's plan keeps frogTaskId", async () => {
      await review({ ...base, moves: [move("T1", "archive")] });
      expect((await planRow()).frogTaskId).toBe(T["T1"].id);
      const b: Json = await (await get()).json();
      expect(b.frog.id).toBe(T["T1"].id); // still returned; the UI hides an archived, uneaten frog
      expect(b.frog.archivedAt).not.toBeNull();
    });
  });

  // ───────────────────────────── atomicity ─────────────────────────────

  describe("atomicity: one failing write rolls everything back", () => {
    const body = () => ({
      ...base,
      moves: [move("T2", "tomorrow"), move("T3", "backlog"), move("T4", "archive"), move("Parent", "archive")],
      wentWell: "must not stick",
      improve: "nor this",
      rating: 1,
      tomorrowFrogTaskId: T["T2"].id,
    });

    afterEach(async () => {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS frog_test_fail_review_act ON "Activity"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS frog_test_fail_review_act()`);
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS frog_test_fail_review_plan ON "DailyPlan"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS frog_test_fail_review_plan()`);
    });

    it("a failing 'archived' activity row undoes the task moves, the archive, the reflection and tomorrow's plan", async () => {
      await db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION frog_test_fail_review_act() RETURNS trigger AS $$
         BEGIN IF NEW.action = 'archived' THEN RAISE EXCEPTION 'frog test: forced activity failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      );
      await db.$executeRawUnsafe(`CREATE TRIGGER frog_test_fail_review_act BEFORE INSERT ON "Activity" FOR EACH ROW EXECUTE FUNCTION frog_test_fail_review_act()`);
      // control: the trigger rejects an archived row and lets others through
      await expect(db.activity.create({ data: { taskId: T["T2"].id, userId: "owner-1", action: "archived" } })).rejects.toThrow(/forced activity failure/);
      await expect(db.activity.create({ data: { taskId: T["T2"].id, userId: "owner-1", action: "restored" } })).resolves.toBeDefined();
      await db.activity.deleteMany({});
      before = await snapshot();

      await expect(review(body())).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
      expect(await planRow(TOMORROW)).toBeNull();
      expect((await planRow()).reviewedAt).toBeNull();
    });

    it("a failing insert of tomorrow's plan (the last write) undoes everything before it", async () => {
      await db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION frog_test_fail_review_plan() RETURNS trigger AS $$
         BEGIN IF NEW.date = '${TOMORROW}' THEN RAISE EXCEPTION 'frog test: forced plan failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      );
      await db.$executeRawUnsafe(`CREATE TRIGGER frog_test_fail_review_plan BEFORE INSERT ON "DailyPlan" FOR EACH ROW EXECUTE FUNCTION frog_test_fail_review_plan()`);
      await expect(db.dailyPlan.create({ data: { userId: "owner-1", date: TOMORROW } })).rejects.toThrow(/forced plan failure/);
      before = await snapshot();

      await expect(review(body())).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
      for (const name of ["T2", "T3", "T4", "Parent", "Sub1"]) {
        const t = await taskRow(T[name].id);
        expect(t.archivedAt).toBeNull();
      }
      expect((await taskRow(T["T2"].id)).plannedFor).toBe(DATE);
      expect((await taskRow(T["T3"].id)).plannedFor).toBe(DATE);
      expect(await archivedActivity()).toHaveLength(0);
      expect(await planRow()).toMatchObject({ wentWell: "kept well", rating: 4, reviewedAt: null });
    });

    it("a failing insert of today's plan (a day with no plan yet) undoes the task moves", async () => {
      await db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION frog_test_fail_review_plan() RETURNS trigger AS $$
         BEGIN IF NEW.date = '2026-11-20' THEN RAISE EXCEPTION 'frog test: forced plan failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      );
      await db.$executeRawUnsafe(`CREATE TRIGGER frog_test_fail_review_plan BEFORE INSERT ON "DailyPlan" FOR EACH ROW EXECUTE FUNCTION frog_test_fail_review_plan()`);
      before = await snapshot();
      await expect(review({ date: "2026-11-20", tz: TZ, moves: [move("T2", "archive"), move("T3", "backlog")] })).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    });
  });

  // ───────────────────────────── idempotence, editing ─────────────────────────────

  describe("re-POSTing and editing a closed day", () => {
    it("the same body twice leaves the same state (apart from reviewedAt/updatedAt)", async () => {
      const b = { ...base, moves: [move("T2", "tomorrow"), move("T3", "backlog")], wentWell: "a", improve: "b", rating: 3, tomorrowFrogTaskId: T["T2"].id };
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T20:00:00Z"));
      expect((await review(b)).status).toBe(200);
      const first = await snapshot();
      vi.setSystemTime(new Date("2026-10-24T21:00:00Z"));
      expect((await review(b)).status).toBe(200);
      const second = await snapshot();
      const strip = (s: typeof first) => ({
        ...s,
        tasks: s.tasks.map((t: Json) => ({ ...t, updatedAt: null })),
        plans: s.plans.map((p: Json) => ({ ...p, updatedAt: null, reviewedAt: p.reviewedAt && "stamped" })),
      });
      expect(strip(second)).toEqual(strip(first));
      expect(second.plans.find((p: Json) => p.date === DATE && p.userId === "owner-1").reviewedAt).toEqual(new Date("2026-10-24T21:00:00Z"));
    });

    it("a closed day can be edited: new reflection and a task moved on again", async () => {
      await review({ ...base, moves: [move("T2", "tomorrow"), move("T3", "tomorrow")], wentWell: "first", rating: 2, tomorrowFrogTaskId: T["T2"].id });
      expect((await review({ ...base, moves: [move("T3", "backlog")], wentWell: "second", rating: 5 })).status).toBe(200);
      expect(await planRow()).toMatchObject({ wentWell: "second", rating: 5, improve: "kept improve" });
      expect((await taskRow(T["T3"].id)).plannedFor).toBeNull();
      expect((await taskRow(T["T2"].id)).plannedFor).toBe(TOMORROW);
      expect((await planRow(TOMORROW)).frogTaskId).toBe(T["T2"].id);
    });

    it("what the UI sends when you edit a closed day (no moves, reflection only, no frog) changes nothing else", async () => {
      await review({ ...base, moves: [move("T2", "tomorrow"), move("T3", "archive")], wentWell: "first", improve: "x", rating: 2, tomorrowFrogTaskId: T["T2"].id });
      const closed = await snapshot();
      expect((await review({ ...base, moves: [], wentWell: "edited", improve: "x", rating: 3, tomorrowFrogTaskId: null })).status).toBe(200);
      const after = await snapshot();
      expect(after.tasks).toEqual(closed.tasks);
      expect(after.activity).toEqual(closed.activity);
      expect(after.plans.find((p: Json) => p.date === TOMORROW)).toEqual(closed.plans.find((p: Json) => p.date === TOMORROW));
      expect(await planRow()).toMatchObject({ wentWell: "edited", rating: 3 });
    });

    it("archiving the same task a second time is a 404 and writes nothing (an archived task counts as gone)", async () => {
      expect((await review({ ...base, moves: [move("T3", "archive")] })).status).toBe(200);
      before = await snapshot();
      await expectRejected(await review({ ...base, moves: [move("T3", "archive")], wentWell: "again" }), 404);
      expect(await archivedActivity()).toHaveLength(1);
    });
  });

  // ───────────────────────────── concurrency ─────────────────────────────

  describe("concurrency", () => {
    it("two simultaneous reviews of a brand-new date make exactly one DailyPlan for that day and one for tomorrow (x15)", async () => {
      for (let round = 0; round < 15; round++) {
        const date = `2027-03-${String(round + 1).padStart(2, "0")}`;
        const tomorrow = `2027-03-${String(round + 2).padStart(2, "0")}`;
        const mk = (frog: string, w: string) => ({ date, tz: TZ, moves: [move("T2", "tomorrow"), move("T3", "tomorrow")], tomorrowFrogTaskId: T[frog].id, wentWell: w });
        const results = await Promise.all([review(mk("T2", "A")), review(mk("T3", "B"))]);
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        expect(await db.dailyPlan.count({ where: { userId: "owner-1", date } })).toBe(1);
        expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: tomorrow } })).toBe(1);
        expect(["A", "B"]).toContain((await planRow(date)).wentWell);
      }
    });

    it("six simultaneous reviews for one date: one plan, all 200", async () => {
      const date = "2027-04-01";
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => review({ date, tz: TZ, moves: [move("T2", "tomorrow")], rating: (i % 5) + 1, tomorrowFrogTaskId: T["T2"].id })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date } })).toBe(1);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: "2027-04-02" } })).toBe(1);
      expect((await planRow(date)).reviewedAt).not.toBeNull();
    });

    it("overlapping moves in opposite orders don't deadlock or 500", async () => {
      const names = ["T1", "T2", "T3", "T4"];
      const mv = (order: string[], action: string) => order.map((n) => move(n, action));
      const results = await Promise.all([
        review({ ...base, moves: mv(names, "tomorrow"), tomorrowFrogTaskId: T["T1"].id }),
        review({ ...base, moves: mv([...names].reverse(), "backlog") }),
        review({ ...base, moves: mv(names.slice(1), "tomorrow"), tomorrowFrogTaskId: T["T4"].id }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: DATE } })).toBe(1);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: TOMORROW } })).toBe(1);
    });

    it("a review racing a PUT /api/today for the same date: both finish, one plan", async () => {
      const { PUT } = await import("@/app/api/today/route");
      const putRes = PUT(new Request("http://localhost/api/today", { method: "PUT", body: JSON.stringify({ date: DATE, tz: TZ, taskIds: [T["T1"].id, T["T2"].id], frogTaskId: T["T1"].id, finalize: true }) }));
      const results = await Promise.all([putRes, review({ ...base, moves: [move("T2", "backlog")], rating: 1 })]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: DATE } })).toBe(1);
    });

    it("two simultaneous archives of the same task never 500 (200 and 404, or both 200)", async () => {
      const results = await Promise.all([review({ ...base, moves: [move("T3", "archive")] }), review({ ...base, moves: [move("T3", "archive")] })]);
      for (const r of results) expect([200, 404]).toContain(r.status);
      expect(results.some((r) => r.status === 200)).toBe(true);
      expect((await taskRow(T["T3"].id)).archivedAt).not.toBeNull();
    });
  });

  // ───────────────────────────── response ─────────────────────────────

  describe("the response is the Today payload for the date", () => {
    it("equals a following GET /api/today (plan carries reflections and reviewedAt)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T21:30:00Z"));
      const res = await review({ ...base, moves: [move("T2", "tomorrow"), move("T3", "archive"), move("T4", "backlog")], wentWell: "  nice ", improve: "", rating: 4, tomorrowFrogTaskId: T["T2"].id });
      expect(res.status).toBe(200);
      const b: Json = await res.json();
      const g: Json = await (await get()).json();
      expect(g).toEqual(b);
      expect(b.date).toBe(DATE);
      expect(b.plan).toMatchObject({ wentWell: "nice", improve: null, rating: 4, frogTaskId: T["T1"].id });
      expect(b.plan.reviewedAt).toBe("2026-10-24T21:30:00.000Z");
      expect(b.plan.plannedAt).toBe("2026-10-24T07:00:00.000Z");
      expect(b.frog.title).toBe("T1");
      expect(titles(b.tasks).sort()).toEqual(["DoneT", "H1", "H2", "Parent", "T1"]);
      expect(titles(b.completedToday)).toEqual(["DoneT"]);
    });

    it("also for a brand-new day and an extreme (but supported) day", async () => {
      for (const date of ["2026-11-20", "0001-01-03", "9998-12-28"]) {
        const b: Json = await (await review({ date, tz: TZ, moves: [], rating: 3 })).json();
        expect(await (await get(date)).json()).toEqual(b);
      }
    });

    it("the time-zone edge: a task completed at 23:30 local (already tomorrow in UTC) is in completedToday and eats the frog", async () => {
      // 23:30 America/New_York on 2026-10-24 is 2026-10-25T03:30Z
      await db.task.update({ where: { id: T["T1"].id }, data: { completedAt: new Date("2026-10-25T03:30:00Z") } });
      const b: Json = await (await review({ ...base, moves: [move("T2", "tomorrow")] })).json();
      expect(titles(b.completedToday)).toContain("T1");
      expect(b.streak).toEqual({ current: 1, longest: 1 });
      // from a zone where that instant is already the 25th, it is neither
      const berlin: Json = await (await review({ ...base, tz: "Europe/Berlin", moves: [] })).json();
      expect(titles(berlin.completedToday)).not.toContain("T1");
      expect(berlin.streak.current).toBe(0);
    });

    it("never leaks another user's data, even when that user has plans, tasks and a streak", async () => {
      const res = await review({ ...base, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: T["T2"].id, wentWell: "mine" });
      expectNoForeignData(await res.json(), foreign);
      // and the other user's own view is unaffected by this review
      signInAs("stranger");
      const theirs: Json = await (await get()).json();
      expect(theirs.plan.wentWell).toBe("SECRET reflection");
      // (A bare "T2" would also match the "T2x" of a timestamp after 20:00 UTC.)
      expect(JSON.stringify(theirs)).not.toContain('"title":"T2"');
    });
  });

  // ───────────────────────────── streak ─────────────────────────────

  describe("streak after a review", () => {
    it("an eaten frog today plus the tomorrow plan the review created: current 1, longest 1", async () => {
      await db.task.update({ where: { id: T["T1"].id }, data: { completedAt: new Date("2026-10-24T13:00:00Z") } });
      const b: Json = await (await review({ ...base, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: T["T2"].id })).json();
      expect(b.streak).toEqual({ current: 1, longest: 1 });
    });

    it("a future plan whose frog is already completed does not inflate today's streak", async () => {
      await db.task.update({ where: { id: T["T1"].id }, data: { completedAt: new Date("2026-10-24T13:00:00Z") } });
      // tomorrow's frog is a task finished today: for the 25th that would count as 'eaten'
      const b: Json = await (await review({ ...base, tomorrowFrogTaskId: T["DoneT"].id })).json();
      expect(b.streak).toEqual({ current: 1, longest: 1 });
    });

    it("builds on yesterday and the day before; the review's own tomorrow plan adds nothing", async () => {
      for (const [d, title] of [["2026-10-23", "Y1"], ["2026-10-22", "Y2"]]) {
        const y = (await seedGroup("owner-1", { tasks: [{ title, status: "Done", completedAt: new Date(`${d}T12:00:00Z`) }] })).tasks[title];
        await db.dailyPlan.create({ data: { userId: "owner-1", date: d, frogTaskId: y.id, plannedAt: new Date() } });
      }
      await db.task.update({ where: { id: T["T1"].id }, data: { completedAt: new Date("2026-10-24T13:00:00Z") } });
      const b: Json = await (await review({ ...base, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: T["T2"].id })).json();
      expect(b.streak).toEqual({ current: 3, longest: 3 });
    });

    it("an uneaten frog today doesn't break yesterday's streak (counted from yesterday)", async () => {
      const y = (await seedGroup("owner-1", { tasks: [{ title: "Y1", status: "Done", completedAt: new Date("2026-10-23T12:00:00Z") }] })).tasks["Y1"];
      await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-23", frogTaskId: y.id } });
      const b: Json = await (await review({ ...base, moves: [move("T2", "tomorrow")], tomorrowFrogTaskId: T["T2"].id })).json();
      expect(b.streak).toEqual({ current: 1, longest: 1 });
    });

    it("a gap day breaks the run; the longest run is remembered", async () => {
      for (const d of ["2026-10-19", "2026-10-20", "2026-10-21"]) {
        const y = (await seedGroup("owner-1", { tasks: [{ title: `E${d}`, status: "Done", completedAt: new Date(`${d}T12:00:00Z`) }] })).tasks[`E${d}`];
        await db.dailyPlan.create({ data: { userId: "owner-1", date: d, frogTaskId: y.id } });
      }
      await db.task.update({ where: { id: T["T1"].id }, data: { completedAt: new Date("2026-10-24T13:00:00Z") } });
      const b: Json = await (await review(base)).json();
      expect(b.streak).toEqual({ current: 1, longest: 3 });
    });

    it("closing a day with no plan and no frog creates no streak", async () => {
      const b: Json = await (await review({ date: "2026-11-20", tz: TZ, moves: [] })).json();
      expect(b.streak).toEqual({ current: 0, longest: 0 });
    });

    it("another user's streak never counts", async () => {
      await db.task.update({ where: { id: foreign.tasks["SECRET done"].id }, data: { completedAt: new Date("2026-10-24T13:00:00Z") } });
      await db.dailyPlan.update({ where: { userId_date: { userId: "stranger", date: DATE } }, data: { frogTaskId: foreign.tasks["SECRET done"].id } });
      const b: Json = await (await review(base)).json();
      expect(b.streak).toEqual({ current: 0, longest: 0 });
    });
  });

  // ───────────────────────────── interplay with the other Today routes ─────────────────────────────

  describe("interplay with PUT /api/today and GET /api/today/candidates", () => {
    const putToday = async (b: unknown) => (await import("@/app/api/today/route")).PUT(new Request("http://localhost/api/today", { method: "PUT", body: JSON.stringify(b) }));

    it("re-planning a closed day (PUT) keeps reviewedAt and the reflection", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T20:00:00Z"));
      await review({ ...base, moves: [], wentWell: "w", improve: "i", rating: 2 });
      vi.setSystemTime(new Date("2026-10-24T21:00:00Z"));
      expect((await putToday({ date: DATE, tz: TZ, taskIds: [T["T1"].id, T["T2"].id], frogTaskId: T["T2"].id, finalize: true })).status).toBe(200);
      expect(await planRow()).toMatchObject({ wentWell: "w", improve: "i", rating: 2, frogTaskId: T["T2"].id, reviewedAt: new Date("2026-10-24T20:00:00Z"), plannedAt: new Date("2026-10-24T21:00:00Z") });
    });

    it("tomorrow's morning plan (PUT with finalize) takes over the plan the review created, stamping plannedAt", async () => {
      await review({ ...base, moves: [move("T2", "tomorrow"), move("T3", "tomorrow")], tomorrowFrogTaskId: T["T3"].id });
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-25T06:30:00Z"));
      expect((await putToday({ date: TOMORROW, tz: TZ, taskIds: [T["T2"].id, T["T3"].id], frogTaskId: T["T3"].id, finalize: true })).status).toBe(200);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: TOMORROW } })).toBe(1);
      expect(await planRow(TOMORROW)).toMatchObject({ frogTaskId: T["T3"].id, plannedAt: new Date("2026-10-25T06:30:00Z") });
    });

    it("GET /api/today/candidates after a review: backlog'd and tomorrow's tasks are offered, archived ones are not", async () => {
      const { GET } = await import("@/app/api/today/candidates/route");
      await review({ ...base, moves: [move("T2", "backlog"), move("T3", "archive"), move("T4", "tomorrow")] });
      const list: Json[] = await (await (GET as (r: Request) => Promise<Response>)(new Request("http://localhost/api/today/candidates"))).json();
      const byTitle = Object.fromEntries(list.map((c) => [c.title, c]));
      expect(byTitle["T2"]).toBeDefined();
      expect(byTitle["T2"].plannedFor).toBeNull();
      expect(byTitle["T4"].plannedFor).toBe(TOMORROW);
      expect(byTitle["T3"]).toBeUndefined();
    });
  });

  // ───────────────────────────── scale ─────────────────────────────

  describe("scale", () => {
    it("200 moves (tomorrow / backlog / archive, with subtasks): correct and fast enough", async () => {
      const { group, statuses } = await seedGroup("owner-1", { groupName: "Bulk" });
      const rows = Array.from({ length: 200 }, (_, i) => ({
        id: `bulk-${String(i).padStart(3, "0")}`,
        title: `bulk ${i}`,
        groupId: group.id,
        statusId: statuses["To Do"].id,
        createdBy: "owner-1",
        order: i,
        plannedFor: DATE,
      }));
      await db.task.createMany({ data: rows });
      const subs = rows.filter((_, i) => i % 3 === 2).map((r) => ({ ...r, id: `sub-${r.id}`, parentTaskId: r.id, plannedFor: null }));
      await db.task.createMany({ data: subs });
      const action = (i: number) => (["tomorrow", "backlog", "archive"] as const)[i % 3];
      const moves = rows.map((r, i) => ({ taskId: r.id, action: action(i) }));
      const t0 = Date.now();
      const res = await review({ ...base, moves, wentWell: "bulk", rating: 3, tomorrowFrogTaskId: rows[0].id });
      const elapsed = Date.now() - t0;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(8000);
      const count = (where: Json) => db.task.count({ where: { id: { in: rows.map((r) => r.id) }, ...where } });
      expect(await count({ plannedFor: TOMORROW })).toBe(67);
      expect(await count({ plannedFor: null, archivedAt: null })).toBe(67);
      expect(await count({ archivedAt: { not: null } })).toBe(66);
      expect(await db.task.count({ where: { id: { in: subs.map((s) => s.id) }, archivedAt: { not: null } } })).toBe(subs.length);
      expect(await db.activity.count({ where: { action: "archived" } })).toBe(66);
      expect((await planRow(TOMORROW)).frogTaskId).toBe(rows[0].id);
      const b: Json = await res.json();
      expect(b.plan.wentWell).toBe("bulk");
    });

    it("exactly 200 unknown ids passes the size cap and is a 404", async () => {
      const moves = Array.from({ length: 200 }, (_, i) => ({ taskId: `nope-${i}`, action: "backlog" }));
      await expectRejected(await review({ ...base, moves }), 404);
    });
  });
});
