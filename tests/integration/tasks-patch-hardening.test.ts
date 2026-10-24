// PATCH /api/tasks/[id] hardening: a statusId must belong to the task's own
// group, `archived` must be sent alone, and bad title/priority are 400s (not
// Prisma 500s). Every rejection must leave the row and its activity untouched.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs } from "./helpers";
import { PATCH } from "@/app/api/tasks/[id]/route";

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}
const row = (id: string) => db.task.findUnique({ where: { id } });
const activities = (taskId: string) => db.activity.findMany({ where: { taskId } });

describe("PATCH /api/tasks/[id] — hardening", () => {
  let taskId: string;
  let statuses: Record<string, { id: string }>;
  let otherGroupStatusId: string; // same user, different group
  let otherUserDoneId: string; // another user's group

  beforeEach(async () => {
    const mine = await seedGroup("u1", { tasks: [{ title: "Mine" }] });
    taskId = mine.tasks["Mine"].id;
    statuses = mine.statuses;
    otherGroupStatusId = (await seedGroup("u1", { groupName: "Second" })).statuses["Done"].id;
    otherUserDoneId = (await seedGroup("u2")).statuses["Done"].id;
    signInAs("u1");
  });

  async function expectRejected(body: unknown) {
    const before = await row(taskId);
    const res = await patch(taskId, body);
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(await row(taskId)).toEqual(before);
    expect(await activities(taskId)).toHaveLength(0);
  }

  describe("statusId", () => {
    it("400 for a status in another of the caller's groups; row unchanged", async () => {
      await expectRejected({ statusId: otherGroupStatusId });
    });

    it("400 for another user's status (a celebrate one must not stamp completedAt)", async () => {
      await expectRejected({ statusId: otherUserDoneId });
    });

    it("400 for an unknown statusId (not a Prisma 500)", async () => {
      await expectRejected({ statusId: "does-not-exist" });
    });

    it("400 for a non-string or empty statusId", async () => {
      await expectRejected({ statusId: null });
      await expectRejected({ statusId: 5 });
      await expectRejected({ statusId: "" });
    });

    it("a bad statusId blocks the whole request: other valid fields are not written", async () => {
      await expectRejected({ title: "renamed", priority: "URGENT", statusId: otherUserDoneId });
    });

    it("a valid status in the same group still works: stamps completedAt and logs status_changed", async () => {
      const res = await patch(taskId, { statusId: statuses["Done"].id });
      expect(res.status).toBe(200);
      const after = await row(taskId);
      expect(after.statusId).toBe(statuses["Done"].id);
      expect(after.completedAt).toBeInstanceOf(Date);
      expect(await db.activity.count({ where: { taskId, action: "status_changed" } })).toBe(1);
    });

    it("moving back out of a done status clears completedAt", async () => {
      await patch(taskId, { statusId: statuses["Done"].id });
      expect((await patch(taskId, { statusId: statuses["To Do"].id })).status).toBe(200);
      const after = await row(taskId);
      expect(after.statusId).toBe(statuses["To Do"].id);
      expect(after.completedAt).toBeNull();
    });

    it("re-sending the current status is a 200 with no status_changed activity", async () => {
      expect((await patch(taskId, { statusId: statuses["To Do"].id })).status).toBe(200);
      expect(await db.activity.count({ where: { taskId, action: "status_changed" } })).toBe(0);
    });
  });

  describe("archived", () => {
    it("400 when sent with abcde / plannedFor; nothing is written or archived", async () => {
      await expectRejected({ archived: true, abcde: "A", plannedFor: "2026-10-24" });
    });

    it("400 when sent with any other updatable field", async () => {
      await expectRejected({ archived: true, title: "x" });
      await expectRejected({ archived: false, statusId: statuses["Done"].id });
    });

    it("400 when archived is not a boolean", async () => {
      await expectRejected({ archived: "yes" });
      await expectRejected({ archived: null });
    });

    it("`{ archived }` alone still archives, with subtasks, and restores", async () => {
      const { tasks } = await seedGroup("u1", { tasks: [{ title: "P" }, { title: "S", parentTitle: "P" }] });
      signInAs("u1");
      expect((await patch(tasks["P"].id, { archived: true })).status).toBe(200);
      expect((await row(tasks["P"].id)).archivedAt).toBeInstanceOf(Date);
      expect((await row(tasks["S"].id)).archivedAt).toBeInstanceOf(Date);
      expect((await patch(tasks["P"].id, { archived: false })).status).toBe(200);
      expect((await row(tasks["P"].id)).archivedAt).toBeNull();
      expect((await row(tasks["S"].id)).archivedAt).toBeNull();
      expect(await db.activity.count({ where: { taskId: tasks["P"].id, action: "archived" } })).toBe(1);
      expect(await db.activity.count({ where: { taskId: tasks["P"].id, action: "restored" } })).toBe(1);
    });
  });

  describe("title and priority", () => {
    it("400 for a null or non-string title; row unchanged", async () => {
      await expectRejected({ title: null });
      await expectRejected({ title: 42 });
    });

    it("400 for an invalid priority; row unchanged", async () => {
      await expectRejected({ priority: "BOGUS" });
      await expectRejected({ priority: "urgent" });
      await expectRejected({ priority: null });
      await expectRejected({ title: "renamed", priority: "NOPE" });
    });

    it("valid title and priority still update", async () => {
      const res = await patch(taskId, { title: "Renamed", priority: "URGENT" });
      expect(res.status).toBe(200);
      const after = await row(taskId);
      expect(after.title).toBe("Renamed");
      expect(after.priority).toBe("URGENT");
    });
  });
});
