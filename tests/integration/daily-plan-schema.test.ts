// Proves the M1 migration + schema work end to end through the real Prisma
// client against the real local Postgres: new Task columns, the DailyPlan
// table, @@unique([userId, date]) and onDelete: SetNull on frogTaskId.
// `db` is typed `any`, so reading and writing every new field here is what
// catches a misspelt field name.
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedGroup } from "./helpers";

const DAY = "2026-10-23";

describe("Task.abcde / abcdeRank / plannedFor", () => {
  it("persists and reads back all three new fields", async () => {
    const { tasks } = await seedGroup("u1", {
      tasks: [{ title: "Write the report", extra: { abcde: "A", abcdeRank: 1, plannedFor: DAY } }],
    });
    const row = await db.task.findUnique({ where: { id: tasks["Write the report"].id } });
    expect(row.abcde).toBe("A");
    expect(row.abcdeRank).toBe(1);
    expect(row.plannedFor).toBe(DAY);
  });

  it("defaults all three to null for existing-style tasks", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "Plain" }] });
    const row = await db.task.findUnique({ where: { id: tasks["Plain"].id } });
    expect(row.abcde).toBeNull();
    expect(row.abcdeRank).toBeNull();
    expect(row.plannedFor).toBeNull();
  });

  it("accepts every letter A-E and filters on them", async () => {
    const letters = ["A", "B", "C", "D", "E"];
    await seedGroup("u1", {
      tasks: letters.map((l) => ({ title: `task ${l}`, extra: { abcde: l } })),
    });
    for (const l of letters) {
      const rows = await db.task.findMany({ where: { abcde: l } });
      expect(rows.map((r: { title: string }) => r.title)).toEqual([`task ${l}`]);
    }
  });

  it("rejects a letter outside the enum, at the Prisma layer and in Postgres itself", async () => {
    const { group, statuses } = await seedGroup("u1");
    await expect(
      db.task.create({
        data: { title: "bad", groupId: group.id, statusId: statuses["To Do"].id, createdBy: "u1", abcde: "F" },
      }),
    ).rejects.toThrow();
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "Task" (id, title, "groupId", "statusId", "createdBy", "updatedAt", abcde) VALUES ('raw1', 'x', '${group.id}', '${statuses["To Do"].id}', 'u1', now(), 'F')`,
      ),
    ).rejects.toThrow();
  });

  it("stores plannedFor as the literal local-date string (no time-zone conversion) and can clear it", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "t", extra: { plannedFor: "2026-03-08" } }] });
    const id = tasks["t"].id;
    expect((await db.task.findUnique({ where: { id } })).plannedFor).toBe("2026-03-08");
    await db.task.update({ where: { id }, data: { plannedFor: null, abcde: "B", abcdeRank: 3 } });
    const row = await db.task.findUnique({ where: { id } });
    expect(row.plannedFor).toBeNull();
    expect(row.abcde).toBe("B");
    expect(row.abcdeRank).toBe(3);
    await db.task.update({ where: { id }, data: { abcde: null, abcdeRank: null } });
    const cleared = await db.task.findUnique({ where: { id } });
    expect(cleared.abcde).toBeNull();
    expect(cleared.abcdeRank).toBeNull();
  });

  it("can query by plannedFor and order by abcdeRank", async () => {
    await seedGroup("u1", {
      tasks: [
        { title: "r2", extra: { abcde: "A", abcdeRank: 2, plannedFor: DAY } },
        { title: "r1", extra: { abcde: "A", abcdeRank: 1, plannedFor: DAY } },
        { title: "other day", extra: { abcde: "A", abcdeRank: 0, plannedFor: "2026-10-24" } },
        { title: "backlog" },
      ],
    });
    const rows = await db.task.findMany({ where: { plannedFor: DAY }, orderBy: { abcdeRank: "asc" } });
    expect(rows.map((r: { title: string }) => r.title)).toEqual(["r1", "r2"]);
  });
});

describe("DailyPlan", () => {
  it("creates a plan with a frog and round-trips every column, including the frogTask relation", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "Frog", extra: { abcde: "A", abcdeRank: 1, plannedFor: DAY } }] });
    const frog = tasks["Frog"];
    const plannedAt = new Date("2026-10-23T07:00:00Z");
    const reviewedAt = new Date("2026-10-23T21:00:00Z");
    const created = await db.dailyPlan.create({
      data: { userId: "u1", date: DAY, frogTaskId: frog.id, plannedAt, reviewedAt, wentWell: "focus", improve: "start earlier", rating: 4 },
    });
    expect(created.id).toEqual(expect.any(String));

    const row = await db.dailyPlan.findUnique({ where: { id: created.id }, include: { frogTask: true } });
    expect(row).toMatchObject({
      userId: "u1",
      date: DAY,
      frogTaskId: frog.id,
      wentWell: "focus",
      improve: "start earlier",
      rating: 4,
    });
    expect(row.plannedAt).toEqual(plannedAt);
    expect(row.reviewedAt).toEqual(reviewedAt);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.frogTask.id).toBe(frog.id);
    expect(row.frogTask.abcde).toBe("A");
    expect(row.frogTask.abcdeRank).toBe(1);
    expect(row.frogTask.plannedFor).toBe(DAY);

    // And the back-relation Task.frogPlans.
    const taskWithPlans = await db.task.findUnique({ where: { id: frog.id }, include: { frogPlans: true } });
    expect(taskWithPlans.frogPlans.map((p: { id: string }) => p.id)).toEqual([created.id]);
  });

  it("defaults the optional columns to null", async () => {
    const p = await db.dailyPlan.create({ data: { userId: "u1", date: DAY } });
    expect(p).toMatchObject({ frogTaskId: null, plannedAt: null, reviewedAt: null, wentWell: null, improve: null, rating: null });
  });

  it("rejects a frogTaskId that points at no task (foreign key)", async () => {
    await expect(db.dailyPlan.create({ data: { userId: "u1", date: DAY, frogTaskId: "no-such-task" } })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("rejects a second plan for the same (userId, date), with Prisma's unique-violation code", async () => {
    await db.dailyPlan.create({ data: { userId: "u1", date: DAY } });
    await expect(db.dailyPlan.create({ data: { userId: "u1", date: DAY, wentWell: "dup" } })).rejects.toMatchObject({ code: "P2002" });
    expect(await db.dailyPlan.count({ where: { userId: "u1", date: DAY } })).toBe(1);
    const only = await db.dailyPlan.findFirst({ where: { userId: "u1", date: DAY } });
    expect(only.wentWell).toBeNull(); // the rejected insert left no trace
  });

  it("allows the same date for a different user, and a different date for the same user", async () => {
    await db.dailyPlan.create({ data: { userId: "u1", date: DAY } });
    await db.dailyPlan.create({ data: { userId: "u2", date: DAY } });
    await db.dailyPlan.create({ data: { userId: "u1", date: "2026-10-24" } });
    expect(await db.dailyPlan.count()).toBe(3);
  });

  it("the unique constraint is enforced by Postgres, not just the client (raw duplicate insert fails)", async () => {
    await db.dailyPlan.create({ data: { userId: "u1", date: DAY } });
    await expect(
      db.$executeRawUnsafe(`INSERT INTO "DailyPlan" (id, "userId", date, "updatedAt") VALUES ('raw-dup', 'u1', '${DAY}', now())`),
    ).rejects.toThrow();
  });

  it("the migration created both the unique index and the lookup index on (userId, date)", async () => {
    const rows: { indexname: string; indexdef: string }[] = await db.$queryRawUnsafe(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'DailyPlan'`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName["DailyPlan_userId_date_key"]).toMatch(/CREATE UNIQUE INDEX .*\("userId", date\)/);
    expect(byName["DailyPlan_userId_date_idx"]).toMatch(/CREATE INDEX .*\("userId", date\)/);
  });

  it("supports the compound-key upsert M3/M5 will use: first call creates, second updates the same row", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "F1" }, { title: "F2" }] });
    const where = { userId_date: { userId: "u1", date: DAY } };
    const a = await db.dailyPlan.upsert({ where, create: { userId: "u1", date: DAY, frogTaskId: tasks["F1"].id }, update: { frogTaskId: tasks["F1"].id } });
    const b = await db.dailyPlan.upsert({ where, create: { userId: "u1", date: DAY, frogTaskId: tasks["F2"].id }, update: { frogTaskId: tasks["F2"].id, rating: 5 } });
    expect(b.id).toBe(a.id);
    expect(b.frogTaskId).toBe(tasks["F2"].id);
    expect(await db.dailyPlan.count()).toBe(1);
    expect((await db.dailyPlan.findUnique({ where })).rating).toBe(5);
  });

  describe("updatedAt", () => {
    afterEach(() => vi.useRealTimers());

    it("is stamped on create and moves forward on update (@updatedAt), while createdAt stays", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-23T08:00:00Z"));
      const p = await db.dailyPlan.create({ data: { userId: "u1", date: DAY } });
      expect(p.createdAt).toEqual(new Date("2026-10-23T08:00:00Z"));
      expect(p.updatedAt).toEqual(new Date("2026-10-23T08:00:00Z"));
      vi.setSystemTime(new Date("2026-10-23T20:00:00Z"));
      const u = await db.dailyPlan.update({ where: { id: p.id }, data: { rating: 3 } });
      expect(u.updatedAt).toEqual(new Date("2026-10-23T20:00:00Z"));
      expect(u.createdAt).toEqual(new Date("2026-10-23T08:00:00Z"));
    });
  });
});

