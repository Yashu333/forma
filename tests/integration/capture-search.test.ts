// H1: POST /api/capture, GET /api/search and the ownership checks added to POST /api/tasks.
import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { POST as capture } from "@/app/api/capture/route";
import { GET as search } from "@/app/api/search/route";
import { POST as createTask } from "@/app/api/tasks/route";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const post = (fn: (r: Request) => Promise<Response>, body: unknown, raw = false) =>
  fn(new Request("http://localhost/api/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }));
const doCapture = (body: unknown) => post(capture, body);
const doSearch = (q: string) => search(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`));

describe("POST /api/capture", () => {
  let g: Awaited<ReturnType<typeof seedGroup>>;
  beforeEach(async () => {
    g = await seedGroup("owner-1", { tasks: [{ title: "Existing", extra: { order: 5 } }, { title: "Other", extra: { order: 2 } }] });
    signInAs("owner-1");
  });

  it("401 with no user and writes nothing", async () => {
    setFakeUser(null);
    expect((await doCapture({ title: "x", groupId: g.group.id })).status).toBe(401);
    expect(await db.task.count()).toBe(2);
  });

  it("creates the task at the top of the first open column with an activity row", async () => {
    const res = await doCapture({ title: "  Call dentist  ", groupId: g.group.id });
    expect(res.status).toBe(201);
    const body: Json = await res.json();
    expect(body.group).toEqual({ id: g.group.id, name: "Test project", color: "#F97316" });
    const row = await db.task.findUnique({ where: { id: body.id } });
    expect(row).toMatchObject({ title: "Call dentist", statusId: g.statuses["To Do"].id, priority: "MEDIUM", createdBy: "owner-1", parentTaskId: null, dueDate: null, repeat: null });
    expect(row.order).toBe(1); // one less than the smallest order in the column (2)
    expect(await db.activity.count({ where: { taskId: body.id, action: "created" } })).toBe(1);
  });

  it("the first task in an empty column gets order 0", async () => {
    const empty = await seedGroup("owner-1", { groupName: "Empty" });
    const body: Json = await (await doCapture({ title: "x", groupId: empty.group.id })).json();
    expect((await db.task.findUnique({ where: { id: body.id } })).order).toBe(0);
  });

  it("stores priority, due date, plan and repeat", async () => {
    const res = await doCapture({
      title: "Gym", groupId: g.group.id, priority: "URGENT", dueDate: "2026-10-26T07:00:00.000Z",
      plannedFor: "2026-10-26", repeat: { freq: "week", interval: 1, weekdays: [5, 1] },
    });
    expect(res.status).toBe(201);
    const row = await db.task.findUnique({ where: { id: ((await res.json()) as Json).id } });
    expect(row.priority).toBe("URGENT");
    expect(row.dueDate.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(row.plannedFor).toBe("2026-10-26");
    expect(row.repeat).toEqual({ freq: "week", interval: 1, weekdays: [1, 5] });
  });

  it("skips Done columns when choosing where the task goes", async () => {
    const odd = await seedGroup("owner-1", { groupName: "Odd", statuses: [{ name: "Shipped", celebrate: true }, { name: "Backlog" }] });
    const body: Json = await (await doCapture({ title: "x", groupId: odd.group.id })).json();
    expect((await db.task.findUnique({ where: { id: body.id } })).statusId).toBe(odd.statuses["Backlog"].id);
  });

  it("400 when the project has only Done columns", async () => {
    const done = await seedGroup("owner-1", { groupName: "AllDone", statuses: [{ name: "Done", celebrate: true }] });
    expect((await doCapture({ title: "x", groupId: done.group.id })).status).toBe(400);
  });

  it("404 for another user's project and for one that does not exist; nothing written", async () => {
    const theirs = await seedGroup("stranger");
    expect((await doCapture({ title: "x", groupId: theirs.group.id })).status).toBe(404);
    expect((await doCapture({ title: "x", groupId: "nope" })).status).toBe(404);
    expect(await db.task.count()).toBe(2);
  });

  it.each([
    ["no title", { groupId: "G" }],
    ["blank title", { title: "   ", groupId: "G" }],
    ["title 501 long", { title: "a".repeat(501), groupId: "G" }],
    ["title with NUL", { title: "a\u0000b", groupId: "G" }],
    ["title not text", { title: 5, groupId: "G" }],
    ["no groupId", { title: "x" }],
    ["groupId with NUL", { title: "x", groupId: "a\u0000" }],
    ["bad priority", { title: "x", groupId: "G", priority: "SOON" }],
    ["bad dueDate", { title: "x", groupId: "G", dueDate: "tomorrow" }],
    ["dueDate a number", { title: "x", groupId: "G", dueDate: 5 }],
    ["bad plannedFor", { title: "x", groupId: "G", plannedFor: "2026-02-30" }],
    ["bad repeat", { title: "x", groupId: "G", dueDate: "2026-10-26T07:00:00Z", repeat: { freq: "hourly", interval: 1 } }],
    ["repeat without a due date", { title: "x", groupId: "G", repeat: { freq: "day", interval: 1 } }],
  ])("400: %s", async (_n, body) => {
    const b = JSON.parse(JSON.stringify(body).replace('"G"', JSON.stringify(g.group.id)));
    const res = await doCapture(b);
    expect(res.status).toBe(400);
    expect(Object.keys(await res.json())).toEqual(["error"]);
    expect(await db.task.count()).toBe(2);
  });

  it("400 for a body that is not JSON or not an object", async () => {
    expect((await post(capture, "{nope", true)).status).toBe(400);
    expect((await doCapture([1])).status).toBe(400);
    expect((await doCapture(null)).status).toBe(400);
  });

  it("a title of exactly 500 characters is fine", async () => {
    expect((await doCapture({ title: "a".repeat(500), groupId: g.group.id })).status).toBe(201);
  });
});

describe("GET /api/search", () => {
  beforeEach(async () => {
    signInAs("owner-1");
  });

  it("401 with no user", async () => {
    setFakeUser(null);
    expect((await doSearch("abc")).status).toBe(401);
  });

  it("returns nothing for fewer than 2 characters", async () => {
    await seedGroup("owner-1", { tasks: [{ title: "Apple" }] });
    expect(await (await doSearch("a")).json()).toEqual([]);
    expect(await (await doSearch("  ")).json()).toEqual([]);
  });

  it("matches title or description, ignoring case", async () => {
    await seedGroup("owner-1", { tasks: [{ title: "Buy MILK" }, { title: "Other", extra: { description: "remember the milk run" } }, { title: "Unrelated" }] });
    const out: Json = await (await doSearch("milk")).json();
    expect(out.map((t: Json) => t.title).sort()).toEqual(["Buy MILK", "Other"]);
  });

  it("only the caller's own tasks; never deleted or archived ones", async () => {
    await seedGroup("owner-1", { tasks: [{ title: "mine milk" }, { title: "trashed milk", deletedAt: new Date() }, { title: "filed milk", archivedAt: new Date() }] });
    await seedGroup("stranger", { tasks: [{ title: "their milk" }] });
    const out: Json = await (await doSearch("milk")).json();
    expect(out.map((t: Json) => t.title)).toEqual(["mine milk"]);
  });

  it("includes subtasks with their parent's title, and hides subtasks of a trashed parent", async () => {
    await seedGroup("owner-1", {
      tasks: [
        { title: "Parent" }, { title: "sub milk", parentTitle: "Parent" },
        { title: "Gone", deletedAt: new Date() }, { title: "orphan milk", parentTitle: "Gone" },
      ],
    });
    const out: Json = await (await doSearch("milk")).json();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "sub milk", parentTitle: "Parent" });
    expect(out[0].parentTaskId).toBeTruthy();
  });

  it("lists open tasks before done ones and flags done", async () => {
    await seedGroup("owner-1", { tasks: [{ title: "milk done", status: "Done" }, { title: "milk open" }] });
    const out: Json = await (await doSearch("milk")).json();
    expect(out.map((t: Json) => [t.title, t.done])).toEqual([["milk open", false], ["milk done", true]]);
  });

  it("returns the project for each result", async () => {
    const g = await seedGroup("owner-1", { groupName: "Home", tasks: [{ title: "milk" }] });
    const out: Json = await (await doSearch("milk")).json();
    expect(out[0].group).toEqual({ id: g.group.id, name: "Home", color: "#F97316" });
  });

  it("caps results at 20", async () => {
    await seedGroup("owner-1", { tasks: Array.from({ length: 30 }, (_, i) => ({ title: `milk ${i}` })) });
    expect(((await (await doSearch("milk")).json()) as Json).length).toBe(20);
  });

  it("treats % and _ as plain characters", async () => {
    await seedGroup("owner-1", { tasks: [{ title: "100% done" }, { title: "anything" }, { title: "a_b" }, { title: "axb" }] });
    expect(((await (await doSearch("0%")).json()) as Json).map((t: Json) => t.title)).toEqual(["100% done"]);
    expect(((await (await doSearch("a_")).json()) as Json).map((t: Json) => t.title)).toEqual(["a_b"]);
  });

  it("400 for a query over 200 characters or with a NUL", async () => {
    expect((await doSearch("a".repeat(201))).status).toBe(400);
    expect((await doSearch("ab\u0000")).status).toBe(400);
    expect((await doSearch("a".repeat(200))).status).toBe(200);
  });
});

describe("POST /api/tasks ownership", () => {
  let mine: Awaited<ReturnType<typeof seedGroup>>;
  let theirs: Awaited<ReturnType<typeof seedGroup>>;
  beforeEach(async () => {
    mine = await seedGroup("owner-1", { tasks: [{ title: "Parent" }] });
    theirs = await seedGroup("stranger", { tasks: [{ title: "TheirParent" }] });
    signInAs("owner-1");
  });
  const make = (body: Json) => post(createTask, body);

  it("creates a task in your own project", async () => {
    const res = await make({ title: "New", groupId: mine.group.id, statusId: mine.statuses["To Do"].id });
    expect(res.status).toBe(201);
  });
  it("404 in someone else's project, and nothing is written", async () => {
    const res = await make({ title: "New", groupId: theirs.group.id, statusId: theirs.statuses["To Do"].id });
    expect(res.status).toBe(404);
    expect(await db.task.count()).toBe(2);
  });
  it("400 for a column from another project", async () => {
    expect((await make({ title: "New", groupId: mine.group.id, statusId: theirs.statuses["To Do"].id })).status).toBe(400);
  });
  it("404 for a parent task from another project", async () => {
    const res = await make({ title: "Sub", groupId: mine.group.id, statusId: mine.statuses["To Do"].id, parentTaskId: theirs.tasks["TheirParent"].id });
    expect(res.status).toBe(404);
  });
  it("creates a subtask under your own task", async () => {
    const res = await make({ title: "Sub", groupId: mine.group.id, statusId: mine.statuses["To Do"].id, parentTaskId: mine.tasks["Parent"].id });
    expect(res.status).toBe(201);
  });
  it.each([
    ["bad priority", { priority: "SOON" }],
    ["bad dueDate", { dueDate: "nope" }],
    ["NUL in title", { title: "a\u0000" }],
    ["title not text", { title: 3 }],
  ])("400: %s", async (_n, extra) => {
    const res = await make({ title: "New", groupId: mine.group.id, statusId: mine.statuses["To Do"].id, ...extra });
    expect(res.status).toBe(400);
  });
});
