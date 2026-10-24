// H5: the habit routes.
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { signInAs, setFakeUser } from "./helpers";
import { GET as list, POST as create } from "@/app/api/habits/route";
import { PATCH as patchHabit, DELETE as removeHabit } from "@/app/api/habits/[id]/route";
import { PUT as tick, DELETE as untick } from "@/app/api/habits/[id]/checks/[date]/route";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// 2026-10-24 is a Saturday.
const TODAY = "2026-10-24";
const TZ = "UTC";
const getAll = (q: Record<string, string> = { today: TODAY, tz: TZ }) => list(new Request(`http://localhost/api/habits?${new URLSearchParams(q)}`));
const make = (body: unknown) => create(new Request("http://localhost/api/habits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const edit = (id: string, body: unknown) =>
  patchHabit(new Request(`http://localhost/api/habits/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const del = (id: string) => removeHabit(new Request(`http://localhost/api/habits/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
const check = (fn: typeof tick, id: string, date: string, today = TODAY) =>
  fn(new Request(`http://localhost/api/habits/${id}/checks/${date}?today=${today}`, { method: "PUT" }), { params: Promise.resolve({ id, date }) });

const seed = (userId: string, name = "Read", extra: Json = {}) => db.habit.create({ data: { userId, name, ...extra } });

beforeEach(() => signInAs("owner-1"));

describe("POST /api/habits", () => {
  it("401 with no user", async () => {
    setFakeUser(null);
    expect((await make({ name: "Read" })).status).toBe(401);
  });

  it("creates a habit scheduled every day by default, trimmed", async () => {
    const res = await make({ name: "  Read  " });
    expect(res.status).toBe(201);
    const row = await db.habit.findFirst();
    expect(row).toMatchObject({ userId: "owner-1", name: "Read", weekdays: [0, 1, 2, 3, 4, 5, 6], archivedAt: null });
  });

  it("stores chosen weekdays sorted and de-duplicated", async () => {
    await make({ name: "Gym", weekdays: [5, 1, 5, 3] });
    expect((await db.habit.findFirst()).weekdays).toEqual([1, 3, 5]);
  });

  it("appends to the end of the order", async () => {
    await make({ name: "A" });
    await make({ name: "B" });
    const rows = await db.habit.findMany({ orderBy: { order: "asc" } });
    expect(rows.map((r: Json) => r.name)).toEqual(["A", "B"]);
  });

  it.each([
    ["no name", {}],
    ["blank name", { name: "  " }],
    ["name over 100", { name: "a".repeat(101) }],
    ["name with NUL", { name: "a\u0000" }],
    ["name not text", { name: 7 }],
    ["no weekdays", { name: "x", weekdays: [] }],
    ["weekday 7", { name: "x", weekdays: [7] }],
    ["weekdays not a list", { name: "x", weekdays: "mon" }],
  ])("400: %s", async (_n, body) => {
    expect((await make(body)).status).toBe(400);
    expect(await db.habit.count()).toBe(0);
  });

  it("stops at 20 active habits, but archived ones do not count", async () => {
    for (let i = 0; i < 20; i++) await seed("owner-1", `H${i}`);
    expect((await make({ name: "one too many" })).status).toBe(400);
    await db.habit.updateMany({ where: { name: "H0" }, data: { archivedAt: new Date() } });
    expect((await make({ name: "now fits" })).status).toBe(201);
  });

  it("the cap is per user", async () => {
    for (let i = 0; i < 20; i++) await seed("stranger", `S${i}`);
    expect((await make({ name: "mine" })).status).toBe(201);
  });
});

describe("GET /api/habits", () => {
  it("401 with no user; 400 for a bad date or zone", async () => {
    expect((await getAll({ today: "nope", tz: TZ })).status).toBe(400);
    expect((await getAll({ today: TODAY, tz: "Nowhere/Land" })).status).toBe(400);
    expect((await getAll({ today: TODAY })).status).toBe(400);
    setFakeUser(null);
    expect((await getAll()).status).toBe(401);
  });

  it("returns only your own active habits, in order, and the archived ones separately", async () => {
    await seed("owner-1", "Second", { order: 2 });
    await seed("owner-1", "First", { order: 1 });
    await seed("owner-1", "Filed", { order: 3, archivedAt: new Date() });
    await seed("stranger", "Theirs");
    const body: Json = await (await getAll()).json();
    expect(body.habits.map((h: Json) => h.name)).toEqual(["First", "Second"]);
    expect(body.archived.map((h: Json) => h.name)).toEqual(["Filed"]);
  });

  it("works out scheduledToday, streaks and the five-week completion", async () => {
    const h = await seed("owner-1", "Walk", { weekdays: [1, 2, 3, 4, 5], createdAt: new Date("2026-09-01T00:00:00Z") });
    // Mon 19 .. Fri 23 ticked: a 5-day streak; today (Saturday) is not scheduled
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]) await db.habitCheck.create({ data: { habitId: h.id, date: d } });
    const body: Json = await (await getAll()).json();
    expect(body.habits[0]).toMatchObject({ scheduledToday: false, streak: { current: 5, longest: 5 } });
    expect(body.habits[0].checks).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    // grid starts Monday 2026-09-21; 5 weeks of weekdays up to Saturday the 24th = 25 scheduled, 5 done
    expect(body.habits[0].rate).toEqual({ scheduled: 25, done: 5 });
  });

  it("scheduledToday is true on a scheduled weekday", async () => {
    await seed("owner-1", "Sat run", { weekdays: [6] });
    expect(((await (await getAll()).json()) as Json).habits[0].scheduledToday).toBe(true);
  });

  it("only returns ticks from the grid window, but counts all history in the streak", async () => {
    const h = await seed("owner-1", "Old", { createdAt: new Date("2026-01-01T00:00:00Z") });
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 7, 26 + i)).toISOString().slice(0, 10); // 26 Aug .. 24 Oct
      await db.habitCheck.create({ data: { habitId: h.id, date: d } });
    }
    const body: Json = await (await getAll()).json();
    expect(body.habits[0].streak).toEqual({ current: 60, longest: 60 });
    expect(body.habits[0].checks.length).toBe(34); // the grid starts Mon 21 Sep; 21 Sep .. 24 Oct is 34 days
  });
});

