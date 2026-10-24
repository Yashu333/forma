// M2: PATCH /api/tasks/[id] with the ABCDE fields. Calls the real route
// handlers against the real local Postgres and asserts DB state afterwards
// (the response alone proves little: `db` is typed `any`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { GET, PATCH } from "@/app/api/tasks/[id]/route";

type Json = Record<string, unknown>;

/** Calls PATCH. A string body is sent verbatim (to test non-JSON); anything else is JSON.stringify'd. */
function patchRaw(id: string, rawBody: string) {
  return PATCH(
    new Request(`http://localhost/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    }),
    { params: Promise.resolve({ id }) },
  );
}
const patch = (id: string, body: unknown) => patchRaw(id, JSON.stringify(body));

const row = (id: string) => db.task.findUnique({ where: { id } });
const activities = (taskId: string, action?: string) =>
  db.activity.findMany({ where: { taskId, ...(action && { action }) }, orderBy: { createdAt: "asc" } });

describe("PATCH /api/tasks/[id] — ABCDE", () => {
  let taskId: string;
  let plainId: string; // no letter, rank or plan
  let statuses: Record<string, { id: string }>;

  beforeEach(async () => {
    const seeded = await seedGroup("owner-1", {
      statuses: [
        { name: "To Do" },
        { name: "In Progress" },
        { name: "Done", celebrate: true },
        { name: "Shipped", celebrate: true },
      ],
      tasks: [
        { title: "Labelled", extra: { abcde: "A", abcdeRank: 2, plannedFor: "2026-10-24" } },
        { title: "Plain" },
      ],
    });
    taskId = seeded.tasks["Labelled"].id;
    plainId = seeded.tasks["Plain"].id;
    statuses = seeded.statuses;
    signInAs("owner-1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ───────────────────────── auth + ownership ─────────────────────────

  describe("auth and ownership", () => {
    it("401 with no user, and nothing is written", async () => {
      const before = await row(taskId);
      setFakeUser(null);
      const res = await patch(taskId, { abcde: "B" });
      expect(res.status).toBe(401);
      expect(await row(taskId)).toEqual(before);
      expect(await activities(taskId)).toHaveLength(0);
    });

    it("401 comes before body parsing (non-JSON body, no user)", async () => {
      setFakeUser(null);
      expect((await patchRaw(taskId, "not json")).status).toBe(401);
    });

    it("404 for another user's task and the task is NOT modified (every kind of field)", async () => {
      const before = await row(taskId);
      signInAs("intruder");
      const res = await patch(taskId, {
        title: "hacked",
        description: "hacked",
        priority: "URGENT",
        order: 99,
        abcde: "E",
        abcdeRank: 7,
        plannedFor: "2030-01-01",
        statusId: statuses["Done"].id,
        dueDate: "2030-01-01T00:00:00.000Z",
      });
      expect(res.status).toBe(404);
      expect(await row(taskId)).toEqual(before);
      expect(await activities(taskId)).toHaveLength(0);
    });

    it("404 for another user's task when only the new fields are sent", async () => {
      const before = await row(plainId);
      signInAs("intruder");
      expect((await patch(plainId, { abcde: "A" })).status).toBe(404);
      expect((await patch(plainId, { plannedFor: "2026-10-24" })).status).toBe(404);
      expect((await patch(plainId, { abcdeRank: 1 })).status).toBe(404);
      expect(await row(plainId)).toEqual(before);
      expect(await activities(plainId)).toHaveLength(0);
    });

    it("404 for another user's task on the archive path; it is not archived", async () => {
      signInAs("intruder");
      expect((await patch(taskId, { archived: true })).status).toBe(404);
      expect((await row(taskId)).archivedAt).toBeNull();
      expect(await activities(taskId)).toHaveLength(0);
    });

    it("404 for another user's subtask (ownership resolves through the group)", async () => {
      const { tasks } = await seedGroup("owner-2", {
        tasks: [{ title: "P" }, { title: "Sub", parentTitle: "P" }],
      });
      signInAs("owner-1");
      expect((await patch(tasks["Sub"].id, { abcde: "A" })).status).toBe(404);
      expect((await row(tasks["Sub"].id)).abcde).toBeNull();
    });

    it("the owner can still patch their own task while another user has tasks too", async () => {
      await seedGroup("owner-2", { tasks: [{ title: "theirs", extra: { abcde: "C" } }] });
      expect((await patch(plainId, { abcde: "B" })).status).toBe(200);
      expect((await row(plainId)).abcde).toBe("B");
    });

    it("404 for a soft-deleted task, and it is not modified", async () => {
      const { tasks } = await seedGroup("owner-1", {
        tasks: [{ title: "Trashed", deletedAt: new Date("2026-10-01T00:00:00Z"), extra: { abcde: "B" } }],
      });
      const id = tasks["Trashed"].id;
      const before = await row(id);
      expect((await patch(id, { abcde: "A", title: "revived?" })).status).toBe(404);
      expect((await patch(id, { archived: false })).status).toBe(404);
      expect(await row(id)).toEqual(before);
      expect(await activities(id)).toHaveLength(0);
    });

    it("404 for an unknown id", async () => {
      expect((await patch("does-not-exist", { abcde: "A" })).status).toBe(404);
      expect((await patch("does-not-exist", { archived: true })).status).toBe(404);
    });

    it("404 (not 400) for an unowned task even with invalid input: nothing is leaked about it", async () => {
      signInAs("intruder");
      expect((await patch(taskId, { abcde: "Z" })).status).toBe(404);
    });
  });

  // ───────────────────────────── validation ─────────────────────────────

  describe("400 on invalid input leaves the row untouched", () => {
    const bad: [string, Json][] = [
      ["abcde 'F'", { abcde: "F" }],
      ["abcde lower-case 'a'", { abcde: "a" }],
      ["abcde ''", { abcde: "" }],
      ["abcde 'AB'", { abcde: "AB" }],
      ["abcde number", { abcde: 1 }],
      ["abcde boolean", { abcde: true }],
      ["abcde array", { abcde: ["A"] }],
      ["abcde object", { abcde: {} }],
      ["abcdeRank 0", { abcdeRank: 0 }],
      ["abcdeRank -1", { abcdeRank: -1 }],
      ["abcdeRank 1.5", { abcdeRank: 1.5 }],
      ["abcdeRank 'x'", { abcdeRank: "x" }],
      ["abcdeRank '1' (string)", { abcdeRank: "1" }],
      ["abcdeRank 2147483648", { abcdeRank: 2147483648 }],
      ["abcdeRank 1e10", { abcdeRank: 1e10 }],
      ["abcdeRank true", { abcdeRank: true }],
      ["abcdeRank with a letter and rank 0", { abcde: "B", abcdeRank: 0 }],
      ["plannedFor 2026-02-30", { plannedFor: "2026-02-30" }],
      ["plannedFor 2026-1-5", { plannedFor: "2026-1-5" }],
      ["plannedFor 2026-13-01", { plannedFor: "2026-13-01" }],
      ["plannedFor ''", { plannedFor: "" }],
      ["plannedFor with time", { plannedFor: "2026-10-24T00:00:00Z" }],
      ["plannedFor number", { plannedFor: 20261024 }],
      ["plannedFor non-leap Feb 29", { plannedFor: "2027-02-29" }],
      ["valid title + invalid abcde", { title: "should not be saved", abcde: "Z" }],
      ["valid abcde + invalid plannedFor", { abcde: "B", plannedFor: "2026-02-30" }],
      ["valid plannedFor + invalid rank", { plannedFor: "2026-10-25", abcdeRank: 0 }],
    ];

    it.each(bad)("%s -> 400 { error }, no row or activity change", async (_name, body) => {
      const before = await row(taskId);
      const res = await patch(taskId, body);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(typeof json.error).toBe("string");
      expect(json.error.length).toBeGreaterThan(0);
      expect(await row(taskId)).toEqual(before); // incl. updatedAt: nothing was written
      expect(await activities(taskId)).toHaveLength(0);
    });

    it("rank non-null with no letter on the task and none sent -> 400, untouched", async () => {
      const before = await row(plainId);
      const res = await patch(plainId, { abcdeRank: 2 });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/abcde/i);
      expect(await row(plainId)).toEqual(before);
    });

    it("a rank-only request that is also bundled with other edits is rejected as a whole", async () => {
      const before = await row(plainId);
      expect((await patch(plainId, { title: "new title", abcdeRank: 3 })).status).toBe(400);
      expect(await row(plainId)).toEqual(before);
    });

    it("non-JSON body -> 400", async () => {
      const before = await row(taskId);
      for (const raw of ["not json", "{", "", "{'a':1}"]) {
        const res = await patchRaw(taskId, raw);
        expect(res.status).toBe(400);
        expect(typeof (await res.json()).error).toBe("string");
      }
      expect(await row(taskId)).toEqual(before);
    });

    it.each([["array", "[]"], ["array of objects", '[{"abcde":"A"}]'], ["string", '"A"'], ["number", "5"], ["null", "null"], ["boolean", "true"]])(
      "non-object JSON body (%s) -> 400",
      async (_n, raw) => {
        const before = await row(taskId);
        const res = await patchRaw(taskId, raw);
        expect(res.status).toBe(400);
        expect(await row(taskId)).toEqual(before);
      },
    );

    it("an empty object is a valid no-op (200) and changes no field", async () => {
      const before = await row(taskId);
      const res = await patch(taskId, {});
      expect(res.status).toBe(200);
      const after = await row(taskId);
      expect(after.abcde).toBe(before.abcde);
      expect(after.abcdeRank).toBe(before.abcdeRank);
      expect(after.plannedFor).toBe(before.plannedFor);
      expect(after.title).toBe(before.title);
      expect(await activities(taskId)).toHaveLength(0);
    });
  });

  describe("valid boundary values", () => {
    it("accepts the largest 32-bit rank and stores it", async () => {
      expect((await patch(taskId, { abcdeRank: 2147483647 })).status).toBe(200);
      expect((await row(taskId)).abcdeRank).toBe(2147483647);
    });

    it("accepts rank 1", async () => {
      expect((await patch(taskId, { abcdeRank: 1 })).status).toBe(200);
      expect((await row(taskId)).abcdeRank).toBe(1);
    });

    it("accepts a leap day and the year edges as plannedFor, stored verbatim", async () => {
      for (const d of ["2028-02-29", "2026-12-31", "2027-01-01", "2026-03-08"]) {
        expect((await patch(taskId, { plannedFor: d })).status).toBe(200);
        expect((await row(taskId)).plannedFor).toBe(d);
      }
    });

    it.each(["A", "B", "C", "D", "E"])("accepts letter %s", async (l) => {
      expect((await patch(plainId, { abcde: l })).status).toBe(200);
      expect((await row(plainId)).abcde).toBe(l);
    });
  });

  // ─────────────────────────── letter + rank rules ───────────────────────────

  describe("set / change / clear the letter and rank", () => {
    it("sets a letter on an unlabelled task: rank stays null, activity {from:null,to:'A'}", async () => {
      const res = await patch(plainId, { abcde: "A" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.abcde).toBe("A");
      expect(body.abcdeRank).toBeNull();
      const r = await row(plainId);
      expect(r.abcde).toBe("A");
      expect(r.abcdeRank).toBeNull();
      const acts = await activities(plainId, "abcde_changed");
      expect(acts).toHaveLength(1);
      expect(acts[0].metadata).toEqual({ from: null, to: "A" });
      expect(acts[0].userId).toBe("owner-1");
    });

    it("sets a letter and a rank together", async () => {
      expect((await patch(plainId, { abcde: "B", abcdeRank: 3 })).status).toBe(200);
      const r = await row(plainId);
      expect(r.abcde).toBe("B");
      expect(r.abcdeRank).toBe(3);
    });

    it("changing the letter WITHOUT a rank resets the rank; activity {from:'A',to:'C'}", async () => {
      expect((await patch(taskId, { abcde: "C" })).status).toBe(200);
      const r = await row(taskId);
      expect(r.abcde).toBe("C");
      expect(r.abcdeRank).toBeNull();
      const acts = await activities(taskId, "abcde_changed");
      expect(acts).toHaveLength(1);
      expect(acts[0].metadata).toEqual({ from: "A", to: "C" });
    });

    it("changing the letter WITH a rank keeps the new rank", async () => {
      expect((await patch(taskId, { abcde: "D", abcdeRank: 5 })).status).toBe(200);
      const r = await row(taskId);
      expect(r.abcde).toBe("D");
      expect(r.abcdeRank).toBe(5);
    });

    it("changing the letter with an explicit null rank leaves the rank null", async () => {
      expect((await patch(taskId, { abcde: "B", abcdeRank: null })).status).toBe(200);
      expect((await row(taskId)).abcdeRank).toBeNull();
    });

    it("clearing the letter clears the rank; activity {from:'A',to:null}", async () => {
      expect((await patch(taskId, { abcde: null })).status).toBe(200);
      const r = await row(taskId);
      expect(r.abcde).toBeNull();
      expect(r.abcdeRank).toBeNull();
      const acts = await activities(taskId, "abcde_changed");
      expect(acts).toHaveLength(1);
      expect(acts[0].metadata).toEqual({ from: "A", to: null });
    });

    it("clearing the letter clears the rank EVEN IF a rank is sent", async () => {
      const res = await patch(taskId, { abcde: null, abcdeRank: 4 });
      expect(res.status).toBe(200);
      const r = await row(taskId);
      expect(r.abcde).toBeNull();
      expect(r.abcdeRank).toBeNull();
      expect((await res.json()).abcdeRank).toBeNull();
    });

    it("clearing the letter on an already unlabelled task: no activity, still null", async () => {
      expect((await patch(plainId, { abcde: null })).status).toBe(200);
      expect((await row(plainId)).abcde).toBeNull();
      expect(await activities(plainId, "abcde_changed")).toHaveLength(0);
    });

    it("a rank alone (task already has a letter) updates only the rank; no activity", async () => {
      expect((await patch(taskId, { abcdeRank: 7 })).status).toBe(200);
      const r = await row(taskId);
      expect(r.abcde).toBe("A");
      expect(r.abcdeRank).toBe(7);
      expect(await activities(taskId, "abcde_changed")).toHaveLength(0);
    });

    it("a null rank alone clears the rank but keeps the letter; no activity", async () => {
      expect((await patch(taskId, { abcdeRank: null })).status).toBe(200);
      const r = await row(taskId);
      expect(r.abcde).toBe("A");
      expect(r.abcdeRank).toBeNull();
      expect(await activities(taskId, "abcde_changed")).toHaveLength(0);
    });

    it("a null rank on a task with no letter is allowed (a no-op)", async () => {
      expect((await patch(plainId, { abcdeRank: null })).status).toBe(200);
      expect((await row(plainId)).abcdeRank).toBeNull();
    });

    it("rank requires a letter: a rank sent together with a letter is fine", async () => {
      expect((await patch(plainId, { abcde: "A", abcdeRank: 1 })).status).toBe(200);
      expect((await row(plainId)).abcdeRank).toBe(1);
    });

    it("re-sending the same letter keeps the existing rank", async () => {
      expect((await patch(taskId, { abcde: "A" })).status).toBe(200);
      const r = await row(taskId);
      expect(r.abcde).toBe("A");
      expect(r.abcdeRank).toBe(2);
    });

    it("the response carries the new fields", async () => {
      const body = await (await patch(plainId, { abcde: "E", abcdeRank: 9, plannedFor: "2026-11-01" })).json();
      expect(body).toMatchObject({ id: plainId, abcde: "E", abcdeRank: 9, plannedFor: "2026-11-01" });
      expect(body._count).toBeDefined();
    });
  });

  // ─────────────────────────────── activity ───────────────────────────────

  describe("abcde_changed activity", () => {
    it("is NOT written when the same letter is re-sent", async () => {
      expect((await patch(taskId, { abcde: "A" })).status).toBe(200);
      expect((await patch(taskId, { abcde: "A", abcdeRank: 3 })).status).toBe(200);
      expect(await activities(taskId, "abcde_changed")).toHaveLength(0);
      expect((await row(taskId)).abcdeRank).toBe(3);
    });

    it("is written once per real change, in order, each with its own {from,to}", async () => {
      await patch(plainId, { abcde: "A" });
      await patch(plainId, { abcde: "A" }); // no-op
      await patch(plainId, { abcde: "C" });
      await patch(plainId, { abcde: null });
      await patch(plainId, { abcde: null }); // no-op
      const acts = await activities(plainId, "abcde_changed");
      expect(acts.map((a: { metadata: unknown }) => a.metadata)).toEqual([
        { from: null, to: "A" },
        { from: "A", to: "C" },
        { from: "C", to: null },
      ]);
    });

    it("is not written for rank-only or plannedFor-only changes", async () => {
      await patch(taskId, { abcdeRank: 9 });
      await patch(taskId, { plannedFor: "2026-12-01" });
      await patch(taskId, { title: "renamed" });
      expect(await activities(taskId)).toHaveLength(0);
    });

    it("is not written when the request is rejected", async () => {
      await patch(taskId, { abcde: "Z" });
      await patch(plainId, { abcdeRank: 2 });
      expect(await db.activity.count()).toBe(0);
    });

    it("sits alongside status_changed when both change in one request", async () => {
      expect((await patch(taskId, { abcde: "B", statusId: statuses["In Progress"].id })).status).toBe(200);
      const all = await activities(taskId);
      expect(all.map((a: { action: string }) => a.action).sort()).toEqual(["abcde_changed", "status_changed"]);
      const abcde = all.find((a: { action: string }) => a.action === "abcde_changed");
      expect(abcde.metadata).toEqual({ from: "A", to: "B" });
      const status = all.find((a: { action: string }) => a.action === "status_changed");
      expect(status.metadata).toEqual({ from: statuses["To Do"].id, to: statuses["In Progress"].id });
    });
  });

  // ─────────────────────────────── plannedFor ───────────────────────────────

  describe("plannedFor", () => {
    it("sets, changes and clears the date key (stored verbatim)", async () => {
      expect((await patch(plainId, { plannedFor: "2026-10-24" })).status).toBe(200);
      expect((await row(plainId)).plannedFor).toBe("2026-10-24");
      expect((await patch(plainId, { plannedFor: "2026-10-25" })).status).toBe(200);
      expect((await row(plainId)).plannedFor).toBe("2026-10-25");
      expect((await patch(plainId, { plannedFor: null })).status).toBe(200);
      expect((await row(plainId)).plannedFor).toBeNull();
    });

    it("does not touch the letter or rank", async () => {
      expect((await patch(taskId, { plannedFor: null })).status).toBe(200);
      const r = await row(taskId);
      expect(r.abcde).toBe("A");
      expect(r.abcdeRank).toBe(2);
      expect(r.plannedFor).toBeNull();
    });

    it("can be sent together with a letter change in one request", async () => {
      expect((await patch(plainId, { abcde: "A", plannedFor: "2026-10-26" })).status).toBe(200);
      const r = await row(plainId);
      expect(r.abcde).toBe("A");
      expect(r.plannedFor).toBe("2026-10-26");
    });
  });

  // ─────────────────────────────── archive path ───────────────────────────────

  describe("archive / restore path", () => {
    it("archived:true archives the task and its subtasks and writes an 'archived' activity", async () => {
      const { tasks } = await seedGroup("owner-1", {
        tasks: [{ title: "P" }, { title: "Sub", parentTitle: "P" }],
      });
      const res = await patch(tasks["P"].id, { archived: true });
      expect(res.status).toBe(200);
      expect((await row(tasks["P"].id)).archivedAt).not.toBeNull();
      expect((await row(tasks["Sub"].id)).archivedAt).not.toBeNull();
      expect((await activities(tasks["P"].id, "archived"))).toHaveLength(1);
    });

    it("archived:false restores an archived task (archived tasks pass the ownership check) and its subtasks", async () => {
      const { tasks } = await seedGroup("owner-1", {
        tasks: [
          { title: "P", archivedAt: new Date("2026-10-01T00:00:00Z") },
          { title: "Sub", parentTitle: "P", archivedAt: new Date("2026-10-01T00:00:00Z") },
        ],
      });
      const res = await patch(tasks["P"].id, { archived: false });
      expect(res.status).toBe(200);
      expect((await row(tasks["P"].id)).archivedAt).toBeNull();
      expect((await row(tasks["Sub"].id)).archivedAt).toBeNull();
      expect((await activities(tasks["P"].id, "restored"))).toHaveLength(1);
    });

    it("archiving preserves the task's letter, rank and plan", async () => {
      expect((await patch(taskId, { archived: true })).status).toBe(200);
      const r = await row(taskId);
      expect(r.archivedAt).not.toBeNull();
      expect([r.abcde, r.abcdeRank, r.plannedFor]).toEqual(["A", 2, "2026-10-24"]);
    });

    it.each([
      ["abcde", { abcde: "Z" }],
      ["abcdeRank", { abcdeRank: 0 }],
      ["plannedFor", { plannedFor: "2026-02-30" }],
    ])("archived:true with an invalid %s -> 400 and nothing is archived", async (_n, extra) => {
      const before = await row(taskId);
      const res = await patch(taskId, { archived: true, ...extra });
      expect(res.status).toBe(400);
      expect(await row(taskId)).toEqual(before);
      expect(await activities(taskId)).toHaveLength(0);
    });

    it("archived:true with a rank but no letter -> 400 and nothing is archived", async () => {
      const before = await row(plainId);
      expect((await patch(plainId, { archived: true, abcdeRank: 2 })).status).toBe(400);
      expect(await row(plainId)).toEqual(before);
    });

    it("returns the archived task (with _count) in the response", async () => {
      const body = await (await patch(taskId, { archived: true })).json();
      expect(body.id).toBe(taskId);
      expect(body.archivedAt).not.toBeNull();
      expect(body._count).toBeDefined();
    });
  });

  // ─────────────────────────── existing behaviour preserved ───────────────────────────

  describe("existing behaviour is preserved", () => {
    it("updates title, description, priority, dueDate and order", async () => {
      const res = await patch(plainId, {
        title: "New title",
        description: "Some words",
        priority: "URGENT",
        dueDate: "2026-11-05T09:30:00.000Z",
        order: 12.5,
      });
      expect(res.status).toBe(200);
      const r = await row(plainId);
      expect(r.title).toBe("New title");
      expect(r.description).toBe("Some words");
      expect(r.priority).toBe("URGENT");
      expect(r.dueDate.toISOString()).toBe("2026-11-05T09:30:00.000Z");
      expect(r.order).toBe(12.5);
      expect(await db.activity.count()).toBe(0);
    });

    it("clears description and dueDate with null", async () => {
      await patch(plainId, { description: "x", dueDate: "2026-11-05T09:30:00.000Z" });
      expect((await patch(plainId, { description: null, dueDate: null })).status).toBe(200);
      const r = await row(plainId);
      expect(r.description).toBeNull();
      expect(r.dueDate).toBeNull();
    });

    it("a title-only request does not touch abcde / abcdeRank / plannedFor", async () => {
      const res = await patch(taskId, { title: "Only the title" });
      expect(res.status).toBe(200);
      const r = await row(taskId);
      expect(r.title).toBe("Only the title");
      expect(r.abcde).toBe("A");
      expect(r.abcdeRank).toBe(2);
      expect(r.plannedFor).toBe("2026-10-24");
      expect(await activities(taskId)).toHaveLength(0);
    });

    it("the client-style payload (all edited-or-not base fields, no planning fields) keeps the planning fields", async () => {
      // What TaskDetail.save() sends when only the title was edited.
      const res = await patch(taskId, {
        title: "Edited",
        description: null,
        priority: "MEDIUM",
        statusId: statuses["To Do"].id,
        dueDate: null,
      });
      expect(res.status).toBe(200);
      const r = await row(taskId);
      expect([r.abcde, r.abcdeRank, r.plannedFor]).toEqual(["A", 2, "2026-10-24"]);
      expect(await activities(taskId)).toHaveLength(0); // same statusId => no status_changed
    });

    it("moving into a celebrate status stamps completedAt and writes status_changed {from,to}", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T23:30:00-04:00"));
      const res = await patch(plainId, { statusId: statuses["Done"].id });
      expect(res.status).toBe(200);
      const r = await row(plainId);
      expect(r.statusId).toBe(statuses["Done"].id);
      expect(r.completedAt.toISOString()).toBe("2026-10-25T03:30:00.000Z");
      const acts = await activities(plainId, "status_changed");
      expect(acts).toHaveLength(1);
      expect(acts[0].metadata).toEqual({ from: statuses["To Do"].id, to: statuses["Done"].id });
      expect(acts[0].userId).toBe("owner-1");
    });

    it("moving back out of a celebrate status clears completedAt", async () => {
      await patch(plainId, { statusId: statuses["Done"].id });
      expect((await row(plainId)).completedAt).not.toBeNull();
      expect((await patch(plainId, { statusId: statuses["In Progress"].id })).status).toBe(200);
      const r = await row(plainId);
      expect(r.completedAt).toBeNull();
      expect(r.statusId).toBe(statuses["In Progress"].id);
      expect(await activities(plainId, "status_changed")).toHaveLength(2);
    });

    it("celebrate -> another celebrate status keeps the original completedAt", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
      await patch(plainId, { statusId: statuses["Done"].id });
      vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
      await patch(plainId, { statusId: statuses["Shipped"].id });
      expect((await row(plainId)).completedAt.toISOString()).toBe("2026-10-24T10:00:00.000Z");
    });

    it("non-celebrate -> non-celebrate leaves completedAt null and still writes status_changed", async () => {
      expect((await patch(plainId, { statusId: statuses["In Progress"].id })).status).toBe(200);
      expect((await row(plainId)).completedAt).toBeNull();
      expect(await activities(plainId, "status_changed")).toHaveLength(1);
    });

    it("re-sending the current statusId writes no status_changed and does not re-stamp completedAt", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
      await patch(plainId, { statusId: statuses["Done"].id });
      vi.setSystemTime(new Date("2026-10-30T10:00:00Z"));
      await patch(plainId, { statusId: statuses["Done"].id, title: "again" });
      expect((await row(plainId)).completedAt.toISOString()).toBe("2026-10-24T10:00:00.000Z");
      expect(await activities(plainId, "status_changed")).toHaveLength(1);
    });

    it("completing a task and labelling it in the same request does both", async () => {
      expect((await patch(plainId, { statusId: statuses["Done"].id, abcde: "A", abcdeRank: 1 })).status).toBe(200);
      const r = await row(plainId);
      expect(r.completedAt).not.toBeNull();
      expect([r.abcde, r.abcdeRank]).toEqual(["A", 1]);
    });
  });

  // ─────────────────────────────── atomicity ───────────────────────────────

  describe("the task update and its activity rows are atomic", () => {
    // Makes the abcde_changed INSERT fail inside Postgres, without touching product
    // code. If the handler wrote the task first and the activity second outside a
    // transaction, the task row would be left changed.
    beforeEach(async () => {
      await db.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION frog_test_fail_abcde() RETURNS trigger AS $$
         BEGIN
           IF NEW.action = 'abcde_changed' THEN RAISE EXCEPTION 'frog test: forced activity failure'; END IF;
           RETURN NEW;
         END; $$ LANGUAGE plpgsql`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER frog_test_fail_abcde BEFORE INSERT ON "Activity" FOR EACH ROW EXECUTE FUNCTION frog_test_fail_abcde()`,
      );
    });
    afterEach(async () => {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS frog_test_fail_abcde ON "Activity"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS frog_test_fail_abcde()`);
    });

    it("a failing abcde_changed insert rolls back the task update", async () => {
      const before = await row(taskId);
      await expect(patch(taskId, { abcde: "C", title: "must not stick", plannedFor: "2027-01-01" })).rejects.toThrow();
      expect(await row(taskId)).toEqual(before);
      expect(await activities(taskId)).toHaveLength(0);
    });

    it("a failing abcde_changed insert also rolls back status change, completedAt and the status_changed row", async () => {
      const before = await row(plainId);
      await expect(patch(plainId, { abcde: "A", statusId: statuses["Done"].id })).rejects.toThrow();
      const after = await row(plainId);
      expect(after).toEqual(before);
      expect(after.completedAt).toBeNull();
      expect(await activities(plainId)).toHaveLength(0);
    });

    it("control: the trigger really rejects an abcde_changed row, and lets other actions through", async () => {
      await expect(
        db.activity.create({ data: { taskId, userId: "owner-1", action: "abcde_changed" } }),
      ).rejects.toThrow(/forced activity failure/);
      await expect(
        db.activity.create({ data: { taskId, userId: "owner-1", action: "status_changed" } }),
      ).resolves.toBeDefined();
      // and a request that writes no abcde activity is unaffected
      expect((await patch(taskId, { title: "fine", plannedFor: "2027-01-01" })).status).toBe(200);
      expect((await row(taskId)).title).toBe("fine");
    });
  });

  // ─────────────────────────────── GET ───────────────────────────────

  describe("GET /api/tasks/[id] returns the new fields", () => {
    const get = (id: string) =>
      GET(new Request(`http://localhost/api/tasks/${id}`), { params: Promise.resolve({ id }) });

    it("returns abcde, abcdeRank and plannedFor", async () => {
      const res = await get(taskId);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: taskId, abcde: "A", abcdeRank: 2, plannedFor: "2026-10-24" });
    });

    it("returns nulls for an unlabelled task", async () => {
      expect(await (await get(plainId)).json()).toMatchObject({ abcde: null, abcdeRank: null, plannedFor: null });
    });

    it("reflects a PATCH, and includes the abcde_changed activity", async () => {
      await patch(taskId, { abcde: "B", abcdeRank: 4, plannedFor: null });
      const body = await (await get(taskId)).json();
      expect(body).toMatchObject({ abcde: "B", abcdeRank: 4, plannedFor: null });
      expect(body.activity.map((a: { action: string }) => a.action)).toEqual(["abcde_changed"]);
      expect(body.activity[0].metadata).toEqual({ from: "A", to: "B" });
    });
  });
});
