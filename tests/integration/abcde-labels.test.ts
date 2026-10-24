// GET / POST / PATCH /api/abcde (the Label tasks screen).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, setFakeUser, signInAs } from "./helpers";
import { GET, PATCH, POST } from "@/app/api/abcde/route";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const get = () => (GET as (req: Request) => Promise<Response>)(new Request("http://localhost/api/abcde"));
const send = (method: "POST" | "PATCH", body: unknown) => {
  const req = new Request("http://localhost/api/abcde", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return method === "POST" ? POST(req) : PATCH(req);
};

describe("/api/abcde", () => {
  beforeEach(() => {
    signInAs("owner-1");
  });

  describe("auth", () => {
    it("401 on every method with no user", async () => {
      setFakeUser(null);
      expect((await get()).status).toBe(401);
      expect((await send("POST", { title: "x", groupId: "g" })).status).toBe(401);
      expect((await send("PATCH", { updates: [] })).status).toBe(401);
    });
  });

  describe("GET", () => {
    it("open top-level tasks of the user's own projects, plus the projects", async () => {
      const { group } = await seedGroup("owner-1", {
        tasks: [
          { title: "open", extra: { abcde: "A", abcdeRank: 1 } },
          { title: "done", status: "Done" },
          { title: "archived", archivedAt: new Date() },
          { title: "trashed", deletedAt: new Date() },
          { title: "sub", parentTitle: "open" },
        ],
      });
      await seedGroup("other", { groupName: "Theirs", tasks: [{ title: "foreign" }] });
      const res = await get();
      expect(res.status).toBe(200);
      const body: Json = await res.json();
      expect(body.tasks.map((t: Json) => t.title)).toEqual(["open"]);
      expect(body.tasks[0]).toMatchObject({ abcde: "A", abcdeRank: 1, group: { id: group.id, name: "Test project" } });
      expect(body.projects).toEqual([{ id: group.id, name: "Test project", color: group.color }]);
    });
  });

  describe("POST", () => {
    it("creates the task at the bottom of the first non-Done column, with a created activity", async () => {
      const { group, statuses } = await seedGroup("owner-1", {
        statuses: [{ name: "Done", celebrate: true }, { name: "Inbox" }, { name: "Doing" }],
        tasks: [{ title: "already here", status: "Inbox" }],
      });
      const res = await send("POST", { title: "  New one  ", groupId: group.id });
      expect(res.status).toBe(201);
      const body: Json = await res.json();
      expect(body).toMatchObject({ title: "New one", abcde: null, abcdeRank: null, group: { id: group.id } });
      const row = await db.task.findUnique({ where: { id: body.id } });
      expect(row).toMatchObject({ statusId: statuses["Inbox"].id, order: 1, createdBy: "owner-1", parentTaskId: null });
      const acts = await db.activity.findMany({ where: { taskId: body.id } });
      expect(acts.map((a: Json) => a.action)).toEqual(["created"]);
    });

    it("404 for another user's project, and nothing is written", async () => {
      const { group } = await seedGroup("other");
      const res = await send("POST", { title: "x", groupId: group.id });
      expect(res.status).toBe(404);
      expect(await db.task.count()).toBe(0);
    });

    it("400 for a project with only Done columns or no columns", async () => {
      const onlyDone = await seedGroup("owner-1", { statuses: [{ name: "Done", celebrate: true }] });
      expect((await send("POST", { title: "x", groupId: onlyDone.group.id })).status).toBe(400);
      const empty = await db.group.create({ data: { name: "Empty", ownerId: "owner-1" } });
      expect((await send("POST", { title: "x", groupId: empty.id })).status).toBe(400);
      expect(await db.task.count()).toBe(0);
    });

    it("400 for bad input", async () => {
      const { group } = await seedGroup("owner-1");
      for (const body of [
        "not json",
        [],
        { groupId: group.id },
        { title: "   ", groupId: group.id },
        { title: 5, groupId: group.id },
        { title: "a\u0000b", groupId: group.id },
        { title: "x".repeat(2001), groupId: group.id },
        { title: "x" },
        { title: "x", groupId: 7 },
      ]) {
        const res = await send("POST", body);
        expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      }
      expect((await send("POST", { title: "x", groupId: "g\u0000" })).status).toBe(404);
      expect(await db.task.count()).toBe(0);
    });
  });

  describe("PATCH", () => {
    it("saves several labels together, with an activity row only when the letter changes", async () => {
      const { tasks } = await seedGroup("owner-1", {
        tasks: [{ title: "a", extra: { abcde: "A", abcdeRank: 1 } }, { title: "b", extra: { abcde: "A", abcdeRank: 2 } }, { title: "c" }],
      });
      const res = await send("PATCH", {
        updates: [
          { id: tasks.a.id, abcde: "A", abcdeRank: 2 },
          { id: tasks.b.id, abcde: "A", abcdeRank: 1 },
          { id: tasks.c.id, abcde: "B", abcdeRank: 1 },
        ],
      });
      expect(res.status).toBe(200);
      const body: Json = await res.json();
      expect(body.tasks).toHaveLength(3);
      const rows = await db.task.findMany({ orderBy: { title: "asc" }, select: { title: true, abcde: true, abcdeRank: true } });
      expect(rows).toEqual([
        { title: "a", abcde: "A", abcdeRank: 2 },
        { title: "b", abcde: "A", abcdeRank: 1 },
        { title: "c", abcde: "B", abcdeRank: 1 },
      ]);
      const acts = await db.activity.findMany({ where: { action: "abcde_changed" } });
      expect(acts).toHaveLength(1);
      expect(acts[0]).toMatchObject({ taskId: tasks.c.id, metadata: { from: null, to: "B" } });
    });

    it("clearing a label clears its rank", async () => {
      const { tasks } = await seedGroup("owner-1", { tasks: [{ title: "a", extra: { abcde: "C", abcdeRank: 3 } }] });
      expect((await send("PATCH", { updates: [{ id: tasks.a.id, abcde: null, abcdeRank: null }] })).status).toBe(200);
      expect(await db.task.findUnique({ where: { id: tasks.a.id }, select: { abcde: true, abcdeRank: true } })).toEqual({ abcde: null, abcdeRank: null });
    });

    it("404 and no writes when any id is foreign, archived, deleted or a subtask", async () => {
      const mine = await seedGroup("owner-1", {
        tasks: [{ title: "ok" }, { title: "arch", archivedAt: new Date() }, { title: "del", deletedAt: new Date() }, { title: "sub", parentTitle: "ok" }],
      });
      const theirs = await seedGroup("other", { tasks: [{ title: "foreign" }] });
      for (const bad of [theirs.tasks.foreign.id, mine.tasks.arch.id, mine.tasks.del.id, mine.tasks.sub.id, "missing", "x\u0000"]) {
        const res = await send("PATCH", { updates: [{ id: mine.tasks.ok.id, abcde: "A", abcdeRank: 1 }, { id: bad, abcde: "B", abcdeRank: 1 }] });
        expect(res.status).toBe(404);
      }
      expect(await db.task.count({ where: { abcde: { not: null } } })).toBe(0);
      expect(await db.activity.count()).toBe(0);
    });

    it("400 for bad input", async () => {
      const { tasks } = await seedGroup("owner-1", { tasks: [{ title: "a" }] });
      const id = tasks.a.id;
      for (const body of [
        "not json",
        [],
        {},
        { updates: [] },
        { updates: "x" },
        { updates: [null] },
        { updates: [{ abcde: "A" }] },
        { updates: [{ id, abcde: "F" }] },
        { updates: [{ id, abcde: "A", abcdeRank: 0 }] },
        { updates: [{ id, abcde: "A", abcdeRank: 1.5 }] },
        { updates: [{ id, abcde: null, abcdeRank: 1 }] },
        { updates: [{ id, abcde: "A" }, { id, abcde: "B" }] },
        { updates: Array.from({ length: 501 }, (_, i) => ({ id: `t${i}`, abcde: "A", abcdeRank: 1 })) },
      ]) {
        const res = await send("PATCH", body);
        expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      }
      expect(await db.task.findUnique({ where: { id }, select: { abcde: true } })).toEqual({ abcde: null });
    });
  });
});