describe("PATCH and DELETE /api/habits/[id]", () => {
  it("renames, reschedules and reorders", async () => {
    const h = await seed("owner-1");
    expect((await edit(h.id, { name: " Read more ", weekdays: [2, 1], order: 4.5 })).status).toBe(200);
    expect(await db.habit.findUnique({ where: { id: h.id } })).toMatchObject({ name: "Read more", weekdays: [1, 2], order: 4.5 });
  });

  it("archives and restores", async () => {
    const h = await seed("owner-1");
    await edit(h.id, { archived: true });
    expect((await db.habit.findUnique({ where: { id: h.id } })).archivedAt).not.toBeNull();
    await edit(h.id, { archived: false });
    expect((await db.habit.findUnique({ where: { id: h.id } })).archivedAt).toBeNull();
  });

  it("cannot restore into a full list", async () => {
    const filed = await seed("owner-1", "Filed", { archivedAt: new Date() });
    for (let i = 0; i < 20; i++) await seed("owner-1", `H${i}`);
    expect((await edit(filed.id, { archived: false })).status).toBe(400);
  });

  it.each([
    ["empty name", { name: "" }],
    ["long name", { name: "a".repeat(101) }],
    ["bad weekdays", { weekdays: [9] }],
    ["order not a number", { order: "first" }],
    ["archived not a boolean", { archived: "yes" }],
  ])("400: %s, and nothing changes", async (_n, body) => {
    const h = await seed("owner-1");
    expect((await edit(h.id, body)).status).toBe(400);
    expect(await db.habit.findUnique({ where: { id: h.id } })).toMatchObject({ name: "Read", archivedAt: null });
  });

  it("404 for another user's habit; it is not changed or deleted", async () => {
    const theirs = await seed("stranger", "Theirs");
    expect((await edit(theirs.id, { name: "Hacked" })).status).toBe(404);
    expect((await del(theirs.id)).status).toBe(404);
    expect(await db.habit.findUnique({ where: { id: theirs.id } })).toMatchObject({ name: "Theirs" });
  });

  it("deleting removes the habit and its ticks", async () => {
    const h = await seed("owner-1");
    await db.habitCheck.create({ data: { habitId: h.id, date: TODAY } });
    expect((await del(h.id)).status).toBe(204);
    expect(await db.habit.count()).toBe(0);
    expect(await db.habitCheck.count()).toBe(0);
  });

  it("401 with no user", async () => {
    const h = await seed("owner-1");
    setFakeUser(null);
    expect((await edit(h.id, { name: "x" })).status).toBe(401);
    expect((await del(h.id)).status).toBe(401);
  });
});

describe("PUT and DELETE /api/habits/[id]/checks/[date]", () => {
  it("ticks and unticks, and both are idempotent", async () => {
    const h = await seed("owner-1");
    expect((await check(tick, h.id, TODAY)).status).toBe(200);
    expect((await check(tick, h.id, TODAY)).status).toBe(200);
    expect(await db.habitCheck.count({ where: { habitId: h.id, date: TODAY } })).toBe(1);
    expect((await check(untick, h.id, TODAY)).status).toBe(200);
    expect((await check(untick, h.id, TODAY)).status).toBe(200);
    expect(await db.habitCheck.count()).toBe(0);
  });

  it("allows up to 35 days back and one day ahead, nothing beyond", async () => {
    const h = await seed("owner-1");
    expect((await check(tick, h.id, "2026-09-19")).status).toBe(200); // 35 days back
    expect((await check(tick, h.id, "2026-09-18")).status).toBe(400);
    expect((await check(tick, h.id, "2026-10-25")).status).toBe(200); // tomorrow, for time zones
    expect((await check(tick, h.id, "2026-10-26")).status).toBe(400);
  });

  it("400 for a bad date or a missing today", async () => {
    const h = await seed("owner-1");
    expect((await check(tick, h.id, "2026-02-30")).status).toBe(400);
    expect((await check(tick, h.id, "yesterday")).status).toBe(400);
    expect((await check(tick, h.id, TODAY, "bad")).status).toBe(400);
  });

  it("404 for another user's habit, and nothing is written", async () => {
    const theirs = await seed("stranger");
    expect((await check(tick, theirs.id, TODAY)).status).toBe(404);
    expect(await db.habitCheck.count()).toBe(0);
  });

  it("cannot untick someone else's tick", async () => {
    const theirs = await seed("stranger");
    await db.habitCheck.create({ data: { habitId: theirs.id, date: TODAY } });
    expect((await check(untick, theirs.id, TODAY)).status).toBe(404);
    expect(await db.habitCheck.count()).toBe(1);
  });

  it("401 with no user", async () => {
    const h = await seed("owner-1");
    setFakeUser(null);
    expect((await check(tick, h.id, TODAY)).status).toBe(401);
  });
});
