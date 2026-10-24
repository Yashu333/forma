// H2: recurring tasks. Completing a repeating task (task panel or drag to Done)
// creates the next copy; the repeat field is validated; the reorder route now
// checks ownership.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { PATCH as patchTask } from "@/app/api/tasks/[id]/route";
import { PATCH as reorder } from "@/app/api/tasks/reorder/route";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const patch = (id: string, body: unknown) =>
  patchTask(new Request(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const drag = (body: unknown) =>
  reorder(new Request("http://localhost/api/tasks/reorder", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

// 2026-10-24 is a Saturday.
const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });

const DAILY = { freq: "day", interval: 1 };
const row = (id: string) => db.task.findUnique({ where: { id } });
// The copies of a series (the first task carries the series id too, so it is left out).
const series = (id: string) => db.task.findMany({ where: { seriesId: id, id: { not: id } }, orderBy: { createdAt: "asc" } });

afterEach(() => vi.useRealTimers());

describe("completing a repeating task", () => {
  let g: Awaited<ReturnType<typeof seedGroup>>;
  const taskOf = (extra: Record<string, unknown>, title = "Water plants") =>
    seedGroup("owner-1", { tasks: [{ title, extra: { priority: "HIGH", description: "front room", abcde: "B", abcdeRank: 2, ...extra } }] });

  beforeEach(() => {
    signInAs("owner-1");
  });

  it("creates the next copy on the next day, in the first open column, with the same details", async () => {
    at("2026-10-24T12:00:00Z");
    g = await taskOf({ dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY, plannedFor: "2026-10-24" });
    const old = g.tasks["Water plants"];
    const res = await patch(old.id, { statusId: g.statuses["Done"].id, tz: "UTC" });
    expect(res.status).toBe(200);
    const body: Json = await res.json();

    const next = await row(body.nextInstance.id);
    expect(next).toMatchObject({
      title: "Water plants", description: "front room", priority: "HIGH", groupId: g.group.id,
      statusId: g.statuses["To Do"].id, abcde: "B", abcdeRank: null, plannedFor: null,
      completedAt: null, parentTaskId: null, seriesId: old.id, repeat: DAILY, createdBy: "owner-1",
    });
    expect(next.dueDate.toISOString()).toBe("2026-10-25T09:00:00.000Z");

    const after = await row(old.id);
    expect(after.nextInstanceId).toBe(next.id);
    expect(after.seriesId).toBe(old.id);
    expect(after.completedAt).not.toBeNull();
    expect(body.nextInstanceId).toBe(next.id); // the response shows the finished task's link
    expect(await db.activity.count({ where: { taskId: old.id, action: "recurred" } })).toBe(1);
  });

  it("puts the copy at the top of the column", async () => {
    at("2026-10-24T12:00:00Z");
    g = await seedGroup("owner-1", {
      tasks: [{ title: "Other", extra: { order: 3 } }, { title: "Repeater", extra: { order: 9, dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY } }],
    });
    const body: Json = await (await patch(g.tasks["Repeater"].id, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
    expect((await row(body.nextInstance.id)).order).toBeLessThan(3);
  });

  it("finishing late gives the next future day, not a pile of overdue copies", async () => {
    at("2026-10-24T12:00:00Z");
    g = await taskOf({ dueDate: new Date("2026-10-19T09:00:00Z"), repeat: DAILY });
    const body: Json = await (await patch(g.tasks["Water plants"].id, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
    expect((await row(body.nextInstance.id)).dueDate.toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });

  it("finishing early still moves on one step", async () => {
    at("2026-10-24T12:00:00Z");
    g = await taskOf({ dueDate: new Date("2026-10-30T09:00:00Z"), repeat: DAILY });
    const body: Json = await (await patch(g.tasks["Water plants"].id, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
    expect((await row(body.nextInstance.id)).dueDate.toISOString()).toBe("2026-10-31T09:00:00.000Z");
  });

  it("keeps the local time of day in the user's zone", async () => {
    // 03:30Z on the 24th is 23:30 on the 23rd in New York; it is 11:00 on the 24th there now.
    at("2026-10-24T15:00:00Z");
    g = await taskOf({ dueDate: new Date("2026-10-24T03:30:00Z"), repeat: DAILY });
    const body: Json = await (await patch(g.tasks["Water plants"].id, { statusId: g.statuses["Done"].id, tz: "America/New_York" })).json();
    expect((await row(body.nextInstance.id)).dueDate.toISOString()).toBe("2026-10-26T03:30:00.000Z"); // 23:30 on the 25th, local
  });

  it("an invalid or missing tz falls back to UTC instead of failing", async () => {
    at("2026-10-24T12:00:00Z");
    g = await taskOf({ dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY });
    const res = await patch(g.tasks["Water plants"].id, { statusId: g.statuses["Done"].id, tz: "Mars/Base" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).nextInstance.dueDate).toBe("2026-10-25T09:00:00.000Z");
  });

  it("weekly on chosen weekdays lands on the next of them", async () => {
    at("2026-10-23T12:00:00Z"); // Friday
    g = await taskOf({ dueDate: new Date("2026-10-23T07:00:00Z"), repeat: { freq: "week", interval: 1, weekdays: [1, 3, 5] } });
    const body: Json = await (await patch(g.tasks["Water plants"].id, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
    expect((await row(body.nextInstance.id)).dueDate.toISOString()).toBe("2026-10-26T07:00:00.000Z");
  });

  it("monthly on the 31st clamps to the end of a short month", async () => {
    at("2026-01-31T12:00:00Z");
    g = await taskOf({ dueDate: new Date("2026-01-31T09:00:00Z"), repeat: { freq: "month", interval: 1, day: 31 } });
    const body: Json = await (await patch(g.tasks["Water plants"].id, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
    expect((await row(body.nextInstance.id)).dueDate.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });

  it("copies open subtasks, but not deleted or archived ones", async () => {
    at("2026-10-24T12:00:00Z");
    g = await seedGroup("owner-1", {
      tasks: [
        { title: "Parent", extra: { dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY } },
        { title: "Step 1", parentTitle: "Parent", extra: { description: "first" } },
        { title: "Step 2 (done)", parentTitle: "Parent", status: "Done" },
        { title: "Step 3 (trashed)", parentTitle: "Parent", deletedAt: new Date() },
        { title: "Step 4 (filed)", parentTitle: "Parent", archivedAt: new Date() },
      ],
    });
    const body: Json = await (await patch(g.tasks["Parent"].id, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
    const copies = await db.task.findMany({ where: { parentTaskId: body.nextInstance.id }, orderBy: { order: "asc" } });
    expect(copies.map((c: Json) => c.title)).toEqual(["Step 1", "Step 2 (done)"]);
    // fresh copies are open again
    expect(copies.every((c: Json) => c.statusId === g.statuses["To Do"].id && c.completedAt === null)).toBe(true);
    expect(copies[0].description).toBe("first");
    // the originals are untouched
    expect(await db.task.count({ where: { parentTaskId: g.tasks["Parent"].id } })).toBe(4);
  });

  it("completing it again after reopening does not create a second copy", async () => {
    at("2026-10-24T12:00:00Z");
    g = await taskOf({ dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY });
    const id = g.tasks["Water plants"].id;
    await patch(id, { statusId: g.statuses["Done"].id, tz: "UTC" });
    await patch(id, { statusId: g.statuses["To Do"].id, tz: "UTC" });
    const again: Json = await (await patch(id, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
    expect(again.nextInstance).toBeUndefined();
    expect(await series(id)).toHaveLength(1);
    expect(await db.activity.count({ where: { taskId: id, action: "recurred" } })).toBe(1);
  });

  it("the copy repeats in turn, in the same series", async () => {
    at("2026-10-24T12:00:00Z");
    g = await taskOf({ dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY });
    const first = g.tasks["Water plants"].id;
    const one: Json = await (await patch(first, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
    const two: Json = await (await patch(one.nextInstance.id, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
    expect((await row(two.nextInstance.id)).seriesId).toBe(first);
    expect(await series(first)).toHaveLength(2);
  });

  it("does nothing for a task that does not repeat, a task with no due date, or a subtask", async () => {
    at("2026-10-24T12:00:00Z");
    g = await seedGroup("owner-1", {
      tasks: [
        { title: "Plain", extra: { dueDate: new Date("2026-10-24T09:00:00Z") } },
        { title: "NoDue", extra: { repeat: DAILY } },
        { title: "Parent" },
        { title: "SubRepeat", parentTitle: "Parent", extra: { dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY } },
      ],
    });
    for (const t of ["Plain", "NoDue", "SubRepeat"]) {
      const body: Json = await (await patch(g.tasks[t].id, { statusId: g.statuses["Done"].id, tz: "UTC" })).json();
      expect(body.nextInstance).toBeUndefined();
    }
    expect(await db.task.count()).toBe(4);
  });

  it("does not spawn when something other than the status changes", async () => {
    at("2026-10-24T12:00:00Z");
    g = await taskOf({ dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY });
    await patch(g.tasks["Water plants"].id, { title: "Renamed", statusId: g.statuses["To Do"].id, tz: "UTC" });
    expect(await db.task.count()).toBe(1);
  });

  it("markDone completes the task into the first Done column and spawns the copy", async () => {
    at("2026-10-24T12:00:00Z");
    g = await seedGroup("owner-1", {
      statuses: [{ name: "To Do" }, { name: "Shipped", celebrate: true }, { name: "Done", celebrate: true }],
      tasks: [{ title: "Water plants", extra: { dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY } }],
    });
    const body: Json = await (await patch(g.tasks["Water plants"].id, { markDone: true, tz: "UTC" })).json();
    expect(body.statusId).toBe(g.statuses["Shipped"].id);
    expect(body.completedAt).not.toBeNull();
    expect(body.nextInstance).toBeDefined();
  });

  it("markDone is a 400 in a project with no Done column, and changes nothing", async () => {
    g = await seedGroup("owner-1", { statuses: [{ name: "To Do" }], tasks: [{ title: "T" }] });
    const res = await patch(g.tasks["T"].id, { markDone: true });
    expect(res.status).toBe(400);
    expect((await row(g.tasks["T"].id)).statusId).toBe(g.statuses["To Do"].id);
  });
});

describe("PATCH /api/tasks/[id]: repeat and dueDate", () => {
  let g: Awaited<ReturnType<typeof seedGroup>>;
  beforeEach(async () => {
    g = await seedGroup("owner-1", {
      tasks: [
        { title: "Dated", extra: { dueDate: new Date("2026-10-24T09:00:00Z") } },
        { title: "Undated" },
        { title: "Repeating", extra: { dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY } },
        { title: "Sub", parentTitle: "Dated" },
      ],
    });
    signInAs("owner-1");
  });
  const id = (t: string) => g.tasks[t].id;

  it("sets a valid rule on a task with a due date", async () => {
    const res = await patch(id("Dated"), { repeat: { freq: "week", interval: 2, weekdays: [3, 1] } });
    expect(res.status).toBe(200);
    expect((await row(id("Dated"))).repeat).toEqual({ freq: "week", interval: 2, weekdays: [1, 3] });
  });

  it("sets a rule and the due date in one request", async () => {
    expect((await patch(id("Undated"), { repeat: DAILY, dueDate: "2026-10-26T09:00:00.000Z" })).status).toBe(200);
    expect((await row(id("Undated"))).repeat).toEqual(DAILY);
  });

  it("400 for a rule on a task with no due date", async () => {
    const res = await patch(id("Undated"), { repeat: DAILY });
    expect(res.status).toBe(400);
    expect((await row(id("Undated"))).repeat).toBeNull();
  });

  it("400 for a rule on a subtask", async () => {
    expect((await patch(id("Sub"), { repeat: DAILY, dueDate: "2026-10-26T09:00:00.000Z" })).status).toBe(400);
  });

  it.each([
    ["unknown freq", { freq: "hourly", interval: 1 }],
    ["zero interval", { freq: "day", interval: 0 }],
    ["a string", "daily"],
    ["no weekdays", { freq: "week", interval: 1, weekdays: [] }],
  ])("400 for an invalid rule: %s", async (_n, repeat) => {
    expect((await patch(id("Dated"), { repeat })).status).toBe(400);
    expect((await row(id("Dated"))).repeat).toBeNull();
  });

  it("repeat: null stops the repetition", async () => {
    expect((await patch(id("Repeating"), { repeat: null })).status).toBe(200);
    expect((await row(id("Repeating"))).repeat).toBeNull();
  });

  it("removing the due date also removes the repeat", async () => {
    expect((await patch(id("Repeating"), { dueDate: null })).status).toBe(200);
    const after = await row(id("Repeating"));
    expect(after.dueDate).toBeNull();
    expect(after.repeat).toBeNull();
  });

  it("changing the due date keeps the repeat", async () => {
    await patch(id("Repeating"), { dueDate: "2026-11-02T09:00:00.000Z" });
    expect((await row(id("Repeating"))).repeat).toEqual(DAILY);
  });

  it("400 for an invalid due date instead of a server error", async () => {
    expect((await patch(id("Dated"), { dueDate: "not a date" })).status).toBe(400);
    expect((await patch(id("Dated"), { dueDate: 12345 })).status).toBe(400);
  });

  it("repeat cannot be sent along with the archive toggle", async () => {
    expect((await patch(id("Dated"), { archived: true, repeat: DAILY })).status).toBe(400);
  });

  it("404 for another user's task", async () => {
    signInAs("stranger");
    expect((await patch(id("Dated"), { repeat: DAILY })).status).toBe(404);
  });
});

describe("PATCH /api/tasks/reorder", () => {
  let mine: Awaited<ReturnType<typeof seedGroup>>;
  let theirs: Awaited<ReturnType<typeof seedGroup>>;
  beforeEach(async () => {
    mine = await seedGroup("owner-1", {
      tasks: [{ title: "A" }, { title: "B" }, { title: "Rep", extra: { dueDate: new Date("2026-10-24T09:00:00Z"), repeat: DAILY } }],
    });
    theirs = await seedGroup("stranger", { tasks: [{ title: "Theirs" }] });
    signInAs("owner-1");
  });
  const todo = () => mine.statuses["To Do"].id;
  const done = () => mine.statuses["Done"].id;

  it("401 with no user", async () => {
    setFakeUser(null);
    expect((await drag({ updates: [{ id: mine.tasks["A"].id, order: 0, statusId: todo() }] })).status).toBe(401);
  });

  it("reorders within a column and writes no activity or completion", async () => {
    const res = await drag({ updates: [{ id: mine.tasks["B"].id, order: 0, statusId: todo() }, { id: mine.tasks["A"].id, order: 1, statusId: todo() }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, spawned: [] });
    expect((await row(mine.tasks["B"].id)).order).toBe(0);
    expect((await row(mine.tasks["A"].id)).order).toBe(1);
    expect(await db.activity.count()).toBe(0);
  });

  it("moving into Done stamps completedAt, logs the move, and out of Done clears it", async () => {
    await drag({ updates: [{ id: mine.tasks["A"].id, order: 0, statusId: done() }] });
    const a = await row(mine.tasks["A"].id);
    expect(a.statusId).toBe(done());
    expect(a.completedAt).not.toBeNull();
    expect(await db.activity.count({ where: { taskId: a.id, action: "status_changed" } })).toBe(1);
    await drag({ updates: [{ id: a.id, order: 0, statusId: todo() }] });
    expect((await row(a.id)).completedAt).toBeNull();
  });

  it("dragging a repeating task to Done returns the next copy", async () => {
    at("2026-10-24T12:00:00Z");
    const res = await drag({ updates: [{ id: mine.tasks["Rep"].id, order: 0, statusId: done() }], tz: "UTC" });
    const body: Json = await res.json();
    expect(body.spawned).toHaveLength(1);
    expect(body.spawned[0].dueDate).toBe("2026-10-25T09:00:00.000Z");
    expect(await series(mine.tasks["Rep"].id)).toHaveLength(1);
  });

  it("404 and nothing written when any task is someone else's", async () => {
    const res = await drag({ updates: [{ id: mine.tasks["A"].id, order: 7, statusId: done() }, { id: theirs.tasks["Theirs"].id, order: 0, statusId: done() }] });
    expect(res.status).toBe(404);
    expect((await row(mine.tasks["A"].id)).order).not.toBe(7);
    expect((await row(theirs.tasks["Theirs"].id)).statusId).toBe(theirs.statuses["To Do"].id);
  });

  it("404 for a trashed task", async () => {
    const trashed = await seedGroup("owner-1", { groupName: "T", tasks: [{ title: "Gone", deletedAt: new Date() }] });
    expect((await drag({ updates: [{ id: trashed.tasks["Gone"].id, order: 0, statusId: trashed.statuses["To Do"].id }] })).status).toBe(404);
  });

  it("400 and nothing written when a column belongs to another project", async () => {
    const res = await drag({ updates: [{ id: mine.tasks["A"].id, order: 7, statusId: theirs.statuses["Done"].id }] });
    expect(res.status).toBe(400);
    expect((await row(mine.tasks["A"].id)).order).not.toBe(7);
  });

  it.each([
    ["no updates", {}],
    ["empty list", { updates: [] }],
    ["not a list", { updates: "x" }],
    ["missing order", { updates: [{ id: "x", statusId: "y" }] }],
    ["order not finite", { updates: [{ id: "x", order: null, statusId: "y" }] }],
    ["id with NUL", { updates: [{ id: "a\u0000", order: 0, statusId: "y" }] }],
    ["too many", { updates: Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, order: i, statusId: "y" })) }],
  ])("400: %s", async (_n, body) => {
    expect((await drag(body)).status).toBe(400);
  });
});