describe("DailyPlan.frogTaskId ON DELETE SET NULL", () => {
  it("hard-deleting the frog task nulls frogTaskId and keeps the plan and its reflection", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "Frog", extra: { abcde: "A", plannedFor: DAY } }] });
    const frog = tasks["Frog"];
    const plan = await db.dailyPlan.create({
      data: { userId: "u1", date: DAY, frogTaskId: frog.id, wentWell: "kept", rating: 5, reviewedAt: new Date("2026-10-23T21:00:00Z") },
    });
    expect((await db.dailyPlan.findUnique({ where: { id: plan.id } })).frogTaskId).toBe(frog.id);

    await db.task.delete({ where: { id: frog.id } });

    expect(await db.task.findUnique({ where: { id: frog.id } })).toBeNull();
    const after = await db.dailyPlan.findUnique({ where: { id: plan.id } });
    expect(after).not.toBeNull();
    expect(after.frogTaskId).toBeNull();
    expect(after.wentWell).toBe("kept");
    expect(after.rating).toBe(5);
    expect(after.date).toBe(DAY);
  });

  it("nulls every plan that pointed at the task, and leaves plans for other tasks alone", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "Doomed" }, { title: "Safe" }] });
    const p1 = await db.dailyPlan.create({ data: { userId: "u1", date: "2026-10-22", frogTaskId: tasks["Doomed"].id } });
    const p2 = await db.dailyPlan.create({ data: { userId: "u1", date: "2026-10-23", frogTaskId: tasks["Doomed"].id } });
    const p3 = await db.dailyPlan.create({ data: { userId: "u2", date: "2026-10-23", frogTaskId: tasks["Doomed"].id } });
    const p4 = await db.dailyPlan.create({ data: { userId: "u1", date: "2026-10-24", frogTaskId: tasks["Safe"].id } });

    await db.task.delete({ where: { id: tasks["Doomed"].id } });

    const get = async (id: string) => (await db.dailyPlan.findUnique({ where: { id } })).frogTaskId;
    expect(await get(p1.id)).toBeNull();
    expect(await get(p2.id)).toBeNull();
    expect(await get(p3.id)).toBeNull();
    expect(await get(p4.id)).toBe(tasks["Safe"].id);
    expect(await db.dailyPlan.count()).toBe(4);
  });

  it("deleting the frog's whole project (Group cascade -> Task) also nulls the plan instead of failing or deleting it", async () => {
    const { group, tasks } = await seedGroup("u1", { tasks: [{ title: "Frog" }] });
    const plan = await db.dailyPlan.create({ data: { userId: "u1", date: DAY, frogTaskId: tasks["Frog"].id } });
    await db.group.delete({ where: { id: group.id } });
    expect(await db.task.count()).toBe(0);
    expect((await db.dailyPlan.findUnique({ where: { id: plan.id } })).frogTaskId).toBeNull();
  });

  it("deleting a parent task cascades to its subtask, and a subtask that was the frog is nulled", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "Parent" }, { title: "Child", parentTitle: "Parent" }] });
    const plan = await db.dailyPlan.create({ data: { userId: "u1", date: DAY, frogTaskId: tasks["Child"].id } });
    await db.task.delete({ where: { id: tasks["Parent"].id } });
    expect((await db.dailyPlan.findUnique({ where: { id: plan.id } })).frogTaskId).toBeNull();
  });

  it("a soft delete (deletedAt) or archive does NOT touch the plan's frogTaskId", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "Soft" }, { title: "Arch" }] });
    const p1 = await db.dailyPlan.create({ data: { userId: "u1", date: "2026-10-22", frogTaskId: tasks["Soft"].id } });
    const p2 = await db.dailyPlan.create({ data: { userId: "u1", date: "2026-10-23", frogTaskId: tasks["Arch"].id } });
    await db.task.update({ where: { id: tasks["Soft"].id }, data: { deletedAt: new Date("2026-10-23T10:00:00Z") } });
    await db.task.update({ where: { id: tasks["Arch"].id }, data: { archivedAt: new Date("2026-10-23T10:00:00Z") } });
    expect((await db.dailyPlan.findUnique({ where: { id: p1.id } })).frogTaskId).toBe(tasks["Soft"].id);
    expect((await db.dailyPlan.findUnique({ where: { id: p2.id } })).frogTaskId).toBe(tasks["Arch"].id);
  });

  it("the foreign key in Postgres is defined as ON DELETE SET NULL", async () => {
    const rows: { confdeltype: string }[] = await db.$queryRawUnsafe(
      `SELECT confdeltype::text AS confdeltype FROM pg_constraint WHERE conname = 'DailyPlan_frogTaskId_fkey'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].confdeltype).toBe("n"); // n = SET NULL
  });

  it("after the frog is nulled the (userId, date) slot is still taken, but the plan can be re-pointed at a new frog", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "Old" }, { title: "New" }] });
    const plan = await db.dailyPlan.create({ data: { userId: "u1", date: DAY, frogTaskId: tasks["Old"].id } });
    await db.task.delete({ where: { id: tasks["Old"].id } });
    await expect(db.dailyPlan.create({ data: { userId: "u1", date: DAY } })).rejects.toMatchObject({ code: "P2002" });
    const updated = await db.dailyPlan.update({ where: { id: plan.id }, data: { frogTaskId: tasks["New"].id } });
    expect(updated.frogTaskId).toBe(tasks["New"].id);
  });
});
