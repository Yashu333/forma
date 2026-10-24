// M3: GET /api/today. Real route handler, real local Postgres, asserts the
// payload against what was seeded in the DB (`db` is typed any, so field-name
// typos only show up here).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { DATE, TZ, callGet, get, expectNoForeignData, seedForeignUser, ids, titles, type Json } from "./today-helpers";

const day = (key: string, h = 0, m = 0) => new Date(`${key}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

describe("GET /api/today", () => {
  beforeEach(() => {
    signInAs("owner-1");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ───────────────────────────── auth + validation ─────────────────────────────

  describe("auth and validation", () => {
    it("401 with no user (even with valid params)", async () => {
      setFakeUser(null);
      expect((await get()).status).toBe(401);
    });

    it("401 comes before validation (no user, no params)", async () => {
      setFakeUser(null);
      expect((await callGet("")).status).toBe(401);
    });

    it.each([
      ["missing", { tz: TZ }],
      ["empty", { date: "", tz: TZ }],
      ["2026-02-30 (no such day)", { date: "2026-02-30", tz: TZ }],
      ["2026-02-29 (not a leap year)", { date: "2026-02-29", tz: TZ }],
      ["2026-13-01", { date: "2026-13-01", tz: TZ }],
      ["2026-00-10", { date: "2026-00-10", tz: TZ }],
      ["2026-10-00", { date: "2026-10-00", tz: TZ }],
      ["2026-1-5 (not zero padded)", { date: "2026-1-5", tz: TZ }],
      ["20261024 (no dashes)", { date: "20261024", tz: TZ }],
      ["2026/10/24", { date: "2026/10/24", tz: TZ }],
      ["trailing junk", { date: "2026-10-24x", tz: TZ }],
      ["trailing newline", { date: "2026-10-24\n", tz: TZ }],
      ["a timestamp", { date: "2026-10-24T10:00:00Z", tz: TZ }],
      ["leading space", { date: " 2026-10-24", tz: TZ }],
      ["non-ASCII digits", { date: "２０２６-10-24", tz: TZ }],
    ])("400 for date %s, and the error is a message", async (_label, q) => {
      const res = await callGet(q as Record<string, string>);
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    });

    it.each([
      ["missing", { date: DATE }],
      ["empty", { date: DATE, tz: "" }],
      ["Mars/Base", { date: DATE, tz: "Mars/Base" }],
      ["+05:00 (an offset)", { date: DATE, tz: "+05:00" }],
      ["-05:00", { date: DATE, tz: "-05:00" }],
      ["a bare number", { date: DATE, tz: "5" }],
      ["garbage", { date: DATE, tz: "not a zone!" }],
      ["a very long string", { date: DATE, tz: "A".repeat(10_000) }],
      ["unicode", { date: DATE, tz: "Ευρώπη/Αθήνα" }],
    ])("400 for tz %s", async (_label, q) => {
      const res = await callGet(q);
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    });

    it("400 when both are missing, and for an empty query string", async () => {
      expect((await callGet("")).status).toBe(400);
      expect((await callGet("date&tz")).status).toBe(400);
    });

    it("uses the first value when a parameter is repeated, and still validates it", async () => {
      expect((await callGet(`date=${DATE}&date=garbage&tz=${TZ}`)).status).toBe(200);
      expect((await callGet(`date=garbage&date=${DATE}&tz=${TZ}`)).status).toBe(400);
    });

    it.each(["UTC", "Etc/GMT+12", "Etc/GMT-14", "Asia/Kolkata", "Pacific/Kiritimati", "utc"])("accepts tz %s", async (tz) => {
      expect((await get(DATE, tz)).status).toBe(200);
    });

    it.each(["0001-01-01", "0001-01-02", "0000-01-01", "0000-12-31", "9998-12-31", "9999-12-31", "9999-01-01"])(
      "never a 500 for the extreme date %s",
      async (date) => {
        const res = await get(date, "Pacific/Kiritimati");
        expect([200, 400]).toContain(res.status);
        if (res.status === 200) expect((await res.json()).date).toBe(date);
      },
    );
  });

  // ───────────────────────────── empty + shapes ─────────────────────────────

  it("an empty account gets an empty payload (not a 404 or 500)", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      date: DATE,
      plan: null,
      frog: null,
      tasks: [],
      completedToday: [],
      openA: 0,
      streak: { current: 0, longest: 0 },
    });
  });

  it("returns the plan row, the frog, tasks, completedToday, openA and streak in the documented shapes", async () => {
    const { group, statuses, tasks } = await seedGroup("owner-1", {
      groupName: "Work",
      tasks: [
        { title: "Frog", extra: { abcde: "A", abcdeRank: 1, plannedFor: DATE } },
        { title: "Frog sub", parentTitle: "Frog" },
        { title: "Other", extra: { abcde: "B", plannedFor: DATE } },
        { title: "Done one", status: "Done", completedAt: day(DATE, 15), extra: { plannedFor: DATE } },
      ],
    });
    const plannedAt = new Date("2026-10-24T11:00:00Z");
    await db.dailyPlan.create({
      data: { userId: "owner-1", date: DATE, frogTaskId: tasks["Frog"].id, plannedAt, wentWell: "ww", improve: "imp", rating: 4 },
    });

    const res = await get();
    expect(res.status).toBe(200);
    const b: Json = await res.json();

    expect(Object.keys(b).sort()).toEqual(["completedToday", "date", "frog", "openA", "plan", "streak", "tasks"]);
    expect(b.date).toBe(DATE);
    expect(b.plan).toMatchObject({
      userId: "owner-1",
      date: DATE,
      frogTaskId: tasks["Frog"].id,
      plannedAt: plannedAt.toISOString(),
      reviewedAt: null,
      wentWell: "ww",
      improve: "imp",
      rating: 4,
    });
    expect(typeof b.plan.id).toBe("string");

    // frog: full task + group (with doneStatusId) + subtasks
    expect(b.frog).toMatchObject({
      id: tasks["Frog"].id,
      title: "Frog",
      abcde: "A",
      abcdeRank: 1,
      plannedFor: DATE,
      group: { id: group.id, name: "Work", color: group.color, doneStatusId: statuses["Done"].id },
    });
    expect(titles(b.frog.subtasks)).toEqual(["Frog sub"]);

    // tasks: each carries group {id,name,color,doneStatusId} and nothing else
    expect(titles(b.tasks)).toEqual(["Frog", "Other", "Done one"]);
    for (const t of b.tasks) {
      expect(Object.keys(t.group).sort()).toEqual(["color", "doneStatusId", "id", "name"]);
      expect(t.group).toEqual({ id: group.id, name: "Work", color: group.color, doneStatusId: statuses["Done"].id });
      expect(t.plannedFor).toBe(DATE);
    }

    expect(b.completedToday).toHaveLength(1);
    expect(b.completedToday[0]).toMatchObject({
      id: tasks["Done one"].id,
      title: "Done one",
      abcde: null,
      group: { name: "Work", color: group.color },
    });
    expect(b.openA).toBe(1);
    expect(b.streak).toEqual({ current: 0, longest: 0 });
  });

  // ───────────────────────────── tasks list ─────────────────────────────

  describe("tasks", () => {
    it("is exactly the user's top-level, non-deleted, non-archived tasks planned for that date", async () => {
      const { tasks } = await seedGroup("owner-1", {
        tasks: [
          { title: "In" },
          { title: "Other day", extra: { plannedFor: "2026-10-25" } },
          { title: "Backlog" },
          { title: "Trashed", deletedAt: new Date(), extra: { plannedFor: DATE } },
          { title: "Archived", archivedAt: new Date(), extra: { plannedFor: DATE } },
          { title: "Parent" },
          { title: "Sub", parentTitle: "Parent", extra: { plannedFor: DATE } },
        ],
      });
      await db.task.update({ where: { id: tasks["In"].id }, data: { plannedFor: DATE } });
      const b: Json = await (await get()).json();
      expect(titles(b.tasks)).toEqual(["In"]);
      // the same call for the neighbouring date sees only its own task
      expect(titles((await (await get("2026-10-25")).json()).tasks)).toEqual(["Other day"]);
    });

    it("is sorted with compareTasks: letter, rank, priority, order; unlabelled last", async () => {
      await seedGroup("owner-1", {
        tasks: [
          // board order = position in this list
          { title: "none-low", priority: "LOW", extra: { plannedFor: DATE } },
          { title: "B", extra: { abcde: "B", plannedFor: DATE } },
          { title: "A-unranked-med", extra: { abcde: "A", plannedFor: DATE } },
          { title: "A-2", extra: { abcde: "A", abcdeRank: 2, plannedFor: DATE } },
          { title: "A-1", extra: { abcde: "A", abcdeRank: 1, plannedFor: DATE } },
          { title: "A-unranked-urgent", priority: "URGENT", extra: { abcde: "A", plannedFor: DATE } },
          { title: "E", extra: { abcde: "E", plannedFor: DATE } },
          { title: "C-2", extra: { abcde: "C", abcdeRank: 2, plannedFor: DATE } },
          { title: "C-1", extra: { abcde: "C", abcdeRank: 1, plannedFor: DATE } },
          { title: "none-urgent", priority: "URGENT", extra: { plannedFor: DATE } },
          { title: "D", extra: { abcde: "D", plannedFor: DATE } },
        ],
      });
      const b: Json = await (await get()).json();
      expect(titles(b.tasks)).toEqual([
        "A-1",
        "A-2",
        "A-unranked-urgent",
        "A-unranked-med",
        "B",
        "C-1",
        "C-2",
        "D",
        "E",
        "none-urgent",
        "none-low",
      ]);
    });

    it("sorts across projects too (compareTasks only, not by project)", async () => {
      await seedGroup("owner-1", { groupName: "P1", tasks: [{ title: "p1-B", extra: { abcde: "B", plannedFor: DATE } }] });
      await seedGroup("owner-1", { groupName: "P2", tasks: [{ title: "p2-A", extra: { abcde: "A", plannedFor: DATE } }] });
      const b: Json = await (await get()).json();
      expect(titles(b.tasks)).toEqual(["p2-A", "p1-B"]);
    });

    it("includes done tasks with their completedAt, and keeps them in the sorted list", async () => {
      const completedAt = day(DATE, 14, 5);
      await seedGroup("owner-1", {
        tasks: [
          { title: "Open A", extra: { abcde: "A", plannedFor: DATE } },
          { title: "Done A", status: "Done", completedAt, extra: { abcde: "A", abcdeRank: 1, plannedFor: DATE } },
        ],
      });
      const b: Json = await (await get()).json();
      expect(titles(b.tasks)).toEqual(["Done A", "Open A"]);
      expect(b.tasks[0].completedAt).toBe(completedAt.toISOString());
      expect(b.tasks[1].completedAt).toBeNull();
    });

    it("tasks planned for the date are returned whatever tz is used (it only matters for completedToday/streak)", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "T", extra: { plannedFor: DATE } }] });
      for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12", "UTC"]) {
        expect(titles((await (await get(DATE, tz)).json()).tasks)).toEqual(["T"]);
      }
    });
  });

  // ───────────────────────────── doneStatusId ─────────────────────────────

  describe("group.doneStatusId", () => {
    it("is the FIRST celebrate status by order when a group has two", async () => {
      const { statuses } = await seedGroup("owner-1", {
        statuses: [{ name: "To Do" }, { name: "Shipped", celebrate: true }, { name: "Done", celebrate: true }],
        tasks: [{ title: "T", extra: { plannedFor: DATE } }],
      });
      const b: Json = await (await get()).json();
      expect(b.tasks[0].group.doneStatusId).toBe(statuses["Shipped"].id);
    });

    it("follows board `order`, not creation order or name", async () => {
      const { statuses } = await seedGroup("owner-1", {
        statuses: [{ name: "To Do" }, { name: "Alpha", celebrate: true }, { name: "Zulu", celebrate: true }],
        tasks: [{ title: "T", extra: { plannedFor: DATE } }],
      });
      // Reorder the board: Zulu now comes before Alpha.
      await db.status.update({ where: { id: statuses["Zulu"].id }, data: { order: 0.5 } });
      const b: Json = await (await get()).json();
      expect(b.tasks[0].group.doneStatusId).toBe(statuses["Zulu"].id);
    });

    it("ignores non-celebrate statuses that sort before the celebrate one", async () => {
      const { statuses } = await seedGroup("owner-1", {
        statuses: [{ name: "Done", celebrate: true }, { name: "To Do" }],
        tasks: [{ title: "T", extra: { plannedFor: DATE } }],
      });
      await db.status.update({ where: { id: statuses["To Do"].id }, data: { order: -5 } });
      expect((await (await get()).json()).tasks[0].group.doneStatusId).toBe(statuses["Done"].id);
    });

    it("is null when the group has no celebrate status", async () => {
      await seedGroup("owner-1", {
        statuses: [{ name: "To Do" }, { name: "Doing" }],
        tasks: [{ title: "T", extra: { plannedFor: DATE, abcde: "A" } }],
      });
      const b: Json = await (await get()).json();
      expect(b.tasks[0].group.doneStatusId).toBeNull();
      expect("doneStatusId" in b.tasks[0].group).toBe(true);
    });

    it("is computed per group, and never points at another group's status", async () => {
      const a = await seedGroup("owner-1", {
        groupName: "WithDone",
        tasks: [{ title: "a", extra: { plannedFor: DATE } }],
      });
      await seedGroup("owner-1", {
        groupName: "NoDone",
        statuses: [{ name: "Open" }],
        tasks: [{ title: "b", extra: { plannedFor: DATE } }],
      });
      const b: Json = await (await get()).json();
      const byTitle = Object.fromEntries(b.tasks.map((t: Json) => [t.title, t.group.doneStatusId]));
      expect(byTitle).toEqual({ a: a.statuses["Done"].id, b: null });
    });

    it("the group payload does not leak the raw statuses array", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "T", extra: { plannedFor: DATE } }] });
      const b: Json = await (await get()).json();
      expect("statuses" in b.tasks[0].group).toBe(false);
    });
  });

  // ───────────────────────────── openA ─────────────────────────────

  describe("openA", () => {
    it("counts only A tasks that are not done", async () => {
      await seedGroup("owner-1", {
        tasks: [
          { title: "A open 1", extra: { abcde: "A", plannedFor: DATE } },
          { title: "A open 2", extra: { abcde: "A", abcdeRank: 2, plannedFor: DATE } },
          { title: "A done", status: "Done", extra: { abcde: "A", plannedFor: DATE } },
          { title: "B open", extra: { abcde: "B", plannedFor: DATE } },
          { title: "none", extra: { plannedFor: DATE } },
          { title: "A other day", extra: { abcde: "A", plannedFor: "2026-10-25" } },
          { title: "A trashed", deletedAt: new Date(), extra: { abcde: "A", plannedFor: DATE } },
          { title: "A archived", archivedAt: new Date(), extra: { abcde: "A", plannedFor: DATE } },
        ],
      });
      const b: Json = await (await get()).json();
      expect(b.tasks).toHaveLength(5);
      expect(b.openA).toBe(2);
    });

    it("is 0 when every A task is done", async () => {
      await seedGroup("owner-1", {
        tasks: [{ title: "A done", status: "Done", extra: { abcde: "A", plannedFor: DATE } }],
      });
      expect((await (await get()).json()).openA).toBe(0);
    });
  });

  // ───────────────────────────── frog ─────────────────────────────

  describe("frog", () => {
    it("is null when the plan has no frog", async () => {
      await db.dailyPlan.create({ data: { userId: "owner-1", date: DATE, frogTaskId: null } });
      const b: Json = await (await get()).json();
      expect(b.plan).toMatchObject({ date: DATE, frogTaskId: null });
      expect(b.frog).toBeNull();
    });

    it("includes group.doneStatusId (null when the project has no Done column)", async () => {
      const { tasks } = await seedGroup("owner-1", {
        statuses: [{ name: "Open" }],
        tasks: [{ title: "Frog", extra: { plannedFor: DATE } }],
      });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: DATE, frogTaskId: tasks["Frog"].id } });
      const b: Json = await (await get()).json();
      expect(b.frog.group.doneStatusId).toBeNull();
      expect("statuses" in b.frog.group).toBe(false);
    });

    it("carries only active subtasks (not trashed, not archived), in board order", async () => {
      const { tasks } = await seedGroup("owner-1", {
        tasks: [
          { title: "Frog", extra: { plannedFor: DATE } },
          { title: "sub 1", parentTitle: "Frog" },
          { title: "sub trashed", parentTitle: "Frog", deletedAt: new Date() },
          { title: "sub archived", parentTitle: "Frog", archivedAt: new Date() },
          { title: "sub 2", parentTitle: "Frog" },
          { title: "sub done", parentTitle: "Frog", status: "Done" },
          { title: "Unrelated", extra: { plannedFor: DATE } },
          { title: "Unrelated sub", parentTitle: "Unrelated" },
        ],
      });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: DATE, frogTaskId: tasks["Frog"].id } });
      const b: Json = await (await get()).json();
      expect(titles(b.frog.subtasks)).toEqual(["sub 1", "sub 2", "sub done"]);
      // done subtasks are kept (so the card can show them checked off)
      expect(b.frog.subtasks[2].completedAt).not.toBeNull();
      // sub-tasks never leak into the day's task list
      expect(titles(b.tasks)).toEqual(["Frog", "Unrelated"]);
    });

    it("is null when the frog task is in the trash, but the plan row is still returned", async () => {
      const { tasks } = await seedGroup("owner-1", { tasks: [{ title: "Frog", deletedAt: new Date() }] });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: DATE, frogTaskId: tasks["Frog"].id } });
      const b: Json = await (await get()).json();
      expect(b.frog).toBeNull();
      expect(b.plan.frogTaskId).toBe(tasks["Frog"].id);
    });

    it("is still returned when the frog was archived after being eaten", async () => {
      const { tasks } = await seedGroup("owner-1", {
        tasks: [{ title: "Frog", status: "Done", archivedAt: new Date(), completedAt: day(DATE, 15), extra: { plannedFor: DATE } }],
      });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: DATE, frogTaskId: tasks["Frog"].id } });
      const b: Json = await (await get()).json();
      expect(b.frog?.id).toBe(tasks["Frog"].id);
      expect(b.tasks).toEqual([]); // archived tasks are not in the list
    });

    it("a frog that is not in the day's tasks list (e.g. planned for another day) is still returned", async () => {
      const { tasks } = await seedGroup("owner-1", { tasks: [{ title: "Frog" }] });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: DATE, frogTaskId: tasks["Frog"].id } });
      const b: Json = await (await get()).json();
      expect(b.frog.id).toBe(tasks["Frog"].id);
      expect(b.tasks).toEqual([]);
    });

    it("a plan pointing at ANOTHER user's task yields frog: null and none of its data", async () => {
      const foreign = await seedForeignUser();
      await db.dailyPlan.create({ data: { userId: "owner-1", date: DATE, frogTaskId: foreign.tasks["SECRET frog"].id } });
      const res: Json = await (await get()).json();
      expect(res.frog).toBeNull();
      // (the plan row itself holds only the id the user's own row already stored)
      expect(JSON.stringify({ ...res, plan: null })).not.toContain("SECRET");
    });

    it("only reads the plan of the requested date", async () => {
      const { tasks } = await seedGroup("owner-1", { tasks: [{ title: "Today frog" }, { title: "Tomorrow frog" }] });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: DATE, frogTaskId: tasks["Today frog"].id } });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-25", frogTaskId: tasks["Tomorrow frog"].id } });
      expect((await (await get()).json()).frog.title).toBe("Today frog");
      expect((await (await get("2026-10-25")).json()).frog.title).toBe("Tomorrow frog");
      expect((await (await get("2026-10-26")).json()).frog).toBeNull();
    });
  });

  // ───────────────────────────── completedToday ─────────────────────────────

  describe("completedToday", () => {
    it("lists top-level, non-deleted tasks completed on that local date, oldest first, in the documented shape", async () => {
      // New York is UTC-4 on 2026-10-24, so local Oct 24 = 04:00Z Oct 24 .. 04:00Z Oct 25.
      const { group } = await seedGroup("owner-1", {
        groupName: "Work",
        tasks: [
          { title: "late", status: "Done", completedAt: day("2026-10-25", 3, 59), extra: { abcde: "B" } },
          { title: "early", status: "Done", completedAt: day("2026-10-24", 4, 0), extra: { abcde: "A", abcdeRank: 3 } },
          { title: "midday", status: "Done", completedAt: day("2026-10-24", 16) },
          { title: "too early", status: "Done", completedAt: day("2026-10-24", 3, 59) },
          { title: "too late", status: "Done", completedAt: day("2026-10-25", 4, 0) },
          { title: "trashed", status: "Done", completedAt: day("2026-10-24", 16), deletedAt: new Date() },
          { title: "open", extra: { plannedFor: DATE } },
          { title: "Parent" },
          { title: "sub done", parentTitle: "Parent", status: "Done", completedAt: day("2026-10-24", 16) },
        ],
      });
      const b: Json = await (await get()).json();
      expect(titles(b.completedToday)).toEqual(["early", "midday", "late"]);
      expect(b.completedToday[0]).toMatchObject({
        title: "early",
        abcde: "A",
        group: { name: "Work", color: group.color },
      });
      expect(b.completedToday[2].abcde).toBe("B");
    });

    it("includes tasks that were not planned for the day, and archived ones (completed work is completed work)", async () => {
      await seedGroup("owner-1", {
        tasks: [
          { title: "unplanned", status: "Done", completedAt: day(DATE, 16) },
          { title: "archived after done", status: "Done", archivedAt: new Date(), completedAt: day(DATE, 17) },
        ],
      });
      const b: Json = await (await get()).json();
      expect(titles(b.completedToday)).toEqual(["unplanned", "archived after done"]);
      expect(b.tasks).toEqual([]);
    });

    it("never lists another user's completed tasks", async () => {
      const foreign = await seedForeignUser();
      await seedGroup("owner-1", { tasks: [{ title: "mine", status: "Done", completedAt: day(DATE, 16) }] });
      const b: Json = await (await get()).json();
      expect(titles(b.completedToday)).toEqual(["mine"]);
      expectNoForeignData(b, foreign);
    });

    it("a task that was reopened (completedAt cleared) is not listed", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "reopened", extra: { completedAt: null } }] });
      expect((await (await get()).json()).completedToday).toEqual([]);
    });

    // ---- the time-zone edge, from the spec ----

    it("America/New_York: done at 23:30 local (the NEXT day in UTC) shows for that local date, NOT the next one", async () => {
      // 2026-10-24 23:30 EDT = 2026-10-25T03:30Z
      await seedGroup("owner-1", { tasks: [{ title: "late night", status: "Done", completedAt: new Date("2026-10-25T03:30:00Z") }] });
      const sameDay: Json = await (await get("2026-10-24", "America/New_York")).json();
      expect(titles(sameDay.completedToday)).toEqual(["late night"]);
      const nextDay: Json = await (await get("2026-10-25", "America/New_York")).json();
      expect(nextDay.completedToday).toEqual([]);
      // ... while in UTC the very same task belongs to the 25th
      expect(titles((await (await get("2026-10-25", "UTC")).json()).completedToday)).toEqual(["late night"]);
      expect((await (await get("2026-10-24", "UTC")).json()).completedToday).toEqual([]);
    });

    it("Pacific/Auckland (+13 in January): 00:30 local on the 16th is still the 15th in UTC", async () => {
      // 2026-01-15 23:30 NZDT = 2026-01-15T10:30Z; 2026-01-16 00:30 NZDT = 2026-01-15T11:30Z
      await seedGroup("owner-1", {
        tasks: [
          { title: "before midnight", status: "Done", completedAt: new Date("2026-01-15T10:30:00Z") },
          { title: "after midnight", status: "Done", completedAt: new Date("2026-01-15T11:30:00Z") },
        ],
      });
      const tz = "Pacific/Auckland";
      expect(titles((await (await get("2026-01-15", tz)).json()).completedToday)).toEqual(["before midnight"]);
      expect(titles((await (await get("2026-01-16", tz)).json()).completedToday)).toEqual(["after midnight"]);
      // UTC sees both on the 15th
      expect(titles((await (await get("2026-01-15", "UTC")).json()).completedToday)).toEqual(["before midnight", "after midnight"]);
      expect((await (await get("2026-01-14", tz)).json()).completedToday).toEqual([]);
    });

    it("Asia/Kolkata (+5:30): 23:59 and 00:00 local are 18:29Z and 18:30Z", async () => {
      await seedGroup("owner-1", {
        tasks: [
          { title: "23:59", status: "Done", completedAt: new Date("2026-01-15T18:29:59.999Z") },
          { title: "00:00", status: "Done", completedAt: new Date("2026-01-15T18:30:00.000Z") },
        ],
      });
      const tz = "Asia/Kolkata";
      expect(titles((await (await get("2026-01-15", tz)).json()).completedToday)).toEqual(["23:59"]);
      expect(titles((await (await get("2026-01-16", tz)).json()).completedToday)).toEqual(["00:00"]);
    });

    // First and last millisecond of local day 2026-01-15 (no DST changes then), offsets in minutes from UTC,
    // from UTC-12 to UTC+14, including half-hour and 45-minute zones.
    const ZONES: [string, number][] = [
      ["Etc/GMT+12", -720],
      ["Pacific/Pago_Pago", -660],
      ["Pacific/Honolulu", -600],
      ["America/Anchorage", -540],
      ["America/Los_Angeles", -480],
      ["America/Denver", -420],
      ["America/Chicago", -360],
      ["America/New_York", -300],
      ["America/Halifax", -240],
      ["America/Sao_Paulo", -180],
      ["Atlantic/Azores", -60],
      ["UTC", 0],
      ["Europe/Berlin", 60],
      ["Europe/Moscow", 180],
      ["Asia/Kolkata", 330],
      ["Asia/Kathmandu", 345],
      ["Asia/Tokyo", 540],
      ["Australia/Adelaide", 630],
      ["Australia/Lord_Howe", 660],
      ["Pacific/Auckland", 780],
      ["Pacific/Apia", 780],
      ["Pacific/Chatham", 825],
      ["Pacific/Kiritimati", 840],
      ["Etc/GMT-14", 840],
    ];
    it.each(ZONES)("window edges are exact in %s (first/last ms of the local day, both sides)", async (tz, offMin) => {
      const startMs = Date.UTC(2026, 0, 15) - offMin * 60_000; // local 2026-01-15 00:00:00.000
      const dayMs = 24 * 3_600_000;
      // sanity: the table's offset really is this zone's offset on that day
      const local = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: tz });
      expect([local(startMs - 1), local(startMs), local(startMs + dayMs - 1), local(startMs + dayMs)]).toEqual([
        "2026-01-14",
        "2026-01-15",
        "2026-01-15",
        "2026-01-16",
      ]);
      await seedGroup("owner-1", {
        tasks: [
          { title: "prev-last", status: "Done", completedAt: new Date(startMs - 1) },
          { title: "first", status: "Done", completedAt: new Date(startMs) },
          { title: "mid", status: "Done", completedAt: new Date(startMs + dayMs / 2) },
          { title: "last", status: "Done", completedAt: new Date(startMs + dayMs - 1) },
          { title: "next-first", status: "Done", completedAt: new Date(startMs + dayMs) },
        ],
      });
      const on = async (d: string) => titles((await (await get(d, tz)).json()).completedToday);
      expect(await on("2026-01-14")).toEqual(["prev-last"]);
      expect(await on("2026-01-15")).toEqual(["first", "mid", "last"]);
      expect(await on("2026-01-16")).toEqual(["next-first"]);
    });

    it("DST spring-forward day in New York (23 hours long): 2026-03-08", async () => {
      // local midnight = 05:00Z (EST); the day ends at 04:00Z on the 9th (EDT)
      await seedGroup("owner-1", {
        tasks: [
          { title: "prev", status: "Done", completedAt: new Date("2026-03-08T04:59:59.999Z") },
          { title: "first", status: "Done", completedAt: new Date("2026-03-08T05:00:00.000Z") },
          { title: "last", status: "Done", completedAt: new Date("2026-03-09T03:59:59.999Z") },
          { title: "next", status: "Done", completedAt: new Date("2026-03-09T04:00:00.000Z") },
        ],
      });
      const on = async (d: string) => titles((await (await get(d, "America/New_York")).json()).completedToday);
      expect(await on("2026-03-07")).toEqual(["prev"]);
      expect(await on("2026-03-08")).toEqual(["first", "last"]);
      expect(await on("2026-03-09")).toEqual(["next"]);
    });

    it("DST fall-back day in New York (25 hours long): 2026-11-01", async () => {
      // local midnight = 04:00Z (EDT); the day ends at 05:00Z on the 2nd (EST)
      await seedGroup("owner-1", {
        tasks: [
          { title: "prev", status: "Done", completedAt: new Date("2026-11-01T03:59:59.999Z") },
          { title: "first", status: "Done", completedAt: new Date("2026-11-01T04:00:00.000Z") },
          { title: "repeated hour", status: "Done", completedAt: new Date("2026-11-01T06:30:00.000Z") },
          { title: "last", status: "Done", completedAt: new Date("2026-11-02T04:59:59.999Z") },
          { title: "next", status: "Done", completedAt: new Date("2026-11-02T05:00:00.000Z") },
        ],
      });
      const on = async (d: string) => titles((await (await get(d, "America/New_York")).json()).completedToday);
      expect(await on("2026-10-31")).toEqual(["prev"]);
      expect(await on("2026-11-01")).toEqual(["first", "repeated hour", "last"]);
      expect(await on("2026-11-02")).toEqual(["next"]);
    });

    it("year boundary: 23:30 on Dec 31 in New York is Jan 1 in UTC", async () => {
      await seedGroup("owner-1", { tasks: [{ title: "nye", status: "Done", completedAt: new Date("2027-01-01T04:30:00Z") }] });
      expect(titles((await (await get("2026-12-31", "America/New_York")).json()).completedToday)).toEqual(["nye"]);
      expect((await (await get("2027-01-01", "America/New_York")).json()).completedToday).toEqual([]);
    });
  });

  // ───────────────────────────── streak ─────────────────────────────

  describe("streak", () => {
    // Seeds one frog task + DailyPlan per entry. `eatenOn` is the instant the frog was completed (null = still open).
    async function seedPlans(userId: string, entries: { date: string; completedAt: Date | null }[]) {
      const { group, statuses } = await seedGroup(userId, { groupName: `${userId}-streak` });
      for (const [i, e] of entries.entries()) {
        const task = await db.task.create({
          data: {
            title: `${userId} frog ${e.date}`,
            groupId: group.id,
            statusId: e.completedAt ? statuses["Done"].id : statuses["To Do"].id,
            createdBy: userId,
            order: i,
            completedAt: e.completedAt,
          },
        });
        await db.dailyPlan.create({ data: { userId, date: e.date, frogTaskId: task.id } });
      }
    }
    // Eaten at noon UTC on the plan date: the same local date in every zone used below.
    const eaten = (date: string) => ({ date, completedAt: new Date(`${date}T12:00:00Z`) });
    const open = (date: string) => ({ date, completedAt: null });
    const streakOf = async (date: string, tz = "UTC") => (await (await get(date, tz)).json()).streak;

    it("counts consecutive eaten days up to and including today", async () => {
      await seedPlans("owner-1", [eaten("2026-10-21"), eaten("2026-10-22"), eaten("2026-10-23"), eaten("2026-10-24")]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 4, longest: 4 });
    });

    it("an uneaten frog TODAY doesn't break the current streak", async () => {
      await seedPlans("owner-1", [eaten("2026-10-22"), eaten("2026-10-23"), open("2026-10-24")]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 2, longest: 2 });
    });

    it("no plan today yet doesn't break it either", async () => {
      await seedPlans("owner-1", [eaten("2026-10-22"), eaten("2026-10-23")]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 2, longest: 2 });
    });

    it("a gap day (no plan) breaks the current streak; longest remembers the old run", async () => {
      await seedPlans("owner-1", [
        eaten("2026-10-17"),
        eaten("2026-10-18"),
        eaten("2026-10-19"),
        // 10-20 and 10-21: no plan
        eaten("2026-10-22"),
        eaten("2026-10-23"),
        eaten("2026-10-24"),
      ]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 3, longest: 3 });
      expect(await streakOf("2026-10-23")).toEqual({ current: 2, longest: 3 });
    });

    it("a gap in the middle splits runs: 3, gap, 2 → longest 3, current 2", async () => {
      await seedPlans("owner-1", [
        eaten("2026-10-15"),
        eaten("2026-10-16"),
        eaten("2026-10-17"),
        eaten("2026-10-19"),
        eaten("2026-10-20"),
      ]);
      expect(await streakOf("2026-10-20")).toEqual({ current: 2, longest: 3 });
    });

    it("an UNEATEN frog on a past day breaks the streak", async () => {
      await seedPlans("owner-1", [eaten("2026-10-21"), eaten("2026-10-22"), open("2026-10-23"), eaten("2026-10-24")]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 1, longest: 2 });
    });

    it("a plan with no frog breaks the streak", async () => {
      await seedPlans("owner-1", [eaten("2026-10-21"), eaten("2026-10-23"), eaten("2026-10-24")]);
      await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-22", frogTaskId: null } });
      expect(await streakOf("2026-10-24")).toEqual({ current: 2, longest: 2 });
    });

    it("a frog completed the DAY AFTER its plan date is not eaten for that day", async () => {
      await seedPlans("owner-1", [
        eaten("2026-10-21"),
        eaten("2026-10-22"),
        // planned for the 23rd, but only finished on the 24th
        { date: "2026-10-23", completedAt: new Date("2026-10-24T09:00:00Z") },
        eaten("2026-10-24"),
      ]);
      // 23rd not eaten → current is just today; longest is the 21st–22nd run (and 24th alone)
      expect(await streakOf("2026-10-24")).toEqual({ current: 1, longest: 2 });
    });

    it("...and when that late-finished frog is the only thing on the 23rd, yesterday is NOT eaten", async () => {
      await seedPlans("owner-1", [eaten("2026-10-22"), { date: "2026-10-23", completedAt: new Date("2026-10-24T09:00:00Z") }]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 0, longest: 1 });
    });

    it("a frog finished EARLIER than its plan date still counts for that day (<=)", async () => {
      await seedPlans("owner-1", [{ date: "2026-10-24", completedAt: new Date("2026-10-22T09:00:00Z") }]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 1, longest: 1 });
    });

    it("eaten-ness is judged in the request's tz: 22:30 New York on the 15th is the 16th in UTC", async () => {
      // planned for 2026-01-15, finished 2026-01-16T03:30Z = 01-15 22:30 EST
      await seedPlans("owner-1", [{ date: "2026-01-15", completedAt: new Date("2026-01-16T03:30:00Z") }]);
      expect(await streakOf("2026-01-16", "America/New_York")).toEqual({ current: 1, longest: 1 });
      expect(await streakOf("2026-01-16", "UTC")).toEqual({ current: 0, longest: 0 });
    });

    it("ignores plans dated after today (tomorrow's preselected frog)", async () => {
      await seedPlans("owner-1", [eaten("2026-10-23"), eaten("2026-10-24"), eaten("2026-10-25"), eaten("2026-10-26")]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 2, longest: 2 });
    });

    it("is computed from ALL plans, not a recent window (120 consecutive days)", async () => {
      const { group, statuses } = await seedGroup("owner-1");
      const start = Date.UTC(2026, 5, 27); // 2026-06-27 .. 2026-10-24 = 120 days
      const keys = Array.from({ length: 120 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
      expect(keys[119]).toBe("2026-10-24");
      const taskIds = keys.map((_, i) => `frog-task-${i}`);
      await db.task.createMany({
        data: keys.map((k, i) => ({
          id: taskIds[i],
          title: `f${k}`,
          groupId: group.id,
          statusId: statuses["Done"].id,
          createdBy: "owner-1",
          completedAt: new Date(`${k}T12:00:00Z`),
        })),
      });
      await db.dailyPlan.createMany({
        data: keys.map((k, i) => ({ userId: "owner-1", date: k, frogTaskId: taskIds[i] })),
      });
      expect(await streakOf("2026-10-24")).toEqual({ current: 120, longest: 120 });
    });

    it("another user's plans never count", async () => {
      await seedPlans("stranger", [eaten("2026-10-22"), eaten("2026-10-23"), eaten("2026-10-24")]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 0, longest: 0 });
      await seedPlans("owner-1", [eaten("2026-10-24")]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 1, longest: 1 });
    });

    it("each user sees their own streak for the same date", async () => {
      await seedPlans("owner-1", [eaten("2026-10-23"), eaten("2026-10-24")]);
      await seedPlans("owner-2", [eaten("2026-10-24")]);
      expect(await streakOf("2026-10-24")).toEqual({ current: 2, longest: 2 });
      signInAs("owner-2");
      expect(await streakOf("2026-10-24")).toEqual({ current: 1, longest: 1 });
    });
  });

  // ───────────────────────────── isolation, scale ─────────────────────────────

  describe("isolation", () => {
    it("nothing of another user's ever appears, even when they planned the same date", async () => {
      const foreign = await seedForeignUser();
      await seedGroup("owner-1", {
        tasks: [
          { title: "mine", extra: { plannedFor: DATE, abcde: "A" } },
          { title: "my done", status: "Done", completedAt: day(DATE, 16) },
        ],
      });
      const res = await get();
      const b: Json = await res.json();
      expect(titles(b.tasks)).toEqual(["mine"]);
      expect(titles(b.completedToday)).toEqual(["my done"]);
      expect(b.plan).toBeNull();
      expect(b.frog).toBeNull();
      expectNoForeignData(b, foreign);
      // and the reverse
      signInAs("stranger");
      const theirs: Json = await (await get()).json();
      expect(titles(theirs.tasks)).toContain("SECRET planned");
      expect(JSON.stringify(theirs)).not.toContain("mine");
      expect(theirs.plan.userId).toBe("stranger");
    });
  });

  describe("scale", () => {
    it("a day with 200 planned tasks (and 200 completed) works and is fast enough", async () => {
      const { group, statuses } = await seedGroup("owner-1");
      const rows = Array.from({ length: 200 }, (_, i) => ({
        id: `bulk-${String(i).padStart(3, "0")}`,
        title: `bulk ${i}`,
        groupId: group.id,
        statusId: i % 2 ? statuses["Done"].id : statuses["To Do"].id,
        createdBy: "owner-1",
        order: i,
        abcde: (["A", "B", "C", "D", "E"] as const)[i % 5],
        abcdeRank: (i % 7) + 1,
        plannedFor: DATE,
        completedAt: i % 2 ? day(DATE, 16, i % 60) : null,
      }));
      await db.task.createMany({ data: rows });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: DATE, frogTaskId: "bulk-000" } });
      const t0 = Date.now();
      const res = await get();
      const elapsed = Date.now() - t0;
      expect(res.status).toBe(200);
      const b: Json = await res.json();
      expect(b.tasks).toHaveLength(200);
      expect(b.completedToday).toHaveLength(100);
      expect(b.openA).toBe(20); // A tasks are i%5==0; open ones are even i → i%10==0 → 20
      expect(ids(b.tasks)).toHaveLength(200);
      expect(elapsed).toBeLessThan(3000);
    });
  });
});
