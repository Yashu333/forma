// H6: the weekly review routes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { GET as getReview, POST as saveReview } from "@/app/api/review/route";
import { GET as getStatus } from "@/app/api/review/status/route";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Today is Saturday 2026-10-24. The week under review is Mon 19 .. Sun 25 Oct; next week starts Mon 26 Oct.
const TODAY = "2026-10-24";
const WEEK = "2026-10-19";
const NEXT = "2026-10-26";
const TZ = "UTC";

const fetchReview = (q: Record<string, string> = {}) =>
  getReview(new Request(`http://localhost/api/review?${new URLSearchParams({ weekStart: WEEK, today: TODAY, tz: TZ, ...q })}`));
const save = (body: Json) =>
  saveReview(new Request("http://localhost/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStart: WEEK, tz: TZ, today: TODAY, ...body }) }));
const status = (today: string) => getStatus(new Request(`http://localhost/api/review/status?today=${today}`));
const row = (id: string) => db.task.findUnique({ where: { id } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-24T12:00:00Z") });
  signInAs("owner-1");
});

describe("GET /api/review: validation", () => {
  it("401 with no user", async () => {
    setFakeUser(null);
    expect((await fetchReview()).status).toBe(401);
  });
  it.each([
    ["a Tuesday", { weekStart: "2026-10-20" }],
    ["a bad date", { weekStart: "2026-02-30" }],
    ["a week in the future", { weekStart: "2026-11-02" }],
    ["a bad today", { today: "x" }],
    ["a bad tz", { tz: "Nowhere/Land" }],
  ])("400 for %s", async (_n, q) => {
    expect((await fetchReview(q)).status).toBe(400);
  });
  it("accepts the current week and an old one", async () => {
    expect((await fetchReview({ weekStart: "2026-10-19" })).status).toBe(200);
    expect((await fetchReview({ weekStart: "2025-01-06" })).status).toBe(200);
  });
});

describe("GET /api/review: the week", () => {
  it("counts tasks completed in the week, in the user's zone, and not other users'", async () => {
    await seedGroup("owner-1", {
      tasks: [
        { title: "Mon", status: "Done", completedAt: new Date("2026-10-19T09:00:00Z") },
        { title: "Sun late", status: "Done", completedAt: new Date("2026-10-25T23:59:00Z") },
        { title: "Before", status: "Done", completedAt: new Date("2026-10-18T23:59:00Z") },
        { title: "After", status: "Done", completedAt: new Date("2026-10-26T00:00:00Z") },
        { title: "Filed", status: "Done", completedAt: new Date("2026-10-20T09:00:00Z"), archivedAt: new Date() },
        { title: "Trashed", status: "Done", completedAt: new Date("2026-10-20T09:00:00Z"), deletedAt: new Date() },
      ],
    });
    await seedGroup("stranger", { tasks: [{ title: "Theirs", status: "Done", completedAt: new Date("2026-10-20T09:00:00Z") }] });
    const body: Json = await (await fetchReview()).json();
    expect(body.done.map((t: Json) => t.title)).toEqual(["Mon", "Filed", "Sun late"]); // oldest first; archived counts, trashed does not
    expect(body.stats.tasksDone).toBe(3);
  });

  it("works out frogs, the daily notes and the average rating", async () => {
    const g = await seedGroup("owner-1", {
      tasks: [
        { title: "Eaten", status: "Done", completedAt: new Date("2026-10-19T08:00:00Z") },
        { title: "Missed" },
      ],
    });
    await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-19", frogTaskId: g.tasks["Eaten"].id, rating: 5, wentWell: "Shipped it", improve: "Start earlier" } });
    await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-20", frogTaskId: g.tasks["Missed"].id, rating: 2 } });
    await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-21", rating: 3 } });
    await db.dailyPlan.create({ data: { userId: "stranger", date: "2026-10-22", rating: 1, wentWell: "SECRET" } });
    const body: Json = await (await fetchReview()).json();
    expect(body.stats.frogs.planned).toBe(2);
    expect(body.stats.frogs.eaten).toBe(1);
    expect(body.stats.frogs.days).toHaveLength(7);
    expect(body.stats.frogs.days[0]).toMatchObject({ date: "2026-10-19", planned: true, eaten: true, title: "Eaten" });
    expect(body.stats.frogs.days[1]).toMatchObject({ planned: true, eaten: false });
    expect(body.stats.frogs.days[2]).toMatchObject({ planned: false, eaten: false });
    expect(body.stats.avgRating).toBeCloseTo(10 / 3, 5);
    expect(body.stats.ratedDays).toBe(3);
    expect(body.dailyNotes).toEqual([{ date: "2026-10-19", wentWell: "Shipped it", improve: "Start earlier", rating: 5 }]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("totals focus time for the week only", async () => {
    const sess = (iso: string, sec: number, userId = "owner-1") => db.focusSession.create({ data: { userId, startedAt: new Date(iso), endedAt: new Date(iso), durationSec: sec, completed: true } });
    await sess("2026-10-19T09:00:00Z", 1500);
    await sess("2026-10-23T09:00:00Z", 900);
    await sess("2026-10-18T09:00:00Z", 5000);
    await sess("2026-10-20T09:00:00Z", 7777, "stranger");
    const body: Json = await (await fetchReview()).json();
    expect(body.stats).toMatchObject({ focusSec: 2400, focusSessions: 2 });
  });

  it("habit completion counts scheduled days up to today, from the habit's creation", async () => {
    const h = await db.habit.create({ data: { userId: "owner-1", name: "Walk", createdAt: new Date("2026-10-01T00:00:00Z") } }); // every day
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21"]) await db.habitCheck.create({ data: { habitId: h.id, date: d } });
    const body: Json = await (await fetchReview()).json();
    expect(body.stats.habits).toEqual({ scheduled: 6, done: 3 }); // Mon 19 .. Sat 24 (today); Sunday has not happened
  });

  it("habits are null when none were scheduled", async () => {
    expect(((await (await fetchReview()).json()) as Json).stats.habits).toBeNull();
  });

  describe("slipped tasks", () => {
    it("lists open tasks due this week that are past, or planned on an earlier day, and nothing else", async () => {
      await seedGroup("owner-1", {
        tasks: [
          { title: "Due Tue", extra: { dueDate: new Date("2026-10-20T09:00:00Z") } },
          { title: "Planned Wed", extra: { plannedFor: "2026-10-21" } },
          { title: "Due later today", extra: { dueDate: new Date("2026-10-24T18:00:00Z") } },
          { title: "Due tomorrow", extra: { dueDate: new Date("2026-10-25T09:00:00Z") } },
          { title: "Planned today", extra: { plannedFor: TODAY } },
          { title: "Last week", extra: { dueDate: new Date("2026-10-12T09:00:00Z") } },
          { title: "Done", status: "Done", extra: { dueDate: new Date("2026-10-20T09:00:00Z") } },
          { title: "Trashed", deletedAt: new Date(), extra: { dueDate: new Date("2026-10-20T09:00:00Z") } },
          { title: "Filed", archivedAt: new Date(), extra: { dueDate: new Date("2026-10-20T09:00:00Z") } },
          { title: "Subtask", extra: { dueDate: new Date("2026-10-20T09:00:00Z") } },
          { title: "Nested", parentTitle: "Subtask", extra: { dueDate: new Date("2026-10-20T09:00:00Z") } },
        ],
      });
      await seedGroup("stranger", { tasks: [{ title: "Theirs", extra: { dueDate: new Date("2026-10-20T09:00:00Z") } }] });
      const body: Json = await (await fetchReview()).json();
      expect(body.slipped.map((t: Json) => t.title).sort()).toEqual(["Due Tue", "Planned Wed", "Subtask"]);
    });
  });

  it("returns the saved review, next week's frogs and the open tasks to pick from", async () => {
    const g = await seedGroup("owner-1", { tasks: [{ title: "Pick me" }, { title: "Finished", status: "Done" }] });
    await db.weeklyReview.create({ data: { userId: "owner-1", weekStart: WEEK, win: "W", obstacle: "O", focus: "F", rating: 4, reviewedAt: new Date() } });
    await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-27", frogTaskId: g.tasks["Pick me"].id, plannedAt: new Date() } });
    const body: Json = await (await fetchReview()).json();
    expect(body.review).toMatchObject({ win: "W", obstacle: "O", focus: "F", rating: 4 });
    expect(body.nextWeek.dates[0]).toBe(NEXT);
    expect(body.nextWeek.frogs["2026-10-27"]).toEqual({ id: g.tasks["Pick me"].id, title: "Pick me", planned: true });
    expect(body.nextWeek.frogs[NEXT]).toBeNull();
    expect(body.candidates.map((c: Json) => c.title)).toEqual(["Pick me"]);
  });

  it("has no saved review for a week that was not reviewed", async () => {
    expect(((await (await fetchReview()).json()) as Json).review).toBeNull();
  });
});

describe("POST /api/review", () => {
  let g: Awaited<ReturnType<typeof seedGroup>>;
  beforeEach(async () => {
    g = await seedGroup("owner-1", {
      tasks: [
        { title: "Keep me", extra: { dueDate: new Date("2026-10-20T09:30:00Z") } },
        { title: "Push me", extra: { dueDate: new Date("2026-10-21T14:15:00Z"), plannedFor: "2026-10-21" } },
        { title: "Push planned only", extra: { plannedFor: "2026-10-22" } },
        { title: "Bin me", extra: { dueDate: new Date("2026-10-22T09:00:00Z"), plannedFor: "2026-10-22" } },
        { title: "Sub of bin", parentTitle: "Bin me" },
        { title: "File me" },
        { title: "Frog A" },
        { title: "Frog B" },
      ],
    });
  });
  const id = (t: string) => g.tasks[t].id;

  it("401 with no user", async () => {
    setFakeUser(null);
    expect((await save({})).status).toBe(401);
    expect(await db.weeklyReview.count()).toBe(0);
  });

  it("saves the reflection and stamps reviewedAt", async () => {
    const res = await save({ win: "  Shipped  ", obstacle: "Meetings", focus: "Ship v2", rating: 4 });
    expect(res.status).toBe(200);
    const r = await db.weeklyReview.findFirst();
    expect(r).toMatchObject({ userId: "owner-1", weekStart: WEEK, win: "Shipped", obstacle: "Meetings", focus: "Ship v2", rating: 4 });
    expect(r.reviewedAt).not.toBeNull();
  });

  it("saving again updates the same row; omitted fields are kept, empty text clears", async () => {
    await save({ win: "A", obstacle: "B", focus: "C", rating: 3 });
    await save({ win: "", rating: null });
    const rows = await db.weeklyReview.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ win: null, obstacle: "B", focus: "C", rating: null });
  });

  describe("moves", () => {
    it("keep changes nothing", async () => {
      const before = await row(id("Keep me"));
      await save({ moves: [{ taskId: id("Keep me"), action: "keep" }] });
      expect(await row(id("Keep me"))).toEqual(before);
    });

    it("nextWeek moves the due date to next Monday at the same time, and the plan with it", async () => {
      await save({ moves: [{ taskId: id("Push me"), action: "nextWeek" }, { taskId: id("Push planned only"), action: "nextWeek" }] });
      const pushed = await row(id("Push me"));
      expect(pushed.dueDate.toISOString()).toBe("2026-10-26T14:15:00.000Z");
      expect(pushed.plannedFor).toBe(NEXT);
      const planned = await row(id("Push planned only"));
      expect(planned.plannedFor).toBe(NEXT);
      expect(planned.dueDate).toBeNull();
    });

    it("nextWeek keeps the local time of day in the user's zone", async () => {
      await db.task.update({ where: { id: id("Keep me") }, data: { dueDate: new Date("2026-10-21T03:30:00Z") } }); // 23:30 on the 20th in New York
      await save({ tz: "America/New_York", moves: [{ taskId: id("Keep me"), action: "nextWeek" }] });
      expect((await row(id("Keep me"))).dueDate.toISOString()).toBe("2026-10-27T03:30:00.000Z"); // 23:30 on Monday the 26th
    });

    it("nextWeek on a task with a due date but no plan leaves it unplanned", async () => {
      await save({ moves: [{ taskId: id("Keep me"), action: "nextWeek" }] });
      const t = await row(id("Keep me"));
      expect(t.dueDate.toISOString()).toBe("2026-10-26T09:30:00.000Z");
      expect(t.plannedFor).toBeNull();
    });

    it("backlog clears the plan and the due date", async () => {
      await save({ moves: [{ taskId: id("Push me"), action: "backlog" }] });
      expect(await row(id("Push me"))).toMatchObject({ plannedFor: null, dueDate: null });
    });

    it("archive archives the task and its subtasks and logs it", async () => {
      await save({ moves: [{ taskId: id("Bin me"), action: "archive" }] });
      expect((await row(id("Bin me"))).archivedAt).not.toBeNull();
      expect((await row(id("Sub of bin"))).archivedAt).not.toBeNull();
      expect(await db.activity.count({ where: { taskId: id("Bin me"), action: "archived" } })).toBe(1);
    });

    it("404 and nothing at all is written when any task is someone else's", async () => {
      const theirs = await seedGroup("stranger", { tasks: [{ title: "Theirs" }] });
      const res = await save({ win: "x", moves: [{ taskId: id("Bin me"), action: "archive" }, { taskId: theirs.tasks["Theirs"].id, action: "archive" }] });
      expect(res.status).toBe(404);
      expect((await row(id("Bin me"))).archivedAt).toBeNull();
      expect((await row(theirs.tasks["Theirs"].id)).archivedAt).toBeNull();
      expect(await db.weeklyReview.count()).toBe(0);
    });

    it("404 for a task already in the trash or archive", async () => {
      const gone = await seedGroup("owner-1", { groupName: "G", tasks: [{ title: "Trashed", deletedAt: new Date() }, { title: "Filed", archivedAt: new Date() }] });
      expect((await save({ moves: [{ taskId: gone.tasks["Trashed"].id, action: "backlog" }] })).status).toBe(404);
      expect((await save({ moves: [{ taskId: gone.tasks["Filed"].id, action: "backlog" }] })).status).toBe(404);
    });

    it("404 for a subtask (only top-level tasks can be moved)", async () => {
      expect((await save({ moves: [{ taskId: id("Sub of bin"), action: "backlog" }] })).status).toBe(404);
    });

    it.each([
      ["an unknown action", [{ taskId: "x", action: "delete" }]],
      ["a missing taskId", [{ action: "keep" }]],
      ["the same task twice", [{ taskId: "x", action: "keep" }, { taskId: "x", action: "backlog" }]],
      ["not a list", "keep"],
    ])("400 for %s", async (_n, moves) => {
      expect((await save({ moves })).status).toBe(400);
    });

    it("400 for more than 200 moves", async () => {
      const moves = Array.from({ length: 201 }, (_, i) => ({ taskId: `t${i}`, action: "keep" }));
      expect((await save({ moves })).status).toBe(400);
    });
  });

  describe("next week's frogs", () => {
    it("sets the frog and plans the task for that day, leaving the day to be planned that morning", async () => {
      const res = await save({ frogs: [{ date: NEXT, taskId: id("Frog A") }, { date: "2026-10-27", taskId: id("Frog B") }] });
      expect(res.status).toBe(200);
      const plan = await db.dailyPlan.findUnique({ where: { userId_date: { userId: "owner-1", date: NEXT } } });
      expect(plan).toMatchObject({ frogTaskId: id("Frog A"), plannedAt: null });
      expect((await row(id("Frog A"))).plannedFor).toBe(NEXT);
      expect((await row(id("Frog B"))).plannedFor).toBe("2026-10-27");
    });

    it("replaces a frog set earlier", async () => {
      await save({ frogs: [{ date: NEXT, taskId: id("Frog A") }] });
      await save({ frogs: [{ date: NEXT, taskId: id("Frog B") }] });
      expect((await db.dailyPlan.findUnique({ where: { userId_date: { userId: "owner-1", date: NEXT } } })).frogTaskId).toBe(id("Frog B"));
    });

    it("null clears a frog on a day that was not planned yet, but not on a planned day", async () => {
      await db.dailyPlan.create({ data: { userId: "owner-1", date: NEXT, frogTaskId: id("Frog A") } });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-27", frogTaskId: id("Frog B"), plannedAt: new Date() } });
      await save({ frogs: [{ date: NEXT, taskId: null }, { date: "2026-10-27", taskId: null }] });
      expect((await db.dailyPlan.findUnique({ where: { userId_date: { userId: "owner-1", date: NEXT } } })).frogTaskId).toBeNull();
      expect((await db.dailyPlan.findUnique({ where: { userId_date: { userId: "owner-1", date: "2026-10-27" } } })).frogTaskId).toBe(id("Frog B"));
    });

    it("does not touch another user's plan for the same date", async () => {
      await db.dailyPlan.create({ data: { userId: "stranger", date: NEXT, wentWell: "SECRET" } });
      await save({ frogs: [{ date: NEXT, taskId: id("Frog A") }] });
      expect(await db.dailyPlan.findUnique({ where: { userId_date: { userId: "stranger", date: NEXT } } })).toMatchObject({ wentWell: "SECRET", frogTaskId: null });
    });

    it.each([
      ["a date outside next week", { date: "2026-11-03", taskId: null }],
      ["a date in the reviewed week", { date: "2026-10-23", taskId: null }],
      ["a bad date", { date: "nope", taskId: null }],
      ["a taskId that is not text", { date: NEXT, taskId: 5 }],
    ])("400 for %s", async (_n, frog) => {
      expect((await save({ frogs: [frog] })).status).toBe(400);
    });

    it("400 for two frogs on one day, or one task as two days' frog", async () => {
      expect((await save({ frogs: [{ date: NEXT, taskId: id("Frog A") }, { date: NEXT, taskId: id("Frog B") }] })).status).toBe(400);
      expect((await save({ frogs: [{ date: NEXT, taskId: id("Frog A") }, { date: "2026-10-27", taskId: id("Frog A") }] })).status).toBe(400);
    });

    it("400 when a frog is also being archived or sent to the backlog", async () => {
      expect((await save({ moves: [{ taskId: id("Frog A"), action: "archive" }], frogs: [{ date: NEXT, taskId: id("Frog A") }] })).status).toBe(400);
      expect((await save({ moves: [{ taskId: id("Frog A"), action: "backlog" }], frogs: [{ date: NEXT, taskId: id("Frog A") }] })).status).toBe(400);
      expect(await db.weeklyReview.count()).toBe(0);
    });

    it("404 for someone else's task as a frog, and nothing is written", async () => {
      const theirs = await seedGroup("stranger", { tasks: [{ title: "Theirs" }] });
      expect((await save({ win: "x", frogs: [{ date: NEXT, taskId: theirs.tasks["Theirs"].id }] })).status).toBe(404);
      expect(await db.weeklyReview.count()).toBe(0);
      expect(await db.dailyPlan.count()).toBe(0);
    });
  });

  describe("validation", () => {
    it.each([
      ["a bad weekStart", { weekStart: "2026-10-20" }],
      ["a week in the future", { weekStart: "2026-11-02" }],
      ["a bad tz", { tz: "x" }],
      ["a bad today", { today: "x" }],
      ["win too long", { win: "a".repeat(2001) }],
      ["text with a NUL", { obstacle: "a\u0000" }],
      ["text that is not a string", { focus: 5 }],
      ["a rating of 6", { rating: 6 }],
      ["a rating of 0", { rating: 0 }],
      ["a fractional rating", { rating: 2.5 }],
    ])("400 for %s", async (_n, body) => {
      expect((await save(body)).status).toBe(400);
      expect(await db.weeklyReview.count()).toBe(0);
    });

    it("accepts 2000 characters", async () => {
      expect((await save({ win: "a".repeat(2000) })).status).toBe(200);
    });

    it("400 for a body that is not JSON", async () => {
      const res = await saveReview(new Request("http://localhost/api/review", { method: "POST", body: "{nope" }));
      expect(res.status).toBe(400);
    });
  });
});

describe("GET /api/review/status", () => {
  it("401 with no user; 400 for a bad date", async () => {
    expect((await status("x")).status).toBe(400);
    setFakeUser(null);
    expect((await status(TODAY)).status).toBe(401);
  });

  it("nudges on Friday to Monday when that week has not been reviewed", async () => {
    // Saturday: the week under review is the current one (Mon 19)
    expect(((await (await status(TODAY)).json()) as Json)).toMatchObject({ weekStart: WEEK, nudge: true });
    // Wednesday: no nudge
    expect(((await (await status("2026-10-21")).json()) as Json).nudge).toBe(false);
    // Monday the 26th: the week under review is the one that just ended
    expect(((await (await status(NEXT)).json()) as Json)).toMatchObject({ weekStart: WEEK, nudge: true });
  });

  it("stops nudging once the week is reviewed", async () => {
    await db.weeklyReview.create({ data: { userId: "owner-1", weekStart: WEEK, reviewedAt: new Date() } });
    expect(((await (await status(TODAY)).json()) as Json).nudge).toBe(false);
  });

  it("a review row that was never submitted does not count as reviewed", async () => {
    await db.weeklyReview.create({ data: { userId: "owner-1", weekStart: WEEK } });
    expect(((await (await status(TODAY)).json()) as Json).nudge).toBe(true);
  });

  it("returns last week's focus during the week it applies to, and only your own", async () => {
    await db.weeklyReview.create({ data: { userId: "owner-1", weekStart: WEEK, focus: "Ship v2", reviewedAt: new Date() } });
    await db.weeklyReview.create({ data: { userId: "stranger", weekStart: WEEK, focus: "SECRET" } });
    expect(((await (await status(NEXT)).json()) as Json).thisWeekFocus).toBe("Ship v2");
    // two weeks on, it no longer applies
    expect(((await (await status("2026-11-03")).json()) as Json).thisWeekFocus).toBeNull();
    expect(JSON.stringify(await (await status(NEXT)).json())).not.toContain("SECRET");
  });
});
