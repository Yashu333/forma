// H3 and H4: GET /api/calendar, POST /api/focus-sessions, GET /api/reports/focus,
// and the focus totals plus ownership check on GET /api/tasks/[id].
import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { GET as calendar } from "@/app/api/calendar/route";
import { POST as logSession } from "@/app/api/focus-sessions/route";
import { GET as focusReport } from "@/app/api/reports/focus/route";
import { GET as getTask } from "@/app/api/tasks/[id]/route";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const cal = (q: Record<string, string>) => calendar(new Request(`http://localhost/api/calendar?${new URLSearchParams(q)}`));
const log = (body: unknown) => logSession(new Request("http://localhost/api/focus-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const report = (q: Record<string, string>) => focusReport(new NextRequest(`http://localhost/api/reports/focus?${new URLSearchParams(q)}`));
const show = (id: string) => getTask(new Request(`http://localhost/api/tasks/${id}`), { params: Promise.resolve({ id }) });

describe("GET /api/calendar", () => {
  beforeEach(() => signInAs("owner-1"));
  const q = { from: "2026-10-19", to: "2026-10-25", tz: "UTC" };

  it("401 with no user", async () => {
    setFakeUser(null);
    expect((await cal(q)).status).toBe(401);
  });

  it.each([
    ["no from", { to: "2026-10-25", tz: "UTC" }],
    ["bad from", { from: "2026-02-30", to: "2026-10-25", tz: "UTC" }],
    ["from after to", { from: "2026-10-25", to: "2026-10-19", tz: "UTC" }],
    ["bad tz", { from: "2026-10-19", to: "2026-10-25", tz: "Nowhere/Land" }],
    ["no tz", { from: "2026-10-19", to: "2026-10-25" }],
    ["63 days", { from: "2026-10-01", to: "2026-12-02", tz: "UTC" }],
  ])("400: %s", async (_n, params) => {
    expect((await cal(params)).status).toBe(400);
  });

  it("accepts exactly 62 days", async () => {
    expect((await cal({ from: "2026-10-01", to: "2026-12-01", tz: "UTC" })).status).toBe(200);
  });

  it("returns tasks due in the range, with project and done flag, and leaves the rest out", async () => {
    const g = await seedGroup("owner-1", {
      groupName: "Home",
      tasks: [
        { title: "In range", extra: { dueDate: new Date("2026-10-21T09:00:00Z") } },
        { title: "Finished", status: "Done", extra: { dueDate: new Date("2026-10-22T09:00:00Z") } },
        { title: "Too early", extra: { dueDate: new Date("2026-10-18T23:59:00Z") } },
        { title: "Too late", extra: { dueDate: new Date("2026-10-26T00:00:00Z") } },
      ],
    });
    const body: Json = await (await cal(q)).json();
    expect(body.tasks.map((t: Json) => [t.title, t.done])).toEqual([["In range", false], ["Finished", true]]);
    expect(body.tasks[0].group).toEqual({ id: g.group.id, name: "Home", color: "#F97316" });
  });

  it("buckets the range by the user's zone, not UTC", async () => {
    await seedGroup("owner-1", { tasks: [{ title: "Late night", extra: { dueDate: new Date("2026-10-26T03:30:00Z") } }] });
    // 03:30Z on the 26th is 23:30 on the 25th in New York: inside the week there, outside it in UTC.
    expect(((await (await cal({ ...q, tz: "America/New_York" })).json()) as Json).tasks).toHaveLength(1);
    expect(((await (await cal(q)).json()) as Json).tasks).toHaveLength(0);
  });

  it("never returns subtasks, deleted or archived tasks, or another user's tasks", async () => {
    await seedGroup("owner-1", {
      tasks: [
        { title: "Parent", extra: { dueDate: new Date("2026-10-21T09:00:00Z") } },
        { title: "Sub", parentTitle: "Parent", extra: { dueDate: new Date("2026-10-21T09:00:00Z") } },
        { title: "Trashed", deletedAt: new Date(), extra: { dueDate: new Date("2026-10-21T09:00:00Z") } },
        { title: "Filed", archivedAt: new Date(), extra: { dueDate: new Date("2026-10-21T09:00:00Z") } },
      ],
    });
    await seedGroup("stranger", { tasks: [{ title: "Theirs", extra: { dueDate: new Date("2026-10-21T09:00:00Z") } }] });
    const body: Json = await (await cal(q)).json();
    expect(body.tasks.map((t: Json) => t.title)).toEqual(["Parent"]);
  });

  it("lists open overdue tasks from before today, wherever the range is", async () => {
    const past = new Date(Date.now() - 3 * 86_400_000);
    await seedGroup("owner-1", {
      tasks: [
        { title: "Slipped", extra: { dueDate: past } },
        { title: "Slipped but done", status: "Done", extra: { dueDate: past } },
        { title: "Future", extra: { dueDate: new Date(Date.now() + 5 * 86_400_000) } },
      ],
    });
    const body: Json = await (await cal({ from: "2030-01-01", to: "2030-01-07", tz: "UTC" })).json();
    expect(body.overdue.map((t: Json) => t.title)).toEqual(["Slipped"]);
    expect(body.tasks).toEqual([]);
  });

  it("lists open undated tasks as unscheduled", async () => {
    await seedGroup("owner-1", { tasks: [{ title: "Someday" }, { title: "Done undated", status: "Done" }, { title: "Dated", extra: { dueDate: new Date("2026-10-21T09:00:00Z") } }] });
    const body: Json = await (await cal(q)).json();
    expect(body.unscheduled.map((t: Json) => t.title)).toEqual(["Someday"]);
  });

  it("lists open repeating tasks for the faded entries, not finished or plain ones", async () => {
    const rule = { freq: "day", interval: 1 };
    await seedGroup("owner-1", {
      tasks: [
        { title: "Repeats", extra: { dueDate: new Date("2026-10-21T09:00:00Z"), repeat: rule } },
        { title: "Finished repeater", status: "Done", extra: { dueDate: new Date("2026-10-21T09:00:00Z"), repeat: rule } },
        { title: "Plain", extra: { dueDate: new Date("2026-10-21T09:00:00Z") } },
      ],
    });
    const body: Json = await (await cal(q)).json();
    expect(body.recurring.map((r: Json) => r.title)).toEqual(["Repeats"]);
    expect(body.recurring[0].repeat).toEqual(rule);
  });

  it("returns the columns of each of the user's projects, and only theirs", async () => {
    const mine = await seedGroup("owner-1");
    const theirs = await seedGroup("stranger");
    const body: Json = await (await cal(q)).json();
    expect(Object.keys(body.statusesByGroup)).toEqual([mine.group.id]);
    expect(body.statusesByGroup[mine.group.id].map((s: Json) => s.name)).toEqual(["To Do", "In Progress", "Done"]);
    expect(body.statusesByGroup[theirs.group.id]).toBeUndefined();
  });
});

describe("POST /api/focus-sessions", () => {
  let g: Awaited<ReturnType<typeof seedGroup>>;
  const ok = (extra: Json = {}) => ({
    startedAt: "2026-10-24T09:00:00.000Z", endedAt: "2026-10-24T09:25:00.000Z", durationSec: 1500, completed: true, ...extra,
  });
  beforeEach(async () => {
    g = await seedGroup("owner-1", { tasks: [{ title: "Write" }] });
    signInAs("owner-1");
  });

  it("401 with no user", async () => {
    setFakeUser(null);
    expect((await log(ok())).status).toBe(401);
    expect(await db.focusSession.count()).toBe(0);
  });

  it("logs a session against a task", async () => {
    const res = await log(ok({ taskId: g.tasks["Write"].id }));
    expect(res.status).toBe(201);
    const row = await db.focusSession.findFirst();
    expect(row).toMatchObject({ userId: "owner-1", taskId: g.tasks["Write"].id, durationSec: 1500, completed: true });
  });

  it("logs a session with no task", async () => {
    expect((await log(ok({ taskId: null }))).status).toBe(201);
    expect((await log(ok())).status).toBe(201);
    expect((await db.focusSession.findFirst()).taskId).toBeNull();
  });

  it("a paused session may be longer on the clock than its focus time", async () => {
    expect((await log(ok({ endedAt: "2026-10-24T10:30:00.000Z" }))).status).toBe(201);
  });

  it("404 for another user's task or a trashed one, and nothing is written", async () => {
    const theirs = await seedGroup("stranger", { tasks: [{ title: "Theirs" }] });
    const trashed = await seedGroup("owner-1", { groupName: "T", tasks: [{ title: "Gone", deletedAt: new Date() }] });
    expect((await log(ok({ taskId: theirs.tasks["Theirs"].id }))).status).toBe(404);
    expect((await log(ok({ taskId: trashed.tasks["Gone"].id }))).status).toBe(404);
    expect(await db.focusSession.count()).toBe(0);
  });

  it.each([
    ["not ISO dates", { startedAt: "yesterday" }],
    ["end before start", { endedAt: "2026-10-24T08:00:00.000Z" }],
    ["end equals start", { endedAt: "2026-10-24T09:00:00.000Z" }],
    ["under a minute", { durationSec: 59, endedAt: "2026-10-24T09:01:00.000Z" }],
    ["over four hours", { durationSec: 14401, endedAt: "2026-10-24T14:00:00.000Z" }],
    ["fractional seconds", { durationSec: 1500.5 }],
    ["more focus time than the clock allows", { durationSec: 1700 }],
    ["completed not a boolean", { completed: "yes" }],
    ["taskId not text", { taskId: 5 }],
    ["taskId with NUL", { taskId: "a\u0000" }],
  ])("400: %s", async (_n, extra) => {
    const res = await log(ok(extra));
    expect(res.status).toBe(400);
    expect(await db.focusSession.count()).toBe(0);
  });
});

describe("GET /api/tasks/[id]: focus totals and ownership", () => {
  it("includes the task's own time and its subtasks' time, only this user's", async () => {
    const g = await seedGroup("owner-1", { tasks: [{ title: "Parent" }, { title: "Sub", parentTitle: "Parent" }, { title: "Elsewhere" }] });
    const sess = (taskId: string, durationSec: number, userId = "owner-1") =>
      db.focusSession.create({ data: { userId, taskId, startedAt: new Date(), endedAt: new Date(), durationSec, completed: true } });
    await sess(g.tasks["Parent"].id, 1500);
    await sess(g.tasks["Sub"].id, 600);
    await sess(g.tasks["Elsewhere"].id, 999);
    await sess(g.tasks["Parent"].id, 777, "stranger");
    signInAs("owner-1");
    const body: Json = await (await show(g.tasks["Parent"].id)).json();
    expect(body.focus).toEqual({ totalSec: 2100, sessions: 2 });
  });

  it("a task with no sessions has zero focus", async () => {
    const g = await seedGroup("owner-1", { tasks: [{ title: "T" }] });
    signInAs("owner-1");
    expect(((await (await show(g.tasks["T"].id)).json()) as Json).focus).toEqual({ totalSec: 0, sessions: 0 });
  });

  it("404 for another user's task, 401 signed out", async () => {
    const g = await seedGroup("owner-1", { tasks: [{ title: "T" }] });
    signInAs("stranger");
    expect((await show(g.tasks["T"].id)).status).toBe(404);
    setFakeUser(null);
    expect((await show(g.tasks["T"].id)).status).toBe(401);
  });

  it("404 for a trashed or archived task", async () => {
    const g = await seedGroup("owner-1", { tasks: [{ title: "Gone", deletedAt: new Date() }, { title: "Filed", archivedAt: new Date() }] });
    signInAs("owner-1");
    expect((await show(g.tasks["Gone"].id)).status).toBe(404);
    expect((await show(g.tasks["Filed"].id)).status).toBe(404);
  });
});

describe("GET /api/reports/focus", () => {
  const q = { days: "7", tz: "UTC", today: "2026-10-24" };
  const sess = (taskId: string | null, startedAt: string, durationSec: number, userId = "owner-1") =>
    db.focusSession.create({ data: { userId, taskId, startedAt: new Date(startedAt), endedAt: new Date(startedAt), durationSec, completed: true } });
  beforeEach(() => signInAs("owner-1"));

  it("401 with no user", async () => {
    setFakeUser(null);
    expect((await report(q)).status).toBe(401);
  });

  it.each([
    ["days 5", { ...q, days: "5" }],
    ["days all", { ...q, days: "all" }],
    ["no tz", { days: "7", today: "2026-10-24" }],
    ["bad today", { ...q, today: "2026-13-01" }],
  ])("400: %s", async (_n, params) => {
    expect((await report(params)).status).toBe(400);
  });

  it("totals, per day, per project, top tasks and untracked time", async () => {
    const a = await seedGroup("owner-1", { groupName: "Work", tasks: [{ title: "Report" }, { title: "Email" }] });
    const b = await seedGroup("owner-1", { groupName: "Home", tasks: [{ title: "Garden" }] });
    await sess(a.tasks["Report"].id, "2026-10-24T09:00:00Z", 1500);
    await sess(a.tasks["Report"].id, "2026-10-23T09:00:00Z", 1500);
    await sess(a.tasks["Email"].id, "2026-10-23T11:00:00Z", 600);
    await sess(b.tasks["Garden"].id, "2026-10-22T11:00:00Z", 900);
    await sess(null, "2026-10-22T12:00:00Z", 300);
    await sess(a.tasks["Report"].id, "2026-10-01T09:00:00Z", 9999); // outside the window
    await sess(a.tasks["Report"].id, "2026-10-24T09:00:00Z", 5555, "stranger");

    const body: Json = await (await report(q)).json();
    expect(body.totalSec).toBe(1500 + 1500 + 600 + 900 + 300);
    expect(body.sessions).toBe(5);
    expect(body.untrackedSec).toBe(300);
    expect(body.daily).toHaveLength(7);
    expect(body.daily[6]).toEqual({ date: "2026-10-24", sec: 1500 });
    expect(body.daily[5]).toEqual({ date: "2026-10-23", sec: 2100 });
    expect(body.byProject.map((p: Json) => [p.name, p.sec])).toEqual([["Work", 3600], ["Home", 900]]);
    expect(body.topTasks.map((t: Json) => [t.title, t.sec, t.sessions])).toEqual([["Report", 3000, 2], ["Garden", 900, 1], ["Email", 600, 1]]);
  });

  it("groups sessions by the user's local day", async () => {
    const g = await seedGroup("owner-1", { tasks: [{ title: "T" }] });
    await sess(g.tasks["T"].id, "2026-10-25T03:30:00Z", 1500); // the 24th, 23:30 in New York
    const ny: Json = await (await report({ ...q, tz: "America/New_York" })).json();
    expect(ny.daily[6]).toEqual({ date: "2026-10-24", sec: 1500 });
    const utc: Json = await (await report(q)).json();
    expect(utc.totalSec).toBe(0); // the 25th is after "today" in UTC
  });

  it("projects excluded from reports count in totals but are not named", async () => {
    const secret = await seedGroup("owner-1", { groupName: "Private", excludeFromReports: true, tasks: [{ title: "Hidden" }] });
    const open = await seedGroup("owner-1", { groupName: "Public", tasks: [{ title: "Shown" }] });
    await sess(secret.tasks["Hidden"].id, "2026-10-24T09:00:00Z", 1000);
    await sess(open.tasks["Shown"].id, "2026-10-24T10:00:00Z", 500);
    const body: Json = await (await report(q)).json();
    expect(body.totalSec).toBe(1500);
    expect(body.byProject.map((p: Json) => p.name)).toEqual(["Public"]);
    expect(body.topTasks.map((t: Json) => t.title)).toEqual(["Shown"]);
    expect(JSON.stringify(body)).not.toContain("Private");
    expect(JSON.stringify(body)).not.toContain("Hidden");
  });

  it("an empty window is all zeros", async () => {
    const body: Json = await (await report(q)).json();
    expect(body).toMatchObject({ totalSec: 0, sessions: 0, byProject: [], topTasks: [], untrackedSec: 0 });
    expect(body.daily.every((d: Json) => d.sec === 0)).toBe(true);
  });
});
