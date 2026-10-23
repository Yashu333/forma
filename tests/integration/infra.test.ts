// Tests for the test infrastructure itself (setup.ts / helpers.ts). Later
// milestones rely on these guarantees, so they are pinned down here.
// NOTE: the route is deliberately imported BEFORE ./helpers to prove the
// Supabase mock does not depend on import order.
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/tasks/[id]/route";
import { db } from "@/lib/db";
import { resetDb, seedGroup, setFakeUser, signInAs } from "./helpers";

const getTask = (id: string) =>
  GET(new Request(`http://localhost/api/tasks/${id}`), { params: Promise.resolve({ id }) });

describe("integration test infrastructure", () => {
  it("applies the supabase mock even when the route is imported first", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "T" }] });
    signInAs("u1");
    expect((await getTask(tasks["T"].id)).status).toBe(200);
  });

  describe("isolation between tests", () => {
    it("first test writes rows and signs in", async () => {
      await seedGroup("u1", { tasks: [{ title: "A" }, { title: "B" }] });
      await db.userSettings.create({ data: { userId: "u1" } });
      await db.comment.create({
        data: { taskId: (await db.task.findFirst()).id, authorId: "u1", body: "hi" },
      });
      signInAs("u1");
      expect(await db.task.count()).toBe(2);
    });

    it("next test sees every table empty and a signed-out user", async () => {
      expect(await db.group.count()).toBe(0);
      expect(await db.status.count()).toBe(0);
      expect(await db.task.count()).toBe(0);
      expect(await db.comment.count()).toBe(0);
      expect(await db.userSettings.count()).toBe(0);
      const { tasks } = await seedGroup("u1", { tasks: [{ title: "T" }] });
      expect((await getTask(tasks["T"].id)).status).toBe(401);
    });
  });

  it("lets a test switch the fake user mid-test", async () => {
    const { tasks } = await seedGroup("u1", { tasks: [{ title: "T" }] });
    setFakeUser(null);
    expect((await getTask(tasks["T"].id)).status).toBe(401);
    signInAs("u2");
    expect((await getTask(tasks["T"].id)).status).toBe(200);
    signInAs("u1");
    expect((await getTask(tasks["T"].id)).status).toBe(200);
  });

  it("truncates tables it was not hard-coded for, and keeps _prisma_migrations", async () => {
    await db.$executeRawUnsafe(
      `CREATE TABLE "InfraProbe" (id text PRIMARY KEY, "groupId" text REFERENCES "Group"(id))`
    );
    try {
      const { group } = await seedGroup("u1");
      await db.$executeRawUnsafe(`INSERT INTO "InfraProbe" VALUES ('p', '${group.id}')`);
      await resetDb();
      const [probe] = await db.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "InfraProbe"`);
      const [mig] = await db.$queryRawUnsafe(`SELECT count(*)::int AS c FROM _prisma_migrations`);
      expect(probe.c).toBe(0);
      expect(mig.c).toBeGreaterThan(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TABLE "InfraProbe"`);
    }
  });

  it("refuses to truncate a database that is not a local *_test one", async () => {
    const original = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgresql://u:p@db.example.com:5432/forma_test";
      await expect(resetDb()).rejects.toThrow(/refusing to truncate/);
      process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/postgres";
      await expect(resetDb()).rejects.toThrow(/refusing to truncate/);
    } finally {
      process.env.DATABASE_URL = original;
    }
  });
});
