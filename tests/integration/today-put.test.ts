// M3: PUT /api/today. Real handler + real Postgres; every test asserts the DB
// state afterwards, and every rejection asserts that NOTHING was written.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import {
  DATE,
  TZ,
  get,
  put,
  putRaw,
  snapshot,
  seedForeignUser,
  expectNoForeignData,
  titles,
  omit,
  type Json,
} from "./today-helpers";

const taskRow = (id: string) => db.task.findUnique({ where: { id } });
const planRow = (userId = "owner-1", date = DATE) => db.dailyPlan.findUnique({ where: { userId_date: { userId, date } } });
const activities = (action = "abcde_changed") => db.activity.findMany({ where: { action }, orderBy: { createdAt: "asc" } });

describe("PUT /api/today", () => {
  let T: Record<string, { id: string; [k: string]: unknown }>;
  let groupId: string;
  let base: { date: string; tz: string; taskIds: string[]; frogTaskId: string | null };

  beforeEach(async () => {
    const seeded = await seedGroup("owner-1", {
      tasks: [
        { title: "T1" },
        { title: "T2" },
        { title: "T3" },
        { title: "T4" },
        { title: "Parent" },
        { title: "Sub", parentTitle: "Parent" },
        { title: "Trashed", deletedAt: new Date("2026-10-01T00:00:00Z") },
        { title: "Archived", archivedAt: new Date("2026-10-01T00:00:00Z") },
      ],
    });
    T = seeded.tasks;
    groupId = seeded.group.id;
    base = { date: DATE, tz: TZ, taskIds: [T["T1"].id, T["T2"].id], frogTaskId: T["T1"].id };
    signInAs("owner-1");
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
  }
  let before: Awaited<ReturnType<typeof snapshot>>;
  beforeEach(async () => {
    // pre-existing state a bad request must not disturb: a plan, planned tasks, a letter
    await db.task.update({ where: { id: T["T3"].id }, data: { plannedFor: DATE, abcde: "C", abcdeRank: 2 } });
    await db.task.update({ where: { id: T["T4"].id }, data: { plannedFor: "2026-10-30" } });
    await db.dailyPlan.create({
      data: { userId: "owner-1", date: DATE, frogTaskId: T["T3"].id, plannedAt: new Date("2026-10-24T07:00:00Z"), wentWell: "kept" },
    });
    before = await snapshot();
  });

  // ───────────────────────────── auth ─────────────────────────────

  describe("auth", () => {
    it("401 with no user, nothing written", async () => {
      setFakeUser(null);
      await expectRejected401(await put(base));
    });
    it("401 comes before body parsing", async () => {
      setFakeUser(null);
      await expectRejected401(await putRaw("not json"));
    });
    async function expectRejected401(res: Response) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      expect(await snapshot()).toEqual(before);
    }
  });

  // ───────────────────────────── 400s ─────────────────────────────

  describe("400 for invalid input, and nothing is written", () => {
    it.each([
      ["not JSON", "not json"],
      ["empty body", ""],
      ["truncated JSON", '{"date":"2026-10-24",'],
      ["JSON null", "null"],
      ["a JSON array", "[]"],
      ["a JSON string", '"hello"'],
      ["a JSON number", "42"],
      ["JSON true", "true"],
    ])("body: %s", async (_l, raw) => {
      await expectRejected(await putRaw(raw), 400);
    });

    it.each([
      ["missing", undefined],
      ["null", null],
      ["empty", ""],
      ["2026-02-30", "2026-02-30"],
      ["2026-1-5", "2026-1-5"],
      ["2026-13-01", "2026-13-01"],
      ["a timestamp", "2026-10-24T00:00:00Z"],
      ["20261024", "20261024"],
      ["a number", 20261024],
      ["an array", ["2026-10-24"]],
      ["trailing newline", "2026-10-24\n"],
    ])("date: %s", async (_l, date) => {
      await expectRejected(await put({ ...base, date }), 400);
    });

    it.each([
      ["missing", undefined],
      ["null", null],
      ["empty", ""],
      ["Mars/Base", "Mars/Base"],
      ["+05:00", "+05:00"],
      ["-08:00", "-08:00"],
      ["a number", 5],
      ["an object", {}],
      ["a very long string", "Z".repeat(10_000)],
    ])("tz: %s", async (_l, tz) => {
      await expectRejected(await put({ ...base, tz }), 400);
    });

    it("date is checked before tz and both before taskIds (all bad → still a 400)", async () => {
      await expectRejected(await put({ date: "nope", tz: "nope", taskIds: "nope" }), 400);
    });

    it.each([
      ["missing", undefined],
      ["null", null],
      ["a string", "abc"],
      ["an object", { 0: "x" }],
      ["a number", 5],
      ["a boolean", true],
    ])("taskIds: %s", async (_l, taskIds) => {
      await expectRejected(await put({ ...base, taskIds, frogTaskId: null }), 400);
    });

    it.each([
      ["a number", [1]],
      ["null", [null]],
      ["an object", [{ id: "x" }]],
      ["a nested array", [["x"]]],
      ["a boolean", [true]],
      ["an empty string", [""]],
      ["a mix with one non-string", [() => 0, "x"].length ? ["x", 7] : []],
    ])("taskIds contains %s", async (_l, taskIds) => {
      await expectRejected(await put({ ...base, taskIds, frogTaskId: null }), 400);
    });

    it("taskIds with duplicates (even when the duplicate is a valid task)", async () => {
      await expectRejected(await put({ ...base, taskIds: [T["T1"].id, T["T2"].id, T["T1"].id] }), 400);
      await expectRejected(await put({ ...base, taskIds: ["x", "x"], frogTaskId: null }), 400);
    });

    it("taskIds over 200 entries", async () => {
      const taskIds = Array.from({ length: 201 }, (_, i) => `id-${i}`);
      await expectRejected(await put({ ...base, taskIds, frogTaskId: null }), 400);
      // ... also when the first 200 are real
      await expectRejected(await put({ ...base, taskIds: [...taskIds.slice(0, 200), T["T1"].id], frogTaskId: null }), 400);
    });

    it("a huge taskIds array (50,000) is a plain 400, not a crash", async () => {
      const taskIds = Array.from({ length: 50_000 }, (_, i) => `id-${i}`);
      await expectRejected(await put({ ...base, taskIds, frogTaskId: null }), 400);
    });

    describe("ranks", () => {
      const withRanks = (ranks: unknown) => put({ ...base, ranks });
      it.each([
        ["an array", []],
        ["a string", "A-1"],
        ["a number", 3],
        ["a boolean", true],
      ])("ranks is %s", async (_l, ranks) => {
        await expectRejected(await withRanks(ranks), 400);
      });

      it("a ranks key that is not in taskIds (a real, owned task)", async () => {
        await expectRejected(await withRanks({ [T["T3"].id]: { abcde: "A", abcdeRank: 1 } }), 400);
      });
      it("a ranks key that is unknown", async () => {
        await expectRejected(await withRanks({ nope: { abcde: "A", abcdeRank: 1 } }), 400);
      });
      it("a ranks key that is another user's task id (400, not 404, since it isn't in taskIds)", async () => {
        const foreign = await seedForeignUser();
        before = await snapshot();
        await expectRejected(await withRanks({ [foreign.tasks["SECRET planned"].id]: { abcde: "A", abcdeRank: 1 } }), 400);
      });
      it.each([["__proto__"], ["constructor"], ["toString"]])("a prototype-ish ranks key %s", async (key) => {
        await expectRejected(await putRaw(JSON.stringify({ ...base }).replace(/}$/, `,"ranks":{"${key}":{"abcde":"A"}}}`)), 400);
      });

      it.each([
        ["null", null],
        ["a string", "A"],
        ["an array", []],
        ["a number", 1],
      ])("a ranks entry that is %s", async (_l, entry) => {
        await expectRejected(await withRanks({ [T["T1"].id]: entry }), 400);
      });

      it.each([
        ["F", "F"],
        ["lowercase a", "a"],
        ["AA", "AA"],
        ["empty", ""],
        ["a number", 1],
        ["a boolean", true],
        ["an array", ["A"]],
        ["missing", undefined],
      ])("invalid letter: %s", async (_l, abcde) => {
        await expectRejected(await withRanks({ [T["T1"].id]: { abcde, abcdeRank: null } }), 400);
      });

      it.each([
        ["0", 0],
        ["-1", -1],
        ["1.5", 1.5],
        ["a numeric string", "1"],
        ["a boolean", true],
        ["above int32", 2_147_483_648],
        ["a float with .0 beyond int range", 1e12],
        ["an object", {}],
      ])("invalid rank: %s", async (_l, abcdeRank) => {
        await expectRejected(await withRanks({ [T["T1"].id]: { abcde: "A", abcdeRank } }), 400);
      });

      it("a rank without a letter (null letter)", async () => {
        await expectRejected(await withRanks({ [T["T1"].id]: { abcde: null, abcdeRank: 2 } }), 400);
      });
      it("a rank without a letter (letter omitted)", async () => {
        await expectRejected(await withRanks({ [T["T1"].id]: { abcdeRank: 2 } }), 400);
      });
      it("one bad entry among good ones rejects the whole request", async () => {
        await expectRejected(
          await withRanks({ [T["T1"].id]: { abcde: "A", abcdeRank: 1 }, [T["T2"].id]: { abcde: "Z", abcdeRank: 1 } }),
          400,
        );
      });
    });

    describe("frogTaskId", () => {
      it("missing", async () => {
        await expectRejected(await put({ ...base, frogTaskId: undefined }), 400);
      });
      it.each([
        ["a number", 5],
        ["an object", {}],
        ["an array", [T_ID()]],
        ["a boolean", false],
      ])("frogTaskId is %s", async (_l, frogTaskId) => {
        await expectRejected(await put({ ...base, frogTaskId }), 400);
      });
      function T_ID() {
        return "x";
      }
      it("an own, valid task that is not in taskIds", async () => {
        await expectRejected(await put({ ...base, frogTaskId: T["T3"].id }), 400);
      });
      it("an unknown id", async () => {
        await expectRejected(await put({ ...base, frogTaskId: "nope" }), 400);
      });
      it("empty string", async () => {
        await expectRejected(await put({ ...base, frogTaskId: "" }), 400);
      });
      it("a frog is required to be in taskIds even when taskIds is empty", async () => {
        await expectRejected(await put({ ...base, taskIds: [], frogTaskId: T["T1"].id }), 400);
      });
      it("another user's task that is not in taskIds is a 400 (the check is on taskIds membership)", async () => {
        const foreign = await seedForeignUser();
        before = await snapshot();
        await expectRejected(await put({ ...base, frogTaskId: foreign.tasks["SECRET frog"].id }), 400);
      });
    });

    describe("finalize", () => {
      it.each([
        ["a string", "true"],
        ["1", 1],
        ["0", 0],
        ["null", null],
        ["an object", {}],
        ["an array", []],
      ])("finalize is %s", async (_l, finalize) => {
        await expectRejected(await put({ ...base, finalize }), 400);
      });
    });
  });

  // ───────────────────────────── 404s ─────────────────────────────

  describe("404 when any task id isn't the caller's plain, live, top-level task; nothing is written", () => {
    async function foreignIds() {
      const f = await seedForeignUser();
      before = await snapshot();
      return f;
    }

    it("another user's task", async () => {
      const f = await foreignIds();
      await expectRejected(await put({ ...base, taskIds: [f.tasks["SECRET backlog"].id], frogTaskId: null }), 404);
    });

    it("one valid id and one foreign id: the valid one is NOT planned", async () => {
      const f = await foreignIds();
      const res = await put({ ...base, taskIds: [T["T1"].id, f.tasks["SECRET backlog"].id], frogTaskId: T["T1"].id });
      await expectRejected(res, 404);
      expect((await taskRow(T["T1"].id)).plannedFor).toBeNull();
      expect((await taskRow(f.tasks["SECRET backlog"].id)).plannedFor).toBeNull();
      // and the 404 text says nothing about the foreign task
      expect(JSON.stringify(await put({ ...base, taskIds: [f.tasks["SECRET backlog"].id], frogTaskId: null }).then((r) => r.json()))).not.toContain("SECRET");
    });

    it("foreign id in taskIds when it is ALSO the frog and has a ranks entry (the most hostile combination)", async () => {
      const f = await foreignIds();
      const id = f.tasks["SECRET backlog"].id;
      const res = await put({
        ...base,
        taskIds: [T["T1"].id, id],
        frogTaskId: id,
        finalize: true,
        ranks: { [id]: { abcde: "E", abcdeRank: 9 }, [T["T1"].id]: { abcde: "A", abcdeRank: 1 } },
      });
      await expectRejected(res, 404);
      expect((await taskRow(id)).abcde).toBe("B"); // untouched (seeded as B)
    });

    it("a subtask id", async () => {
      await expectRejected(await put({ ...base, taskIds: [T["T1"].id, T["Sub"].id], frogTaskId: T["T1"].id }), 404);
      expect((await taskRow(T["Sub"].id)).plannedFor).toBeNull();
    });

    it("a soft-deleted task id", async () => {
      await expectRejected(await put({ ...base, taskIds: [T["T1"].id, T["Trashed"].id], frogTaskId: T["T1"].id }), 404);
      expect((await taskRow(T["Trashed"].id)).plannedFor).toBeNull();
    });

    it("an archived task id", async () => {
      await expectRejected(await put({ ...base, taskIds: [T["T1"].id, T["Archived"].id], frogTaskId: T["T1"].id }), 404);
      expect((await taskRow(T["Archived"].id)).plannedFor).toBeNull();
    });

    it("an unknown id", async () => {
      await expectRejected(await put({ ...base, taskIds: [T["T1"].id, "does-not-exist"], frogTaskId: T["T1"].id }), 404);
    });

    it("each bad kind as the frog (frog is in taskIds, so it's a 404 not a 400)", async () => {
      const f = await foreignIds();
      for (const bad of [T["Sub"].id, T["Trashed"].id, T["Archived"].id, "does-not-exist", f.tasks["SECRET frog"].id]) {
        await expectRejected(await put({ ...base, taskIds: [bad], frogTaskId: bad, finalize: true }), 404);
      }
    });

    it("a rejected request with ranks changes no letter, creates no activity", async () => {
      await expectRejected(
        await put({ ...base, taskIds: [T["T1"].id, "nope"], ranks: { [T["T1"].id]: { abcde: "A", abcdeRank: 1 } } }),
        404,
      );
      expect(await activities()).toHaveLength(0);
      expect((await taskRow(T["T1"].id)).abcde).toBeNull();
    });

    it("a rejected request doesn't create a DailyPlan for a new date", async () => {
      const res = await put({ ...base, date: "2026-11-11", taskIds: ["nope"], frogTaskId: "nope" });
      await expectRejected(res, 404);
      expect(await planRow("owner-1", "2026-11-11")).toBeNull();
    });

    it("ids that look like injection / prototype keys are just unknown ids", async () => {
      for (const id of ["__proto__", "constructor", "' OR 1=1 --", "x'; DROP TABLE \"Task\"; --"]) {
        await expectRejected(await put({ ...base, taskIds: [id], frogTaskId: null }), 404);
      }
      expect(await db.task.count()).toBe(before.tasks.length);
    });

    it("exactly 200 unknown ids passes the size cap and is a 404", async () => {
      const taskIds = Array.from({ length: 200 }, (_, i) => `id-${i}`);
      await expectRejected(await put({ ...base, taskIds, frogTaskId: null }), 404);
    });
  });

  // ───────────────────────────── happy path ─────────────────────────────

  describe("happy path", () => {
    it("sets plannedFor on taskIds, upserts the DailyPlan with the frog, and returns 200", async () => {
      const res = await put(base);
      expect(res.status).toBe(200);
      expect((await taskRow(T["T1"].id)).plannedFor).toBe(DATE);
      expect((await taskRow(T["T2"].id)).plannedFor).toBe(DATE);
      const plan = await planRow();
      expect(plan.frogTaskId).toBe(T["T1"].id);
      expect(plan.userId).toBe("owner-1");
      expect(plan.date).toBe(DATE);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: DATE } })).toBe(1);
    });

    it("creates the plan for a new date (no prior row) with plannedAt null when not finalizing", async () => {
      const res = await put({ ...base, date: "2026-12-01" });
      expect(res.status).toBe(200);
      const plan = await planRow("owner-1", "2026-12-01");
      expect(plan).toMatchObject({ frogTaskId: T["T1"].id, plannedAt: null, reviewedAt: null, wentWell: null, improve: null, rating: null });
      expect((await taskRow(T["T1"].id)).plannedFor).toBe("2026-12-01");
    });

    it("moves a task planned for another day onto this one", async () => {
      expect((await taskRow(T["T4"].id)).plannedFor).toBe("2026-10-30");
      expect((await put({ ...base, taskIds: [T["T4"].id], frogTaskId: T["T4"].id })).status).toBe(200);
      expect((await taskRow(T["T4"].id)).plannedFor).toBe(DATE);
    });

    it("leaves tasks planned for OTHER days alone", async () => {
      expect((await put(base)).status).toBe(200);
      expect((await taskRow(T["T4"].id)).plannedFor).toBe("2026-10-30");
    });

    it("changes nothing on the tasks except plannedFor (and ranks when sent)", async () => {
      const t1 = await taskRow(T["T1"].id);
      await put(base);
      const after = await taskRow(T["T1"].id);
      expect(after.plannedFor).toBe(DATE);
      expect(omit(after, "plannedFor", "updatedAt")).toEqual(omit(t1, "plannedFor", "updatedAt"));
    });

    it("the frog may be null: the plan row is kept with frogTaskId null", async () => {
      expect((await put({ ...base, frogTaskId: null })).status).toBe(200);
      expect((await planRow()).frogTaskId).toBeNull();
      expect((await taskRow(T["T1"].id)).plannedFor).toBe(DATE);
    });

    it("accepts done tasks (a day can include already-completed work)", async () => {
      const { tasks } = await seedGroup("owner-1", { tasks: [{ title: "Already done", status: "Done" }] });
      const id = tasks["Already done"].id;
      expect((await put({ ...base, taskIds: [id], frogTaskId: id })).status).toBe(200);
      expect((await taskRow(id)).plannedFor).toBe(DATE);
    });

    it("accepts tasks from several of the user's projects", async () => {
      const { tasks } = await seedGroup("owner-1", { groupName: "Other project", tasks: [{ title: "Elsewhere" }] });
      const res = await put({ ...base, taskIds: [T["T1"].id, tasks["Elsewhere"].id] });
      expect(res.status).toBe(200);
      expect((await taskRow(tasks["Elsewhere"].id)).plannedFor).toBe(DATE);
    });

    it("the response is the Today payload for the saved plan", async () => {
      const b: Json = await (await put(base)).json();
      expect(b.date).toBe(DATE);
      expect(b.plan.frogTaskId).toBe(T["T1"].id);
      expect(b.frog.id).toBe(T["T1"].id);
      expect(b.frog.group.id).toBe(groupId);
      expect(titles(b.tasks).sort()).toEqual(["T1", "T2"]);
      expect(Object.keys(b).sort()).toEqual(["completedToday", "date", "frog", "openA", "plan", "streak", "tasks"]);
    });

    it("mixing the user's old plan: replacing T3 (planned+frog) with T1/T2 clears T3", async () => {
      expect((await taskRow(T["T3"].id)).plannedFor).toBe(DATE);
      await put(base);
      expect((await taskRow(T["T3"].id)).plannedFor).toBeNull();
      expect((await planRow()).frogTaskId).toBe(T["T1"].id);
    });
  });

  // ───────────────────────────── plannedAt / finalize ─────────────────────────────

  describe("plannedAt and finalize", () => {
    it("finalize stamps plannedAt with the server time", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-02T08:15:00Z"));
      const res = await put({ ...base, date: "2026-11-02", finalize: true });
      expect(res.status).toBe(200);
      expect((await planRow("owner-1", "2026-11-02")).plannedAt).toEqual(new Date("2026-11-02T08:15:00Z"));
      expect((await res.json()).plan.plannedAt).toBe("2026-11-02T08:15:00.000Z");
    });

    it("a non-finalize re-save keeps the earlier plannedAt (and still changes the frog)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-02T08:15:00Z"));
      await put({ ...base, date: "2026-11-02", finalize: true });
      vi.setSystemTime(new Date("2026-11-02T17:45:00Z"));
      expect((await put({ ...base, date: "2026-11-02", frogTaskId: T["T2"].id })).status).toBe(200);
      const plan = await planRow("owner-1", "2026-11-02");
      expect(plan.plannedAt).toEqual(new Date("2026-11-02T08:15:00Z"));
      expect(plan.frogTaskId).toBe(T["T2"].id);
      // explicit finalize: false is the same as omitting it
      expect((await put({ ...base, date: "2026-11-02", finalize: false })).status).toBe(200);
      expect((await planRow("owner-1", "2026-11-02")).plannedAt).toEqual(new Date("2026-11-02T08:15:00Z"));
    });

    it("a first save without finalize leaves plannedAt null; a later finalize stamps it", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-03T06:00:00Z"));
      await put({ ...base, date: "2026-11-03" });
      expect((await planRow("owner-1", "2026-11-03")).plannedAt).toBeNull();
      vi.setSystemTime(new Date("2026-11-03T06:30:00Z"));
      await put({ ...base, date: "2026-11-03", finalize: true });
      expect((await planRow("owner-1", "2026-11-03")).plannedAt).toEqual(new Date("2026-11-03T06:30:00Z"));
    });

    it("finalizing a plan that already had plannedAt re-stamps it", async () => {
      // pre-seeded plan for DATE has plannedAt 2026-10-24T07:00Z
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T09:30:00Z"));
      await put({ ...base, finalize: true });
      expect((await planRow()).plannedAt).toEqual(new Date("2026-10-24T09:30:00Z"));
    });

    it("never touches the evening-review fields (reviewedAt, wentWell, improve, rating)", async () => {
      await db.dailyPlan.update({
        where: { userId_date: { userId: "owner-1", date: DATE } },
        data: { reviewedAt: new Date("2026-10-24T22:00:00Z"), wentWell: "good", improve: "focus", rating: 4 },
      });
      await put({ ...base, finalize: true });
      expect(await planRow()).toMatchObject({ reviewedAt: new Date("2026-10-24T22:00:00Z"), wentWell: "good", improve: "focus", rating: 4 });
    });

    it("createdAt of an existing plan is preserved and the row id is stable across saves", async () => {
      const first = await planRow();
      await put(base);
      await put({ ...base, frogTaskId: T["T2"].id });
      const last = await planRow();
      expect(last.id).toBe(first.id);
      expect(last.createdAt).toEqual(first.createdAt);
    });
  });

  // ───────────────────────────── dropping tasks ─────────────────────────────

  describe("tasks dropped from taskIds", () => {
    it("get plannedFor cleared, while kept tasks stay planned", async () => {
      await db.task.updateMany({ where: { id: { in: [T["T1"].id, T["T2"].id] } }, data: { plannedFor: DATE } });
      expect((await put({ ...base, taskIds: [T["T1"].id], frogTaskId: T["T1"].id })).status).toBe(200);
      expect((await taskRow(T["T1"].id)).plannedFor).toBe(DATE);
      expect((await taskRow(T["T2"].id)).plannedFor).toBeNull();
      expect((await taskRow(T["T3"].id)).plannedFor).toBeNull(); // planned in beforeEach, not in the new list
    });

    it("archived, trashed and sub-tasks planned for the date are left alone", async () => {
      await db.task.update({ where: { id: T["Archived"].id }, data: { plannedFor: DATE } });
      await db.task.update({ where: { id: T["Trashed"].id }, data: { plannedFor: DATE } });
      await db.task.update({ where: { id: T["Sub"].id }, data: { plannedFor: DATE } });
      expect((await put(base)).status).toBe(200);
      for (const t of ["Archived", "Trashed", "Sub"]) expect((await taskRow(T[t].id)).plannedFor).toBe(DATE);
    });

    it("another user's tasks planned for the same date are NOT cleared", async () => {
      const f = await seedForeignUser(DATE);
      await put({ ...base, taskIds: [], frogTaskId: null });
      expect((await taskRow(f.tasks["SECRET planned"].id)).plannedFor).toBe(DATE);
      expect((await taskRow(f.tasks["SECRET frog"].id)).plannedFor).toBe(DATE);
      expect((await taskRow(f.tasks["SECRET frog sub"].id)).plannedFor).toBe(DATE);
      expect(await planRow("stranger")).toMatchObject({ frogTaskId: f.tasks["SECRET frog"].id });
    });

    it("tasks planned for a different date are not cleared", async () => {
      await put({ ...base, taskIds: [T["T1"].id], frogTaskId: null });
      expect((await taskRow(T["T4"].id)).plannedFor).toBe("2026-10-30");
    });

    it("dropping the frog from the list with a new frog (or null) updates the plan", async () => {
      await put(base);
      await put({ ...base, taskIds: [T["T2"].id], frogTaskId: T["T2"].id });
      expect((await planRow()).frogTaskId).toBe(T["T2"].id);
      expect((await taskRow(T["T1"].id)).plannedFor).toBeNull();
      await put({ ...base, taskIds: [T["T2"].id], frogTaskId: null });
      expect((await planRow()).frogTaskId).toBeNull();
    });

    it("an empty taskIds clears the whole day's plan but keeps (and nulls) the plan row", async () => {
      await put(base);
      const res = await put({ ...base, taskIds: [], frogTaskId: null });
      expect(res.status).toBe(200);
      expect(await db.task.count({ where: { plannedFor: DATE } })).toBe(0);
      expect(await planRow()).toMatchObject({ frogTaskId: null });
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: DATE } })).toBe(1);
      const b: Json = await res.json();
      expect(b.tasks).toEqual([]);
      expect(b.frog).toBeNull();
      expect(b.openA).toBe(0);
    });

    it("an empty taskIds on a date with no plan creates an empty plan and touches nothing else", async () => {
      expect((await put({ ...base, date: "2026-12-24", taskIds: [], frogTaskId: null })).status).toBe(200);
      expect(await planRow("owner-1", "2026-12-24")).toMatchObject({ frogTaskId: null });
      expect((await taskRow(T["T3"].id)).plannedFor).toBe(DATE);
    });
  });

  // ───────────────────────────── ranks ─────────────────────────────

  describe("ranks", () => {
    it("applies letter and rank to the planned tasks; an omitted rank means unranked", async () => {
      const res = await put({
        ...base,
        ranks: { [T["T1"].id]: { abcde: "A", abcdeRank: 1 }, [T["T2"].id]: { abcde: "B" } },
      });
      expect(res.status).toBe(200);
      expect(await taskRow(T["T1"].id)).toMatchObject({ abcde: "A", abcdeRank: 1 });
      expect(await taskRow(T["T2"].id)).toMatchObject({ abcde: "B", abcdeRank: null });
    });

    it("a null letter clears the letter AND the rank", async () => {
      await db.task.update({ where: { id: T["T1"].id }, data: { abcde: "A", abcdeRank: 3 } });
      expect(
        (await put({ ...base, ranks: { [T["T1"].id]: { abcde: null, abcdeRank: null } } })).status,
      ).toBe(200);
      expect(await taskRow(T["T1"].id)).toMatchObject({ abcde: null, abcdeRank: null });
    });

    it("a null letter with the rank key omitted also clears both", async () => {
      await db.task.update({ where: { id: T["T1"].id }, data: { abcde: "D", abcdeRank: 5 } });
      await put({ ...base, ranks: { [T["T1"].id]: { abcde: null } } });
      expect(await taskRow(T["T1"].id)).toMatchObject({ abcde: null, abcdeRank: null });
    });

    it("tasks without a ranks entry keep their letter and rank", async () => {
      await db.task.update({ where: { id: T["T2"].id }, data: { abcde: "C", abcdeRank: 7 } });
      await put({ ...base, ranks: { [T["T1"].id]: { abcde: "A", abcdeRank: 1 } } });
      expect(await taskRow(T["T2"].id)).toMatchObject({ abcde: "C", abcdeRank: 7 });
    });

    it("an empty ranks object changes no letters and writes no activity", async () => {
      await put({ ...base, ranks: {} });
      expect(await activities()).toHaveLength(0);
    });

    it("the highest valid rank (2147483647) round-trips", async () => {
      expect((await put({ ...base, ranks: { [T["T1"].id]: { abcde: "A", abcdeRank: 2_147_483_647 } } })).status).toBe(200);
      expect((await taskRow(T["T1"].id)).abcdeRank).toBe(2_147_483_647);
    });

    it("the sorted response reflects the new ranks", async () => {
      const b: Json = await (
        await put({
          ...base,
          ranks: { [T["T1"].id]: { abcde: "B", abcdeRank: 1 }, [T["T2"].id]: { abcde: "A", abcdeRank: 1 } },
        })
      ).json();
      expect(titles(b.tasks)).toEqual(["T2", "T1"]);
    });

    describe("abcde_changed activity", () => {
      it("is written only for REAL letter changes, with {from, to}, the task and the user", async () => {
        await db.task.updateMany({ where: { id: { in: [T["T1"].id, T["T2"].id] } }, data: { abcde: "A", abcdeRank: 1 } });
        const t3 = T["T3"].id;
        const t4 = T["T4"].id;
        await db.task.update({ where: { id: t4 }, data: { abcde: "E" } });
        const taskIds = [T["T1"].id, T["T2"].id, t3, t4];
        await put({
          ...base,
          taskIds,
          frogTaskId: T["T1"].id,
          ranks: {
            [T["T1"].id]: { abcde: "A", abcdeRank: 2 }, // same letter, new rank: no activity
            [T["T2"].id]: { abcde: "B", abcdeRank: 1 }, // A -> B
            [t3]: { abcde: null, abcdeRank: null }, // C -> null
            [t4]: { abcde: "A" }, // E -> A
          },
        });
        const rows = await activities();
        expect(rows).toHaveLength(3);
        const byTask = Object.fromEntries(rows.map((r: Json) => [r.taskId, r]));
        expect(byTask[T["T1"].id]).toBeUndefined();
        expect(byTask[T["T2"].id]).toMatchObject({ userId: "owner-1", action: "abcde_changed", metadata: { from: "A", to: "B" } });
        expect(byTask[t3]).toMatchObject({ userId: "owner-1", metadata: { from: "C", to: null } });
        expect(byTask[t4]).toMatchObject({ userId: "owner-1", metadata: { from: "E", to: "A" } });
        expect(await taskRow(T["T1"].id)).toMatchObject({ abcde: "A", abcdeRank: 2 });
      });

      it("a first label (null -> A) records {from: null, to: A}", async () => {
        await put({ ...base, ranks: { [T["T1"].id]: { abcde: "A", abcdeRank: 1 } } });
        const rows = await activities();
        expect(rows).toHaveLength(1);
        expect(rows[0].metadata).toEqual({ from: null, to: "A" });
        expect(rows[0].taskId).toBe(T["T1"].id);
      });

      it("null -> null (clearing nothing) writes nothing", async () => {
        await put({ ...base, ranks: { [T["T1"].id]: { abcde: null, abcdeRank: null } } });
        expect(await activities()).toHaveLength(0);
      });

      it("nothing is written for tasks that were only planned (no ranks entry)", async () => {
        await put(base);
        expect(await db.activity.count()).toBe(0);
      });

      it("re-sending the same ranks writes no second activity row", async () => {
        const body = { ...base, ranks: { [T["T1"].id]: { abcde: "A", abcdeRank: 1 } } };
        await put(body);
        await put(body);
        expect(await activities()).toHaveLength(1);
      });
    });
  });

  // ───────────────────────────── idempotence, isolation, concurrency ─────────────────────────────

  describe("idempotence", () => {
    it("PUTting the same body twice leaves the same data (ignoring updatedAt) and returns the same payload", async () => {
      const body = {
        ...base,
        taskIds: [T["T1"].id, T["T2"].id, T["T3"].id],
        ranks: { [T["T1"].id]: { abcde: "A", abcdeRank: 1 }, [T["T3"].id]: { abcde: "C" } },
      };
      const strip = (s: Awaited<ReturnType<typeof snapshot>>) => ({
        ...s,
        tasks: s.tasks.map((t: Json) => omit(t, "updatedAt")),
        plans: s.plans.map((p: Json) => omit(p, "updatedAt")),
      });
      const r1 = await (await put(body)).json();
      const s1 = strip(await snapshot());
      const r2 = await (await put(body)).json();
      const s2 = strip(await snapshot());
      expect(s2).toEqual(s1);
      const noStamp = (b: Json) => JSON.parse(JSON.stringify(b, (k, v) => (k === "updatedAt" ? undefined : v)));
      expect(noStamp(r2)).toEqual(noStamp(r1));
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date: DATE } })).toBe(1);
    });
  });

  describe("per-user isolation", () => {
    it("two users can plan the same date independently (unique is (userId, date))", async () => {
      const f = await seedForeignUser(DATE);
      const res = await put(base);
      expect(res.status).toBe(200);
      expectNoForeignData(await res.json(), f);
      expect(await db.dailyPlan.count({ where: { date: DATE } })).toBe(2);
      expect(await planRow("stranger")).toMatchObject({ frogTaskId: f.tasks["SECRET frog"].id, wentWell: "SECRET reflection" });
      expect(await planRow("owner-1")).toMatchObject({ frogTaskId: T["T1"].id });
      // the other user plans too, with their own task
      signInAs("stranger");
      const res2 = await put({ date: DATE, tz: TZ, taskIds: [f.tasks["SECRET backlog"].id], frogTaskId: f.tasks["SECRET backlog"].id });
      expect(res2.status).toBe(200);
      expect(await planRow("owner-1")).toMatchObject({ frogTaskId: T["T1"].id });
      expect((await taskRow(T["T1"].id)).plannedFor).toBe(DATE);
      const theirs: Json = await res2.json();
      expect(titles(theirs.tasks)).toEqual(["SECRET backlog"]);
      expect(JSON.stringify(theirs)).not.toContain(T["T1"].id);
    });

    it("the other user cannot plan MY tasks (404) and mine stay put", async () => {
      await seedForeignUser();
      signInAs("stranger");
      const snap = await snapshot();
      const res = await put({ date: DATE, tz: TZ, taskIds: [T["T1"].id, T["T3"].id], frogTaskId: T["T1"].id });
      expect(res.status).toBe(404);
      expect(await snapshot()).toEqual(snap);
    });
  });

  describe("concurrency", () => {
    it("two simultaneous PUTs for a brand-new date make exactly one DailyPlan (repeated 15 times)", async () => {
      for (let round = 0; round < 15; round++) {
        const date = `2027-01-${String(round + 1).padStart(2, "0")}`;
        const results = await Promise.all([
          put({ ...base, date, frogTaskId: T["T1"].id }),
          put({ ...base, date, frogTaskId: T["T2"].id }),
        ]);
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        expect(await db.dailyPlan.count({ where: { userId: "owner-1", date } })).toBe(1);
        expect([T["T1"].id, T["T2"].id]).toContain((await planRow("owner-1", date)).frogTaskId);
      }
    });

    it("six simultaneous finalizing PUTs for one date: one plan, all 200", async () => {
      const date = "2027-02-01";
      const results = await Promise.all(Array.from({ length: 6 }, () => put({ ...base, date, finalize: true })));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date } })).toBe(1);
      expect((await planRow("owner-1", date)).plannedAt).not.toBeNull();
    });

    it("simultaneous PUTs with overlapping task sets in opposite orders don't deadlock or 500", async () => {
      const date = "2027-02-02";
      const ids = [T["T1"].id, T["T2"].id, T["T3"].id, T["T4"].id];
      const results = await Promise.all([
        put({ date, tz: TZ, taskIds: ids, frogTaskId: ids[0] }),
        put({ date, tz: TZ, taskIds: [...ids].reverse(), frogTaskId: ids[3] }),
        put({ date, tz: TZ, taskIds: ids.slice(0, 2), frogTaskId: null }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(await db.dailyPlan.count({ where: { userId: "owner-1", date } })).toBe(1);
    });
  });

  // ───────────────────────────── response == GET ─────────────────────────────

  describe("response matches a following GET", () => {
    it("for a plain save", async () => {
      const res = await put(base);
      expect(await get().then((r) => r.json())).toEqual(await res.json());
    });

    it("for a rich plan: ranks, finalize, subtasks, a done task, a completed-today task, a streak", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T13:00:00Z"));
      const rich = await seedGroup("owner-1", {
        groupName: "Rich",
        statuses: [{ name: "To Do" }, { name: "Shipped", celebrate: true }, { name: "Done", celebrate: true }],
        tasks: [
          { title: "R frog" },
          { title: "R sub", parentTitle: "R frog" },
          { title: "R sub archived", parentTitle: "R frog", archivedAt: new Date() },
          { title: "R done", status: "Done", completedAt: new Date("2026-10-24T14:00:00Z") },
          { title: "R open" },
        ],
      });
      // yesterday's eaten frog => streak
      await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-23", frogTaskId: rich.tasks["R done"].id } });
      await db.task.update({ where: { id: rich.tasks["R done"].id }, data: { completedAt: new Date("2026-10-23T15:00:00Z") } });
      await db.task.update({ where: { id: rich.tasks["R open"].id }, data: { completedAt: null } });
      const done2 = (await seedGroup("owner-1", { tasks: [{ title: "Done today", status: "Done", completedAt: new Date("2026-10-24T15:00:00Z") }] })).tasks["Done today"];
      const res = await put({
        date: DATE,
        tz: TZ,
        taskIds: [rich.tasks["R frog"].id, rich.tasks["R done"].id, rich.tasks["R open"].id, done2.id, T["T1"].id],
        frogTaskId: rich.tasks["R frog"].id,
        finalize: true,
        ranks: {
          [rich.tasks["R frog"].id]: { abcde: "A", abcdeRank: 1 },
          [rich.tasks["R open"].id]: { abcde: "A", abcdeRank: 2 },
          [T["T1"].id]: { abcde: "C" },
        },
      });
      expect(res.status).toBe(200);
      const putBody: Json = await res.json();
      const getBody: Json = await (await get()).json();
      expect(getBody).toEqual(putBody);
      // spot-check the content so "equal" isn't two empty payloads
      expect(putBody.frog.title).toBe("R frog");
      expect(titles(putBody.frog.subtasks)).toEqual(["R sub"]);
      expect(putBody.frog.group.doneStatusId).toBe(rich.statuses["Shipped"].id);
      expect(titles(putBody.tasks)).toEqual(["R frog", "R open", "T1", "R done", "Done today"].sort((a, b) => titles(putBody.tasks).indexOf(a) - titles(putBody.tasks).indexOf(b)));
      expect(putBody.tasks.slice(0, 3).map((t: Json) => t.title)).toEqual(["R frog", "R open", "T1"]);
      expect(putBody.openA).toBe(2);
      expect(putBody.plan.plannedAt).toBe("2026-10-24T13:00:00.000Z");
    });

    it("for an emptied plan", async () => {
      await put(base);
      const res = await put({ ...base, taskIds: [], frogTaskId: null });
      expect(await get().then((r) => r.json())).toEqual(await res.json());
    });

    it("for a rejected request the GET is unchanged (a failed PUT leaves the day as it was)", async () => {
      const prior = await (await get()).json();
      expect((await put({ ...base, taskIds: [T["T1"].id, "nope"] })).status).toBe(404);
      expect(await (await get()).json()).toEqual(prior);
    });
  });

  // ───────────────────────────── scale and odd dates ─────────────────────────────

  describe("scale", () => {
    it("200 tasks in one PUT, each with a rank (so 200 updates and 200 activity rows): works and is fast enough", async () => {
      const { group, statuses } = await seedGroup("owner-1", { groupName: "Bulk" });
      const rows = Array.from({ length: 200 }, (_, i) => ({
        id: `bulk-${String(i).padStart(3, "0")}`,
        title: `bulk ${i}`,
        groupId: group.id,
        statusId: statuses["To Do"].id,
        createdBy: "owner-1",
        order: i,
      }));
      await db.task.createMany({ data: rows });
      const taskIds = rows.map((r) => r.id);
      const ranks = Object.fromEntries(taskIds.map((id, i) => [id, { abcde: (["A", "B", "C", "D", "E"] as const)[i % 5], abcdeRank: i + 1 }]));
      const t0 = Date.now();
      const res = await put({ date: DATE, tz: TZ, taskIds, frogTaskId: taskIds[0], ranks, finalize: true });
      const elapsed = Date.now() - t0;
      expect(res.status).toBe(200);
      expect(await db.task.count({ where: { plannedFor: DATE, id: { in: taskIds } } })).toBe(200);
      expect(await db.activity.count({ where: { action: "abcde_changed" } })).toBe(200);
      const b: Json = await res.json();
      expect(b.tasks).toHaveLength(200);
      expect(b.tasks[0].title).toBe("bulk 0"); // A-1
      expect(b.openA).toBe(40);
      expect(elapsed).toBeLessThan(8000);
      // and dropping all of them again
      expect((await put({ date: DATE, tz: TZ, taskIds: [], frogTaskId: null })).status).toBe(200);
      expect(await db.task.count({ where: { plannedFor: DATE } })).toBe(0);
    });

    it("200 existing tasks in taskIds, no ranks, is accepted exactly at the cap", async () => {
      const { group, statuses } = await seedGroup("owner-1", { groupName: "Cap" });
      const rows = Array.from({ length: 200 }, (_, i) => ({
        id: `cap-${i}`,
        title: `cap ${i}`,
        groupId: group.id,
        statusId: statuses["To Do"].id,
        createdBy: "owner-1",
      }));
      await db.task.createMany({ data: rows });
      expect((await put({ date: DATE, tz: TZ, taskIds: rows.map((r) => r.id), frogTaskId: null })).status).toBe(200);
    });

    // A response that is built AFTER the transaction commits must not 500 on dates the pure helpers can't
    // handle: the client would see an error although the plan was saved.
    it.each(["0001-01-01", "0000-01-01", "9999-12-31"])("an extreme but valid date %s never gives a 500", async (date) => {
      let res: Response | undefined;
      let thrown: unknown;
      try {
        res = await put({ ...base, date });
      } catch (e) {
        thrown = e; // a handler that throws is a 500 in Next
      }
      const saved = await planRow("owner-1", date);
      expect(
        thrown,
        `handler threw (a 500) AFTER the transaction committed; DailyPlan persisted: ${saved !== null}, plannedFor set on T1: ${(await taskRow(T["T1"].id)).plannedFor === date}`,
      ).toBeUndefined();
      expect([200, 400]).toContain(res!.status);
      if (res!.status === 400) expect(saved).toBeNull();
    });
  });
});
