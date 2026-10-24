// M6: GET /api/reports/frog. Real route handler, real local Postgres. Responses
// are asserted against hand-computed numbers for data seeded straight into the
// DB (`db` is typed any, so a wrong Prisma field name only shows up here).
// Nothing reads the real clock: every request passes tz + today.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { seedGroup, signInAs, setFakeUser } from "./helpers";
import { GET as getFrogReport } from "@/app/api/reports/frog/route";
import { GET as getReports } from "@/app/api/reports/route";
import { get as getToday, type Json } from "./today-helpers";

const NY = "America/New_York";
const TODAY = "2026-10-24";
const DAY_MS = 86_400_000;

type Q = Record<string, string | undefined>;
function call(q: Q = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ tz: NY, today: TODAY, ...q })) if (v !== undefined) qs.set(k, v);
  return getFrogReport(new Request(`http://localhost/api/reports/frog?${qs.toString()}`));
}
async function report(q: Q = {}): Promise<Json> {
  const res = await call(q);
  expect(res.status).toBe(200);
  return res.json();
}

/** `key` shifted by n days (test-side arithmetic on UTC midnights; independent of the product code). */
const shift = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

interface Env {
  userId: string;
  groupId: string;
  statusId: string;
  doneStatusId: string;
}

async function seedUser(userId: string, opts: { groupName?: string; excludeFromReports?: boolean } = {}): Promise<Env> {
  const { group, statuses } = await seedGroup(userId, { groupName: opts.groupName ?? `${userId}-project`, excludeFromReports: opts.excludeFromReports });
  return { userId, groupId: group.id, statusId: statuses["To Do"].id, doneStatusId: statuses["Done"].id };
}

let seq = 0;
async function addTask(env: Env, o: { title?: string; completedAt?: string | null; archivedAt?: string; deletedAt?: string; parentTaskId?: string; abcde?: string | null } = {}) {
  return db.task.create({
    data: {
      title: o.title ?? `task-${++seq}`,
      groupId: env.groupId,
      statusId: o.completedAt ? env.doneStatusId : env.statusId,
      priority: "MEDIUM",
      order: 0,
      createdBy: env.userId,
      completedAt: o.completedAt ? new Date(o.completedAt) : null,
      archivedAt: o.archivedAt ? new Date(o.archivedAt) : null,
      deletedAt: o.deletedAt ? new Date(o.deletedAt) : null,
      parentTaskId: o.parentTaskId ?? null,
      abcde: o.abcde ?? null,
    },
  });
}

/**
 * A daily plan with a frog. `frog`: an ISO instant = the frog was completed then,
 * null = an open frog, false = a plan without a frog.
 */
async function addPlan(
  env: Env,
  date: string,
  frog: string | null | false,
  plan: Record<string, unknown> = {},
  task: { title?: string; archivedAt?: string; deletedAt?: string; abcde?: string | null } = {},
) {
  const frogTask = frog === false ? null : await addTask(env, { ...task, completedAt: frog });
  const row = await db.dailyPlan.create({ data: { userId: env.userId, date, frogTaskId: frogTask?.id ?? null, ...plan } });
  return { plan: row, frogTask };
}

const zeroCounts = { A: 0, B: 0, C: 0, D: 0, E: 0, none: 0 };
const REVIEWED = new Date("2026-10-01T20:00:00Z");

describe("GET /api/reports/frog", () => {
  let me: Env;

  beforeEach(async () => {
    signInAs("owner-1");
    me = await seedUser("owner-1", { groupName: "Mine" });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ───────────────────────────── auth + validation ─────────────────────────────

  describe("auth and validation", () => {
    it("401 with no user, even with valid params", async () => {
      setFakeUser(null);
      const res = await call();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("401 comes before validation (no user, no params)", async () => {
      setFakeUser(null);
      const res = await getFrogReport(new Request("http://localhost/api/reports/frog"));
      expect(res.status).toBe(401);
    });

    const invalid: [string, Q][] = [
      ["tz missing", { tz: undefined }],
      ["tz empty", { tz: "" }],
      ["tz unknown zone", { tz: "Mars/Base" }],
      ["tz an offset (+05:00)", { tz: "+05:00" }],
      ["tz an offset (-05:00)", { tz: "-05:00" }],
      ["tz a bare number", { tz: "5" }],
      ["tz with a NUL", { tz: "UTC\u0000" }],
      ["tz with a leading NUL", { tz: "\u0000UTC" }],
      ["tz only a NUL", { tz: "\u0000" }],
      ["tz SQL-ish", { tz: "UTC'; DROP TABLE \"Task\";--" }],
      ["tz very long", { tz: "A".repeat(5000) }],
      ["today missing", { today: undefined }],
      ["today empty", { today: "" }],
      ["today 2026-02-30", { today: "2026-02-30" }],
      ["today 2026-02-29 (not a leap year)", { today: "2026-02-29" }],
      ["today 2026-13-01", { today: "2026-13-01" }],
      ["today 2026-00-10", { today: "2026-00-10" }],
      ["today 2026-10-00", { today: "2026-10-00" }],
      ["today 2026-1-5 (not padded)", { today: "2026-1-5" }],
      ["today 20261024", { today: "20261024" }],
      ["today 2026/10/24", { today: "2026/10/24" }],
      ["today trailing junk", { today: "2026-10-24x" }],
      ["today trailing newline", { today: "2026-10-24\n" }],
      ["today a timestamp", { today: "2026-10-24T10:00:00Z" }],
      ["today with a NUL", { today: "2026-10-24\u0000" }],
      ["today non-ASCII digits", { today: "２０２６-10-24" }],
      ["today 0000-01-01 (below range)", { today: "0000-01-01" }],
      ["today 0001-01-02 (below range)", { today: "0001-01-02" }],
      ["today 9998-12-30 (above range)", { today: "9998-12-30" }],
      ["today 9999-12-31 (above range)", { today: "9999-12-31" }],
      ["days abc", { days: "abc" }],
      ["days empty", { days: "" }],
      ["days 1.5", { days: "1.5" }],
      ["days -3", { days: "-3" }],
      ["days +30", { days: "+30" }],
      ["days 1e2", { days: "1e2" }],
      ["days 0x10", { days: "0x10" }],
      ["days ALL (case sensitive)", { days: "ALL" }],
      ["days trailing space", { days: "30 " }],
      ["days leading space", { days: " 30" }],
      ["days NUL", { days: "\u0000" }],
      ["days digits then NUL", { days: "30\u0000" }],
      ["days NaN", { days: "NaN" }],
      ["days Infinity", { days: "Infinity" }],
      ["days 7 digits (huge)", { days: "1234567" }],
      ["days 40 digits (huge)", { days: "9".repeat(40) }],
      ["days a list", { days: "7,30" }],
      ["days SQL-ish", { days: "30; DROP TABLE x" }],
    ];

    it.each(invalid)("400 for %s, with only a message and nothing else in the body", async (_label, q) => {
      // The user and a stranger both have data; none of it may leak into an error.
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z", { reviewedAt: REVIEWED, wentWell: "MY-REFLECTION" }, { title: "MY-FROG" });
      const stranger = await seedUser("stranger", { groupName: "SECRET-GROUP" });
      await addPlan(stranger, "2026-10-23", "2026-10-23T14:00:00Z", { reviewedAt: REVIEWED, wentWell: "SECRET-REFLECTION" }, { title: "SECRET-FROG" });

      const res = await call(q);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(Object.keys(body)).toEqual(["error"]);
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
      const text = JSON.stringify(body);
      for (const needle of ["SECRET", "MY-FROG", "MY-REFLECTION", "owner-1", "stranger", me.groupId, "Mine", "stats", "daily", "prisma", "Prisma"]) {
        expect(text).not.toContain(needle);
      }
      // The error never echoes the offending input back.
      const offending = Object.values(q).find((v) => v);
      if (offending && offending.length > 6) expect(text).not.toContain(offending.slice(0, 20));
    });

    it("the 400 for a bad tz names tz; for bad today names today; for bad days names days", async () => {
      expect((await (await call({ tz: "Mars/Base" })).json()).error).toMatch(/tz/i);
      expect((await (await call({ today: "nope" })).json()).error).toMatch(/today/i);
      expect((await (await call({ days: "abc" })).json()).error).toMatch(/days/i);
    });

    it("a rejected request writes nothing", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z");
      const counts = async () => [await db.dailyPlan.count(), await db.task.count(), await db.activity.count()];
      const before = await counts();
      for (const q of [{ tz: "Mars/Base" }, { today: "x" }, { days: "abc" }] as Q[]) await call(q);
      expect(await counts()).toEqual(before);
    });

    it.each([
      ["days omitted → 30", { days: undefined }, 30],
      ["days=7", { days: "7" }, 7],
      ["days=007 (leading zeros are digits)", { days: "007" }, 7],
      ["days=0 → clamped to 7", { days: "0" }, 7],
      ["days=3 → clamped to 7", { days: "3" }, 7],
      ["days=6 → 7", { days: "6" }, 7],
      ["days=8", { days: "8" }, 8],
      ["days=364", { days: "364" }, 364],
      ["days=366 → clamped to 365", { days: "366" }, 365],
      ["days=9999 → 365", { days: "9999" }, 365],
      ["days=999999 (six digits) → 365", { days: "999999" }, 365],
    ])("%s", async (_label, q, expectedLength) => {
      const r = await report(q as Q);
      expect(r.daily).toHaveLength(expectedLength);
      expect(r.daily[r.daily.length - 1].date).toBe(TODAY);
    });

    it("with repeated days params the first one wins", async () => {
      const res = await getFrogReport(new Request(`http://localhost/api/reports/frog?tz=${NY}&today=${TODAY}&days=7&days=90`));
      expect((await res.json()).daily).toHaveLength(7);
    });

    it("accepts any valid IANA zone (UTC, Asia/Kolkata, Pacific/Kiritimati) and the supported edges of today", async () => {
      for (const tz of ["UTC", "Asia/Kolkata", "Pacific/Kiritimati", "Etc/GMT+12", "America/Argentina/Buenos_Aires"]) {
        expect((await call({ tz })).status).toBe(200);
      }
      expect((await call({ today: "0001-01-03" })).status).toBe(200);
      expect((await call({ today: "9998-12-29", days: "all" })).status).toBe(200);
    });

    it("today at the lower edge returns a strip that does not go below the supported minimum", async () => {
      const r = await report({ today: "0001-01-10", days: "365" });
      expect(r.daily[0].date).toBe("0001-01-03");
      expect(r.daily).toHaveLength(8);
    });
  });

  // ───────────────────────────── exact response shape ─────────────────────────────

  describe("response shape", () => {
    it("returns exactly { stats, daily, abcdeCompleted, reflections } with the documented fields", async () => {
      await addPlan(me, "2026-10-24", null, {}, { title: "Today's frog" });
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z", { reviewedAt: REVIEWED, rating: 4, wentWell: "Shipped it" }, { title: "Yesterday's frog", abcde: "A" });

      const r = await report({ days: "7" });
      expect(r).toEqual({
        stats: { plannedDays: 2, eatenDays: 1, eatenRate: 0.5, beforeNoonRate: 1, current: 1, longest: 1 },
        daily: [
          { date: "2026-10-18", planned: false, eaten: false, beforeNoon: false },
          { date: "2026-10-19", planned: false, eaten: false, beforeNoon: false },
          { date: "2026-10-20", planned: false, eaten: false, beforeNoon: false },
          { date: "2026-10-21", planned: false, eaten: false, beforeNoon: false },
          { date: "2026-10-22", planned: false, eaten: false, beforeNoon: false },
          { date: "2026-10-23", planned: true, eaten: true, beforeNoon: true },
          { date: "2026-10-24", planned: true, eaten: false, beforeNoon: false },
        ],
        abcdeCompleted: { A: 1, B: 0, C: 0, D: 0, E: 0, none: 0 },
        reflections: [{ date: "2026-10-23", rating: 4, wentWell: "Shipped it", improve: null, frogTitle: "Yesterday's frog", eaten: true }],
      });
      expect(Object.keys(r)).toEqual(["stats", "daily", "abcdeCompleted", "reflections"]);
    });

    it("an empty account gets all zeros, a full-length strip, and no reflections (not an error)", async () => {
      const r = await report({ days: "30" });
      expect(r.stats).toEqual({ plannedDays: 0, eatenDays: 0, eatenRate: 0, beforeNoonRate: 0, current: 0, longest: 0 });
      expect(r.daily).toHaveLength(30);
      expect(r.daily.every((d: Json) => !d.planned && !d.eaten && !d.beforeNoon)).toBe(true);
      expect(r.abcdeCompleted).toEqual(zeroCounts);
      expect(r.reflections).toEqual([]);
    });

    it("a user with no projects at all also gets the empty report", async () => {
      signInAs("nobody");
      const r = await report();
      expect(r.stats.plannedDays).toBe(0);
      expect(r.abcdeCompleted).toEqual(zeroCounts);
      expect(r.reflections).toEqual([]);
    });

    it("the response contains no numbers that are NaN/Infinity (JSON would turn them into null)", async () => {
      const r = await report({ days: "7" });
      for (const v of Object.values(r.stats)) expect(typeof v).toBe("number");
    });

    it("reads every new DB field: plannedAt/reviewedAt/rating/wentWell/improve/frogTaskId/abcde/completedAt", async () => {
      const { frogTask } = await addPlan(
        me,
        "2026-10-22",
        "2026-10-22T13:00:00Z",
        { plannedAt: new Date("2026-10-22T08:00:00Z"), reviewedAt: REVIEWED, rating: 5, wentWell: "ww", improve: "imp" },
        { title: "F", abcde: "B" },
      );
      const r = await report();
      expect(r.reflections[0]).toEqual({ date: "2026-10-22", rating: 5, wentWell: "ww", improve: "imp", frogTitle: "F", eaten: true });
      expect(r.abcdeCompleted.B).toBe(1);
      expect(frogTask).toBeTruthy();
    });
  });

  // ───────────────────────────── stats ─────────────────────────────

  describe("stats", () => {
    it("hand-computed scenario: gap, uneaten today, next-day completion, noon edges, no-frog plan, future plan", async () => {
      // NY is UTC-4 on these dates (EDT): 14:00Z = 10:00 local.
      await addPlan(me, "2026-10-25", "2026-10-25T14:00:00Z"); // tomorrow's preselected frog: ignored entirely
      await addPlan(me, "2026-10-24", null); // today, not eaten yet
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z"); // 10:00 local, before noon
      await addPlan(me, "2026-10-22", "2026-10-22T17:00:00Z"); // 13:00 local, after noon
      // 2026-10-21: no plan (gap)
      await addPlan(me, "2026-10-20", "2026-10-20T13:00:00Z"); // 09:00 local
      await addPlan(me, "2026-10-19", "2026-10-19T15:59:00Z"); // 11:59 local, before noon
      await addPlan(me, "2026-10-18", "2026-10-18T16:00:00Z"); // 12:00 local sharp: NOT before noon
      await addPlan(me, "2026-10-17", "2026-10-18T14:00:00Z"); // eaten the day after the plan date: not eaten
      await addPlan(me, "2026-10-16", false); // a plan with no frog: not a planned day

      const r = await report({ days: "30" });
      // planned: 24,23,22,20,19,18,17 = 7; eaten: 23,22,20,19,18 = 5; before noon: 23,20,19 = 3
      expect(r.stats.plannedDays).toBe(7);
      expect(r.stats.eatenDays).toBe(5);
      expect(r.stats.eatenRate).toBeCloseTo(5 / 7, 12);
      expect(r.stats.beforeNoonRate).toBeCloseTo(3 / 5, 12);
      // today uneaten does not break the streak: 23,22 then the gap on 21 → current 2; 18,19,20 → longest 3
      expect(r.stats.current).toBe(2);
      expect(r.stats.longest).toBe(3);

      const byDate = Object.fromEntries(r.daily.map((d: Json) => [d.date, d]));
      expect(byDate["2026-10-24"]).toEqual({ date: "2026-10-24", planned: true, eaten: false, beforeNoon: false });
      expect(byDate["2026-10-23"]).toEqual({ date: "2026-10-23", planned: true, eaten: true, beforeNoon: true });
      expect(byDate["2026-10-22"]).toEqual({ date: "2026-10-22", planned: true, eaten: true, beforeNoon: false });
      expect(byDate["2026-10-21"]).toEqual({ date: "2026-10-21", planned: false, eaten: false, beforeNoon: false });
      expect(byDate["2026-10-19"].beforeNoon).toBe(true);
      expect(byDate["2026-10-18"]).toEqual({ date: "2026-10-18", planned: true, eaten: true, beforeNoon: false });
      expect(byDate["2026-10-17"]).toEqual({ date: "2026-10-17", planned: true, eaten: false, beforeNoon: false });
      expect(byDate["2026-10-16"]).toEqual({ date: "2026-10-16", planned: false, eaten: false, beforeNoon: false });
      expect(byDate["2026-10-25"]).toBeUndefined();
      expect(r.daily.map((d: Json) => d.date)).not.toContain("2026-10-25");
    });

    it("today's frog eaten counts as the newest day of the current streak", async () => {
      await addPlan(me, "2026-10-24", "2026-10-24T13:00:00Z");
      await addPlan(me, "2026-10-23", "2026-10-23T13:00:00Z");
      await addPlan(me, "2026-10-22", "2026-10-22T13:00:00Z");
      const r = await report();
      expect(r.stats).toMatchObject({ plannedDays: 3, eatenDays: 3, eatenRate: 1, current: 3, longest: 3 });
    });

    it("an uneaten frog yesterday (and an open one today) leaves the current streak at 0, with the older eaten day as the longest", async () => {
      await addPlan(me, "2026-10-24", null);
      await addPlan(me, "2026-10-23", null);
      await addPlan(me, "2026-10-22", "2026-10-22T13:00:00Z");
      const r = await report();
      expect(r.stats.current).toBe(0);
      expect(r.stats.longest).toBe(1);
    });

    it("a frog completed the day after the plan date is not eaten, even if completed a few minutes after local midnight", async () => {
      // 00:30 local on the 24th = 04:30Z. The plan is for the 23rd.
      await addPlan(me, "2026-10-23", "2026-10-24T04:30:00Z");
      // 23:30 local on the 22nd = 03:30Z on the 23rd. The plan is for the 22nd: eaten (UTC date is already the 23rd).
      await addPlan(me, "2026-10-22", "2026-10-23T03:30:00Z");
      const r = await report();
      const byDate = Object.fromEntries(r.daily.map((d: Json) => [d.date, d]));
      expect(byDate["2026-10-23"]).toMatchObject({ planned: true, eaten: false });
      expect(byDate["2026-10-22"]).toMatchObject({ planned: true, eaten: true, beforeNoon: false });
      expect(r.stats).toMatchObject({ plannedDays: 2, eatenDays: 1, beforeNoonRate: 0 });
    });

    it("a frog completed before the plan date counts as eaten (planned the day before, eaten ahead of time)", async () => {
      await addPlan(me, "2026-10-23", "2026-10-21T14:00:00Z");
      const r = await report();
      expect(r.stats).toMatchObject({ plannedDays: 1, eatenDays: 1 });
    });

    it("streaks come from ALL plans: a 20-day streak is 20 even with days=7, while the counts cover 7 days", async () => {
      for (let k = 0; k < 20; k++) await addPlan(me, shift(TODAY, -k), `${shift(TODAY, -k)}T14:00:00Z`);
      const r = await report({ days: "7" });
      expect(r.stats.current).toBe(20);
      expect(r.stats.longest).toBe(20);
      expect(r.stats.plannedDays).toBe(7);
      expect(r.stats.eatenDays).toBe(7);
      expect(r.daily).toHaveLength(7);
      // and the same data with days=30 / all: 20 planned in the window
      expect((await report({ days: "30" })).stats).toMatchObject({ plannedDays: 20, eatenDays: 20, current: 20, longest: 20 });
      expect((await report({ days: "all" })).stats).toMatchObject({ plannedDays: 20, current: 20 });
    });

    it("longest streak can lie entirely outside the window", async () => {
      for (let k = 100; k < 105; k++) await addPlan(me, shift(TODAY, -k), `${shift(TODAY, -k)}T14:00:00Z`);
      await addPlan(me, shift(TODAY, -1), `${shift(TODAY, -1)}T14:00:00Z`);
      const r = await report({ days: "30" });
      expect(r.stats).toMatchObject({ plannedDays: 1, eatenDays: 1, current: 1, longest: 5 });
      expect((await report({ days: "all" })).stats).toMatchObject({ plannedDays: 6, eatenDays: 6, current: 1, longest: 5 });
      // 365 reaches back 100..104 days: all in
      expect((await report({ days: "365" })).stats.plannedDays).toBe(6);
    });

    it("window edges for counts: days=7 includes today-6 and excludes today-7", async () => {
      await addPlan(me, shift(TODAY, -6), `${shift(TODAY, -6)}T14:00:00Z`);
      await addPlan(me, shift(TODAY, -7), `${shift(TODAY, -7)}T14:00:00Z`);
      const r = await report({ days: "7" });
      expect(r.stats.plannedDays).toBe(1);
      expect(r.daily[0]).toEqual({ date: shift(TODAY, -6), planned: true, eaten: true, beforeNoon: true });
    });

    it("rates are 0 (not NaN) with nothing planned and with nothing eaten", async () => {
      await addPlan(me, "2026-10-22", null);
      await addPlan(me, "2026-10-21", null);
      const r = await report();
      expect(r.stats).toEqual({ plannedDays: 2, eatenDays: 0, eatenRate: 0, beforeNoonRate: 0, current: 0, longest: 0 });
    });

    it("beforeNoonRate is relative to eaten days (not planned days)", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z"); // before noon
      await addPlan(me, "2026-10-22", "2026-10-22T20:00:00Z"); // 16:00 local
      await addPlan(me, "2026-10-21", "2026-10-21T20:00:00Z"); // 16:00 local
      await addPlan(me, "2026-10-20", null);
      await addPlan(me, "2026-10-19", null);
      const r = await report();
      expect(r.stats.plannedDays).toBe(5);
      expect(r.stats.eatenDays).toBe(3);
      expect(r.stats.beforeNoonRate).toBeCloseTo(1 / 3, 12);
      expect(r.stats.eatenRate).toBeCloseTo(3 / 5, 12);
    });

    it("the same data reads differently in different time zones (UTC vs Kolkata)", async () => {
      // 20:00Z on the 23rd: 20:00 UTC (eaten on the 23rd, after noon) but 01:30 on the 24th in Kolkata (a day late).
      await addPlan(me, "2026-10-23", "2026-10-23T20:00:00Z");
      const utc = await report({ tz: "UTC", days: "7" });
      const kol = await report({ tz: "Asia/Kolkata", days: "7" });
      expect(utc.daily.find((d: Json) => d.date === "2026-10-23")).toMatchObject({ planned: true, eaten: true, beforeNoon: false });
      expect(kol.daily.find((d: Json) => d.date === "2026-10-23")).toMatchObject({ planned: true, eaten: false });
    });

    it("a completed frog in the trash still counts (matches /api/today); a hard-deleted frog is a plan without a frog", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z", {}, { deletedAt: "2026-10-23T18:00:00Z" });
      const gone = await addPlan(me, "2026-10-22", "2026-10-22T14:00:00Z");
      await db.task.delete({ where: { id: gone.frogTask!.id } });
      expect((await db.dailyPlan.findUnique({ where: { id: gone.plan.id } }))!.frogTaskId).toBeNull();
      const r = await report();
      expect(r.stats).toMatchObject({ plannedDays: 1, eatenDays: 1, current: 1 });
      expect(r.daily.find((d: Json) => d.date === "2026-10-22")).toMatchObject({ planned: false, eaten: false });
    });

    it("an archived eaten frog still counts as eaten; an archived uneaten frog still counts as planned", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z", {}, { archivedAt: "2026-10-24T09:00:00Z" });
      await addPlan(me, "2026-10-22", null, {}, { archivedAt: "2026-10-24T09:00:00Z" });
      const r = await report();
      expect(r.stats).toMatchObject({ plannedDays: 2, eatenDays: 1 });
    });
  });

  // ───────────────── noon edges and DST in several time zones ─────────────────

  describe("eaten / before-noon in local time (noon edges, midnight edges, DST days)", () => {
    interface Case {
      date: string;
      at: string;
      eaten: boolean;
      bn: boolean;
    }
    const table: { name: string; tz: string; today: string; cases: Case[] }[] = [
      {
        name: "America/New_York in EDT (UTC-4)",
        tz: "America/New_York",
        today: "2026-10-26",
        cases: [
          { date: "2026-10-20", at: "2026-10-20T15:59:00Z", eaten: true, bn: true }, // 11:59
          { date: "2026-10-21", at: "2026-10-21T16:00:00Z", eaten: true, bn: false }, // 12:00
          { date: "2026-10-22", at: "2026-10-23T03:59:00Z", eaten: true, bn: false }, // 23:59 on the 22nd (UTC says the 23rd)
          { date: "2026-10-23", at: "2026-10-23T04:00:00Z", eaten: true, bn: true }, // 00:00 on the 23rd
          { date: "2026-10-19", at: "2026-10-20T04:00:00Z", eaten: false, bn: false }, // 00:00 on the 20th: a day late
          { date: "2026-10-18", at: "2026-10-19T03:59:00Z", eaten: true, bn: false }, // 23:59 on the 18th
        ],
      },
      {
        name: "Pacific/Auckland in NZDT (UTC+13)",
        tz: "Pacific/Auckland",
        today: "2026-10-26",
        cases: [
          { date: "2026-10-20", at: "2026-10-19T22:59:00Z", eaten: true, bn: true }, // 11:59 on the 20th (UTC says the 19th)
          { date: "2026-10-21", at: "2026-10-20T23:00:00Z", eaten: true, bn: false }, // 12:00 on the 21st
          { date: "2026-10-22", at: "2026-10-22T10:59:00Z", eaten: true, bn: false }, // 23:59
          { date: "2026-10-23", at: "2026-10-23T11:00:00Z", eaten: false, bn: false }, // 00:00 on the 24th
          { date: "2026-10-19", at: "2026-10-18T11:00:00Z", eaten: true, bn: true }, // 00:00 on the 19th
          { date: "2026-10-18", at: "2026-10-17T10:59:00Z", eaten: true, bn: false }, // 23:59 on the 17th: the day BEFORE the plan
        ],
      },
      {
        name: "Asia/Kolkata (UTC+5:30)",
        tz: "Asia/Kolkata",
        today: "2026-10-26",
        cases: [
          { date: "2026-10-20", at: "2026-10-20T06:29:00Z", eaten: true, bn: true }, // 11:59
          { date: "2026-10-21", at: "2026-10-21T06:30:00Z", eaten: true, bn: false }, // 12:00
          { date: "2026-10-22", at: "2026-10-22T18:29:00Z", eaten: true, bn: false }, // 23:59
          { date: "2026-10-23", at: "2026-10-22T18:30:00Z", eaten: true, bn: true }, // 00:00 on the 23rd (UTC says the 22nd)
          { date: "2026-10-19", at: "2026-10-19T18:30:00Z", eaten: false, bn: false }, // 00:00 on the 20th
        ],
      },
      {
        name: "America/New_York spring forward (2026-03-08, EST→EDT)",
        tz: "America/New_York",
        today: "2026-03-12",
        cases: [
          { date: "2026-03-06", at: "2026-03-06T17:00:00Z", eaten: true, bn: false }, // 12:00 EST
          { date: "2026-03-07", at: "2026-03-07T16:59:00Z", eaten: true, bn: true }, // 11:59 EST
          { date: "2026-03-08", at: "2026-03-08T16:00:00Z", eaten: true, bn: false }, // 12:00 EDT (a fixed -5 would say 11:00)
          { date: "2026-03-09", at: "2026-03-09T15:59:00Z", eaten: true, bn: true }, // 11:59 EDT
          { date: "2026-03-10", at: "2026-03-10T16:00:00Z", eaten: true, bn: false }, // 12:00 EDT
          { date: "2026-03-05", at: "2026-03-06T04:59:00Z", eaten: true, bn: false }, // 23:59 EST on the 5th
          { date: "2026-03-04", at: "2026-03-05T05:00:00Z", eaten: false, bn: false }, // 00:00 EST on the 5th
        ],
      },
      {
        name: "America/New_York fall back (2026-11-01, EDT→EST)",
        tz: "America/New_York",
        today: "2026-11-05",
        cases: [
          { date: "2026-10-31", at: "2026-10-31T16:00:00Z", eaten: true, bn: false }, // 12:00 EDT
          { date: "2026-11-01", at: "2026-11-01T16:59:00Z", eaten: true, bn: true }, // 11:59 EST (a fixed -4 would say 12:59)
          { date: "2026-11-02", at: "2026-11-02T17:00:00Z", eaten: true, bn: false }, // 12:00 EST
          { date: "2026-11-03", at: "2026-11-03T16:59:00Z", eaten: true, bn: true }, // 11:59 EST
          { date: "2026-10-30", at: "2026-10-31T03:59:00Z", eaten: true, bn: false }, // 23:59 EDT on the 30th
          { date: "2026-10-29", at: "2026-10-30T04:00:00Z", eaten: false, bn: false }, // 00:00 EDT on the 30th
        ],
      },
      {
        name: "Pacific/Auckland spring forward (2026-09-27, NZST→NZDT)",
        tz: "Pacific/Auckland",
        today: "2026-10-02",
        cases: [
          { date: "2026-09-26", at: "2026-09-26T00:00:00Z", eaten: true, bn: false }, // 12:00 NZST
          { date: "2026-09-27", at: "2026-09-26T22:59:00Z", eaten: true, bn: true }, // 11:59 NZDT
          { date: "2026-09-28", at: "2026-09-27T23:00:00Z", eaten: true, bn: false }, // 12:00 NZDT
          { date: "2026-09-25", at: "2026-09-25T11:59:00Z", eaten: true, bn: false }, // 23:59 NZST
        ],
      },
      {
        name: "Pacific/Auckland fall back (2027-04-04, NZDT→NZST)",
        tz: "Pacific/Auckland",
        today: "2027-04-08",
        cases: [
          { date: "2027-04-03", at: "2027-04-02T23:00:00Z", eaten: true, bn: false }, // 12:00 NZDT
          { date: "2027-04-04", at: "2027-04-03T23:59:00Z", eaten: true, bn: true }, // 11:59 NZST
          { date: "2027-04-05", at: "2027-04-05T00:00:00Z", eaten: true, bn: false }, // 12:00 NZST
          { date: "2027-04-02", at: "2027-04-02T11:00:00Z", eaten: false, bn: false }, // 00:00 NZDT on the 3rd
        ],
      },
      {
        name: "UTC",
        tz: "UTC",
        today: "2026-10-26",
        cases: [
          { date: "2026-10-20", at: "2026-10-20T11:59:59Z", eaten: true, bn: true },
          { date: "2026-10-21", at: "2026-10-21T12:00:00Z", eaten: true, bn: false },
          { date: "2026-10-22", at: "2026-10-22T23:59:59Z", eaten: true, bn: false },
          { date: "2026-10-23", at: "2026-10-24T00:00:00Z", eaten: false, bn: false },
        ],
      },
    ];

    it.each(table)("$name", async ({ tz, today, cases }) => {
      for (const c of cases) await addPlan(me, c.date, c.at);
      const r = await report({ tz, today, days: "30" });
      for (const c of cases) {
        const d = r.daily.find((x: Json) => x.date === c.date);
        expect(d, `${c.date} @ ${c.at}`).toEqual({ date: c.date, planned: true, eaten: c.eaten, beforeNoon: c.bn });
      }
      const eaten = cases.filter((c) => c.eaten).length;
      const bn = cases.filter((c) => c.bn).length;
      expect(r.stats.plannedDays).toBe(cases.length);
      expect(r.stats.eatenDays).toBe(eaten);
      expect(r.stats.eatenRate).toBeCloseTo(eaten / cases.length, 12);
      expect(r.stats.beforeNoonRate).toBeCloseTo(bn / eaten, 12);
    });

    it("the same instant lands on different plan days in different zones", async () => {
      // 2026-10-24T03:30:00Z is 23:30 on the 23rd in New York but 16:30 on the 24th in Auckland (UTC+13).
      await addPlan(me, "2026-10-23", "2026-10-24T03:30:00Z");
      const ny = await report({ tz: "America/New_York", days: "7" });
      const nz = await report({ tz: "Pacific/Auckland", days: "7" });
      expect(ny.daily.find((d: Json) => d.date === "2026-10-23")).toMatchObject({ eaten: true, beforeNoon: false });
      expect(nz.daily.find((d: Json) => d.date === "2026-10-23")).toMatchObject({ eaten: false });
    });
  });

  // ───────────────────────────── daily[] ─────────────────────────────

  describe("daily[]", () => {
    it.each([7, 30, 90, 365])("days=%i: exactly that many entries, consecutive, oldest first, ending today", async (n) => {
      const r = await report({ days: String(n) });
      expect(r.daily).toHaveLength(n);
      expect(r.daily[0].date).toBe(shift(TODAY, -(n - 1)));
      expect(r.daily[n - 1].date).toBe(TODAY);
      for (let i = 1; i < n; i++) expect(r.daily[i].date).toBe(shift(r.daily[i - 1].date, 1));
      expect(new Set(r.daily.map((d: Json) => d.date)).size).toBe(n);
    });

    it("days=all with no plans is the last 7 days", async () => {
      const r = await report({ days: "all" });
      expect(r.daily).toHaveLength(7);
      expect(r.daily[0].date).toBe("2026-10-18");
    });

    it("days=all starts at the earliest plan on/before today", async () => {
      await addPlan(me, shift(TODAY, -100), `${shift(TODAY, -100)}T14:00:00Z`);
      await addPlan(me, "2026-10-23", null);
      const r = await report({ days: "all" });
      expect(r.daily).toHaveLength(101);
      expect(r.daily[0]).toEqual({ date: shift(TODAY, -100), planned: true, eaten: true, beforeNoon: true });
    });

    it("days=all is at least 7 days: earliest plan today, 3 days ago, or exactly 7 days → 7/7/7 entries", async () => {
      await addPlan(me, TODAY, null);
      expect((await report({ days: "all" })).daily).toHaveLength(7);
      await addPlan(me, shift(TODAY, -3), null);
      expect((await report({ days: "all" })).daily).toHaveLength(7);
      await addPlan(me, shift(TODAY, -6), null);
      expect((await report({ days: "all" })).daily).toHaveLength(7);
      await addPlan(me, shift(TODAY, -7), null);
      expect((await report({ days: "all" })).daily).toHaveLength(8);
    });

    it("days=all is capped at 400 days, but stats still cover all plans", async () => {
      await addPlan(me, shift(TODAY, -399), `${shift(TODAY, -399)}T14:00:00Z`);
      expect((await report({ days: "all" })).daily).toHaveLength(400);
      await addPlan(me, shift(TODAY, -400), `${shift(TODAY, -400)}T14:00:00Z`);
      await addPlan(me, shift(TODAY, -900), `${shift(TODAY, -900)}T14:00:00Z`);
      const r = await report({ days: "all" });
      expect(r.daily).toHaveLength(400);
      expect(r.daily[0].date).toBe(shift(TODAY, -399));
      expect(r.daily[0].planned).toBe(true);
      expect(r.stats.plannedDays).toBe(3);
      expect(r.stats.eatenDays).toBe(3);
    });

    it("days=all ignores future plans when picking the start, and the strip never extends past today", async () => {
      await addPlan(me, "2026-12-25", "2026-12-25T14:00:00Z");
      const r = await report({ days: "all" });
      expect(r.daily).toHaveLength(7);
      expect(r.daily[r.daily.length - 1].date).toBe(TODAY);
    });

    it("year boundary: today 2027-01-02, days=7 → 2026-12-27 .. 2027-01-02", async () => {
      const r = await report({ today: "2027-01-02", days: "7" });
      expect(r.daily.map((d: Json) => d.date)).toEqual(["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    });

    it("leap day: today 2028-03-02, days=7 includes 2028-02-29; today 2027-03-02 skips straight from 02-28 to 03-01", async () => {
      expect((await report({ today: "2028-03-02", days: "7" })).daily.map((d: Json) => d.date)).toEqual([
        "2028-02-25", "2028-02-26", "2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02",
      ]);
      expect((await report({ today: "2027-03-02", days: "7" })).daily.map((d: Json) => d.date)).toEqual([
        "2027-02-24", "2027-02-25", "2027-02-26", "2027-02-27", "2027-02-28", "2027-03-01", "2027-03-02",
      ]);
    });

    it("365 days across a leap year and a non-leap year start on the right day", async () => {
      // 2028 is a leap year: 365 days ending 2028-12-31 start on 2028-01-02.
      const a = await report({ today: "2028-12-31", days: "365" });
      expect(a.daily[0].date).toBe("2028-01-02");
      expect(a.daily).toHaveLength(365);
      // 365 days ending 2028-03-01 reach back to 2027-03-03 (2028-02-29 is in between).
      const b = await report({ today: "2028-03-01", days: "365" });
      expect(b.daily[0].date).toBe("2027-03-03");
      // ending 2027-02-28 → starts 2026-03-01.
      const c = await report({ today: "2027-02-28", days: "365" });
      expect(c.daily[0].date).toBe("2026-03-01");
      expect(new Set(c.daily.map((d: Json) => d.date)).size).toBe(365);
    });

    it("no entry is missing or doubled over a DST change (fall-back day 2026-11-01 in New York)", async () => {
      const r = await report({ today: "2026-11-05", days: "7", tz: "America/New_York" });
      expect(r.daily.map((d: Json) => d.date)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    });

    it("every entry has exactly the four documented keys with boolean flags, and flags are consistent", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z");
      await addPlan(me, "2026-10-22", null);
      const r = await report();
      for (const d of r.daily) {
        expect(Object.keys(d).sort()).toEqual(["beforeNoon", "date", "eaten", "planned"]);
        expect(typeof d.planned).toBe("boolean");
        if (d.beforeNoon) expect(d.eaten).toBe(true);
        if (d.eaten) expect(d.planned).toBe(true);
      }
    });

    it("plans before the window are not in the strip; a plan with no frog is an empty cell", async () => {
      await addPlan(me, shift(TODAY, -40), `${shift(TODAY, -40)}T14:00:00Z`);
      await addPlan(me, shift(TODAY, -2), false, { reviewedAt: REVIEWED, rating: 3 });
      const r = await report({ days: "30" });
      expect(r.daily.some((d: Json) => d.planned)).toBe(false);
      expect(r.stats.plannedDays).toBe(0);
    });
  });

  // ───────────────────────────── abcdeCompleted ─────────────────────────────

  describe("abcdeCompleted", () => {
    // NY, EDT: 23:30 local on the 24th = 03:30Z on the 25th.
    it("buckets by letter, with null → none; archived counted; deleted, subtasks and open tasks excluded", async () => {
      await addTask(me, { abcde: "A", completedAt: "2026-10-23T14:00:00Z" });
      await addTask(me, { abcde: "A", completedAt: "2026-10-22T14:00:00Z" });
      await addTask(me, { abcde: "A", completedAt: "2026-10-22T15:00:00Z", archivedAt: "2026-10-23T09:00:00Z" }); // archived: counted
      await addTask(me, { abcde: "B", completedAt: "2026-10-21T14:00:00Z" });
      await addTask(me, { abcde: "C", completedAt: "2026-10-21T14:00:00Z" });
      await addTask(me, { abcde: "D", completedAt: "2026-10-20T14:00:00Z" });
      await addTask(me, { abcde: "E", completedAt: "2026-10-20T14:00:00Z" });
      await addTask(me, { abcde: "E", completedAt: "2026-10-20T15:00:00Z" });
      await addTask(me, { abcde: "E", completedAt: "2026-10-20T16:00:00Z" });
      await addTask(me, { abcde: null, completedAt: "2026-10-23T10:00:00Z" });
      await addTask(me, { abcde: null, completedAt: "2026-10-23T11:00:00Z" });
      await addTask(me, { abcde: "A", completedAt: "2026-10-23T12:00:00Z", deletedAt: "2026-10-23T13:00:00Z" }); // trashed: excluded
      const parent = await addTask(me, { abcde: "A", completedAt: "2026-10-23T12:00:00Z" }); // counted (A:4)
      await addTask(me, { abcde: "A", completedAt: "2026-10-23T12:30:00Z", parentTaskId: parent.id }); // subtask: excluded
      await addTask(me, { abcde: "B", completedAt: null }); // open: excluded
      const r = await report({ days: "7" });
      expect(r.abcdeCompleted).toEqual({ A: 4, B: 1, C: 1, D: 1, E: 3, none: 2 });
    });

    it("frog tasks are tasks too: an eaten frog counts in its letter bucket", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z", {}, { abcde: "A" });
      expect((await report()).abcdeCompleted).toEqual({ ...zeroCounts, A: 1 });
    });

    it("the range is the user's LOCAL days: 00:30 on the first day is in, 23:30 the day before is out; 23:30 today is in, 00:30 tomorrow is out", async () => {
      // days=7, today 2026-10-24 → local days 18th..24th in New York (EDT)
      await addTask(me, { abcde: "A", completedAt: "2026-10-25T03:30:00Z" }); // 23:30 on the 24th: in (UTC date is the 25th)
      await addTask(me, { abcde: "B", completedAt: "2026-10-25T04:30:00Z" }); // 00:30 on the 25th: out
      await addTask(me, { abcde: "C", completedAt: "2026-10-18T04:30:00Z" }); // 00:30 on the 18th: in
      await addTask(me, { abcde: "D", completedAt: "2026-10-18T03:30:00Z" }); // 23:30 on the 17th: out (UTC date is the 18th)
      const r = await report({ days: "7" });
      expect(r.abcdeCompleted).toEqual({ ...zeroCounts, A: 1, C: 1 });
    });

    it("the same boundaries hold east of UTC (Pacific/Auckland, NZDT +13)", async () => {
      // today 2026-10-24, days=7 → 18th..24th local
      await addTask(me, { abcde: "A", completedAt: "2026-10-24T10:59:00Z" }); // 23:59 on the 24th: in
      await addTask(me, { abcde: "B", completedAt: "2026-10-24T11:00:00Z" }); // 00:00 on the 25th: out
      await addTask(me, { abcde: "C", completedAt: "2026-10-17T11:00:00Z" }); // 00:00 on the 18th: in (UTC date is the 17th)
      await addTask(me, { abcde: "D", completedAt: "2026-10-17T10:59:00Z" }); // 23:59 on the 17th: out
      const r = await report({ days: "7", tz: "Pacific/Auckland" });
      expect(r.abcdeCompleted).toEqual({ ...zeroCounts, A: 1, C: 1 });
    });

    it("the extreme zones (UTC+14 Kiritimati, UTC-12 Etc/GMT+12) keep their first and last local minute: the coarse DB window never clips a real local day", async () => {
      // Kiritimati is UTC+14: local 00:00 on the 18th = 2026-10-17T10:00Z; local 23:59 on the 24th = 2026-10-24T09:59Z.
      await addTask(me, { abcde: "A", completedAt: "2026-10-17T10:00:00Z" }); // in (first minute of the 18th)
      await addTask(me, { abcde: "B", completedAt: "2026-10-24T09:59:00Z" }); // in (last minute of the 24th)
      await addTask(me, { abcde: "C", completedAt: "2026-10-17T09:59:00Z" }); // out (23:59 on the 17th)
      await addTask(me, { abcde: "D", completedAt: "2026-10-24T10:00:00Z" }); // out (00:00 on the 25th)
      expect((await report({ days: "7", tz: "Pacific/Kiritimati" })).abcdeCompleted).toEqual({ ...zeroCounts, A: 1, B: 1 });
      // Etc/GMT+12 is UTC-12: local 00:00 on the 18th = 2026-10-18T12:00Z; local 23:59 on the 24th = 2026-10-25T11:59Z.
      await db.task.deleteMany({});
      await addTask(me, { abcde: "A", completedAt: "2026-10-18T12:00:00Z" }); // in
      await addTask(me, { abcde: "B", completedAt: "2026-10-25T11:59:00Z" }); // in
      await addTask(me, { abcde: "C", completedAt: "2026-10-18T11:59:00Z" }); // out
      await addTask(me, { abcde: "D", completedAt: "2026-10-25T12:00:00Z" }); // out
      expect((await report({ days: "7", tz: "Etc/GMT+12" })).abcdeCompleted).toEqual({ ...zeroCounts, A: 1, B: 1 });
    });

    it("tasks outside the range are excluded for 7, 30, 90 and 365, and counted in the wider ones", async () => {
      const at = (daysAgo: number) => `${shift(TODAY, -daysAgo)}T14:00:00Z`;
      await addTask(me, { abcde: "A", completedAt: at(3) });
      await addTask(me, { abcde: "B", completedAt: at(20) });
      await addTask(me, { abcde: "C", completedAt: at(60) });
      await addTask(me, { abcde: "D", completedAt: at(200) });
      await addTask(me, { abcde: "E", completedAt: at(700) });
      expect((await report({ days: "7" })).abcdeCompleted).toEqual({ ...zeroCounts, A: 1 });
      expect((await report({ days: "30" })).abcdeCompleted).toEqual({ ...zeroCounts, A: 1, B: 1 });
      expect((await report({ days: "90" })).abcdeCompleted).toEqual({ ...zeroCounts, A: 1, B: 1, C: 1 });
      expect((await report({ days: "365" })).abcdeCompleted).toEqual({ ...zeroCounts, A: 1, B: 1, C: 1, D: 1 });
      expect((await report({ days: "all" })).abcdeCompleted).toEqual({ A: 1, B: 1, C: 1, D: 1, E: 1, none: 0 });
    });

    it("days=all has no lower bound, even beyond the 400-day strip cap; tasks completed after today are still excluded", async () => {
      await addTask(me, { abcde: "A", completedAt: `${shift(TODAY, -2000)}T14:00:00Z` });
      await addTask(me, { abcde: "B", completedAt: "2026-10-26T14:00:00Z" }); // after today
      await addTask(me, { abcde: "C", completedAt: "2035-01-01T14:00:00Z" }); // far future
      const r = await report({ days: "all" });
      expect(r.abcdeCompleted).toEqual({ ...zeroCounts, A: 1 });
    });

    it("window edge: days=30 → includes today-29 and excludes today-30", async () => {
      await addTask(me, { abcde: "A", completedAt: `${shift(TODAY, -29)}T14:00:00Z` });
      await addTask(me, { abcde: "B", completedAt: `${shift(TODAY, -30)}T14:00:00Z` });
      expect((await report({ days: "30" })).abcdeCompleted).toEqual({ ...zeroCounts, A: 1 });
    });

    it("tasks of a project with excludeFromReports are not counted", async () => {
      const hidden = await seedUser("owner-1", { groupName: "Hidden", excludeFromReports: true });
      await addTask(hidden, { abcde: "A", completedAt: "2026-10-23T14:00:00Z" });
      await addTask(me, { abcde: "B", completedAt: "2026-10-23T14:00:00Z" });
      expect((await report()).abcdeCompleted).toEqual({ ...zeroCounts, B: 1 });
    });

    it("when every project is excluded the counts are all zero (no crash on an empty group list)", async () => {
      await db.group.updateMany({ where: { ownerId: "owner-1" }, data: { excludeFromReports: true } });
      await addTask(me, { abcde: "A", completedAt: "2026-10-23T14:00:00Z" });
      const r = await report();
      expect(r.abcdeCompleted).toEqual(zeroCounts);
    });

    it("every project of the user counts (several groups)", async () => {
      const second = await seedUser("owner-1", { groupName: "Second" });
      await addTask(second, { abcde: "D", completedAt: "2026-10-23T14:00:00Z" });
      await addTask(me, { abcde: "D", completedAt: "2026-10-23T14:00:00Z" });
      expect((await report()).abcdeCompleted.D).toBe(2);
    });
  });

  // ───────────────────────────── reflections ─────────────────────────────

  describe("reflections", () => {
    it("only reviewed plans on or before today with a rating or non-blank text, newest first", async () => {
      await addPlan(me, "2026-10-20", false, { reviewedAt: REVIEWED, wentWell: "w20" });
      await addPlan(me, "2026-10-23", false, { reviewedAt: REVIEWED, rating: 2 }); // rating only
      await addPlan(me, "2026-10-22", false, { reviewedAt: REVIEWED, improve: "i22" }); // improve only
      await addPlan(me, "2026-10-21", false, { reviewedAt: REVIEWED }); // reviewed, nothing written: out
      await addPlan(me, "2026-10-19", false, { wentWell: "unreviewed" }); // never reviewed: out
      await addPlan(me, "2026-10-18", false, { reviewedAt: REVIEWED, wentWell: "   ", improve: "\n\t" }); // whitespace only: out
      await addPlan(me, "2026-10-25", false, { reviewedAt: REVIEWED, wentWell: "future" }); // after today: out
      const r = await report();
      expect(r.reflections.map((x: Json) => x.date)).toEqual(["2026-10-23", "2026-10-22", "2026-10-20"]);
      expect(r.reflections[0]).toEqual({ date: "2026-10-23", rating: 2, wentWell: null, improve: null, frogTitle: null, eaten: false });
      expect(r.reflections[1]).toMatchObject({ rating: null, wentWell: null, improve: "i22" });
      expect(r.reflections[2]).toMatchObject({ rating: null, wentWell: "w20", improve: null });
    });

    it("blank text next to a rating comes back as null, not as the blank string", async () => {
      await addPlan(me, "2026-10-23", false, { reviewedAt: REVIEWED, rating: 5, wentWell: "   ", improve: "kept" });
      const r = await report();
      expect(r.reflections[0]).toMatchObject({ rating: 5, wentWell: null, improve: "kept" });
    });

    it("is limited to 30, newest first: 35 candidates → the newest 30; exactly 30 → 30; 31 → 30", async () => {
      for (let k = 0; k < 35; k++) await addPlan(me, shift(TODAY, -k), false, { reviewedAt: REVIEWED, rating: (k % 5) + 1, wentWell: `day-${k}` });
      const r = await report({ days: "7" });
      expect(r.reflections).toHaveLength(30);
      expect(r.reflections[0].date).toBe(TODAY);
      expect(r.reflections[29].date).toBe(shift(TODAY, -29));
      expect(r.reflections.map((x: Json) => x.wentWell)).toEqual(Array.from({ length: 30 }, (_, k) => `day-${k}`));
      // Not tied to the range: days=7 shows the same 30
      expect((await report({ days: "all" })).reflections).toHaveLength(30);
    });

    it("exactly 30 and exactly 31 candidates", async () => {
      for (let k = 0; k < 30; k++) await addPlan(me, shift(TODAY, -k), false, { reviewedAt: REVIEWED, rating: 3 });
      expect((await report()).reflections).toHaveLength(30);
      await addPlan(me, shift(TODAY, -30), false, { reviewedAt: REVIEWED, rating: 3 });
      const r = await report();
      expect(r.reflections).toHaveLength(30);
      expect(r.reflections.map((x: Json) => x.date)).not.toContain(shift(TODAY, -30));
    });

    it("frogTitle and eaten reflect the day's frog; a day with no frog has null title and eaten=false", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z", { reviewedAt: REVIEWED, rating: 5 }, { title: "Eaten frog" });
      await addPlan(me, "2026-10-22", null, { reviewedAt: REVIEWED, rating: 2 }, { title: "Open frog" });
      await addPlan(me, "2026-10-21", "2026-10-22T14:00:00Z", { reviewedAt: REVIEWED, rating: 3 }, { title: "Late frog" }); // done a day late
      await addPlan(me, "2026-10-20", false, { reviewedAt: REVIEWED, rating: 4 }); // reviewed day, no frog
      const r = await report();
      expect(r.reflections).toEqual([
        { date: "2026-10-23", rating: 5, wentWell: null, improve: null, frogTitle: "Eaten frog", eaten: true },
        { date: "2026-10-22", rating: 2, wentWell: null, improve: null, frogTitle: "Open frog", eaten: false },
        { date: "2026-10-21", rating: 3, wentWell: null, improve: null, frogTitle: "Late frog", eaten: false },
        { date: "2026-10-20", rating: 4, wentWell: null, improve: null, frogTitle: null, eaten: false },
      ]);
      // and the strip for that no-frog reviewed day is an empty cell
      expect(r.daily.find((d: Json) => d.date === "2026-10-20")).toMatchObject({ planned: false });
    });

    it("a reviewed plan with a rating but no frog does not count as planned or in any streak", async () => {
      await addPlan(me, "2026-10-23", false, { reviewedAt: REVIEWED, rating: 5, wentWell: "ok" });
      const r = await report();
      expect(r.stats).toMatchObject({ plannedDays: 0, current: 0, longest: 0 });
      expect(r.reflections).toHaveLength(1);
    });

    it("a trashed frog keeps its title in the journal; an archived eaten frog is eaten", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z", { reviewedAt: REVIEWED, rating: 5 }, { title: "Trashed", deletedAt: "2026-10-24T08:00:00Z" });
      await addPlan(me, "2026-10-22", "2026-10-22T14:00:00Z", { reviewedAt: REVIEWED, rating: 5 }, { title: "Archived", archivedAt: "2026-10-23T08:00:00Z" });
      const r = await report();
      expect(r.reflections[0]).toMatchObject({ frogTitle: "Trashed", eaten: true });
      expect(r.reflections[1]).toMatchObject({ frogTitle: "Archived", eaten: true });
    });

    it("long and multi-line text is returned verbatim (not trimmed in the middle, not truncated)", async () => {
      const long = "word ".repeat(380).trim() + "\nsecond line\n\nthird";
      await addPlan(me, "2026-10-23", false, { reviewedAt: REVIEWED, wentWell: long });
      expect((await report()).reflections[0].wentWell).toBe(long);
    });

    it("unicode and markup-looking text is returned as data", async () => {
      const text = "日本語 🐸 <script>alert(1)</script> & \"quotes\"";
      await addPlan(me, "2026-10-23", false, { reviewedAt: REVIEWED, improve: text });
      expect((await report()).reflections[0].improve).toBe(text);
    });

    it("future plans (after today) are not listed even when reviewed", async () => {
      await addPlan(me, "2026-10-26", false, { reviewedAt: REVIEWED, rating: 1 });
      expect((await report()).reflections).toEqual([]);
      // ...and become visible once 'today' moves on
      expect((await report({ today: "2026-10-27" })).reflections).toHaveLength(1);
    });

    it("a plan dated today and reviewed shows up", async () => {
      await addPlan(me, TODAY, null, { reviewedAt: REVIEWED, wentWell: "closed early" }, { title: "T" });
      expect((await report()).reflections[0]).toMatchObject({ date: TODAY, frogTitle: "T", eaten: false });
    });
  });

  // ───────────────────────────── excludeFromReports ─────────────────────────────

  describe("excludeFromReports", () => {
    it("a plan whose frog is in an excluded project still counts as a day (planned, eaten); only its title is blanked in the journal", async () => {
      const hidden = await seedUser("owner-1", { groupName: "Hidden", excludeFromReports: true });
      await addPlan(hidden, "2026-10-23", "2026-10-23T14:00:00Z", { reviewedAt: REVIEWED, rating: 4, wentWell: "private" }, { title: "HIDDEN-FROG" });
      await addPlan(me, "2026-10-22", "2026-10-22T14:00:00Z", {}, { title: "Visible" });
      const r = await report();
      expect(r.stats).toMatchObject({ plannedDays: 2, eatenDays: 2, current: 2, longest: 2 });
      expect(r.daily.find((d: Json) => d.date === "2026-10-23")).toMatchObject({ planned: true, eaten: true });
      expect(r.daily.find((d: Json) => d.date === "2026-10-22")).toMatchObject({ planned: true, eaten: true });
      expect(JSON.stringify(r)).not.toContain("HIDDEN-FROG");
      // The journal entry is shown and `eaten` stays correct; only the excluded project's task title is hidden.
      expect(r.reflections).toEqual([{ date: "2026-10-23", rating: 4, wentWell: "private", improve: null, frogTitle: null, eaten: true }]);
    });

    it("an uneaten frog in an excluded project is a planned, not-eaten day, and its title is still blanked", async () => {
      const hidden = await seedUser("owner-1", { groupName: "Hidden", excludeFromReports: true });
      await addPlan(hidden, "2026-10-23", null, { reviewedAt: REVIEWED, improve: "x" }, { title: "HIDDEN-OPEN" });
      const r = await report();
      expect(r.stats).toMatchObject({ plannedDays: 1, eatenDays: 0 });
      expect(r.daily.find((d: Json) => d.date === "2026-10-23")).toMatchObject({ planned: true, eaten: false });
      expect(r.reflections).toEqual([{ date: "2026-10-23", rating: null, wentWell: null, improve: "x", frogTitle: null, eaten: false }]);
      expect(JSON.stringify(r)).not.toContain("HIDDEN-OPEN");
    });

    it("excluded frogs do not break a streak: the report's streak equals /api/today's streak for the same data", async () => {
      const hidden = await seedUser("owner-1", { groupName: "Hidden", excludeFromReports: true });
      await addPlan(me, "2026-10-24", "2026-10-24T13:00:00Z");
      await addPlan(hidden, "2026-10-23", "2026-10-23T13:00:00Z");
      await addPlan(hidden, "2026-10-22", "2026-10-22T13:00:00Z");
      await addPlan(me, "2026-10-21", "2026-10-21T13:00:00Z");
      const rep = await report({ days: "30" });
      const today = await (await getToday("2026-10-24", NY)).json();
      expect(today.streak).toEqual({ current: 4, longest: 4 });
      expect(rep.stats.current).toBe(today.streak.current);
      expect(rep.stats.longest).toBe(today.streak.longest);
      expect(rep.stats.plannedDays).toBe(4);
    });

    it("with no exclusions the report streak equals /api/today's streak", async () => {
      for (const k of [0, 1, 2, 4, 5]) await addPlan(me, shift(TODAY, -k), `${shift(TODAY, -k)}T13:00:00Z`);
      const rep = await report();
      const today = await (await getToday(TODAY, NY)).json();
      expect(rep.stats.current).toBe(today.streak.current);
      expect(rep.stats.longest).toBe(today.streak.longest);
      expect(rep.stats.current).toBe(3);
      expect(rep.stats.longest).toBe(3);
    });

    it("toggling excludeFromReports on the frog's project leaves the frog stats alone and flips only abcdeCompleted", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T13:00:00Z");
      const shown = await report();
      expect(shown.stats).toMatchObject({ plannedDays: 1, eatenDays: 1 });
      expect(shown.abcdeCompleted.none).toBe(1);
      await db.group.update({ where: { id: me.groupId }, data: { excludeFromReports: true } });
      const hidden = await report();
      expect(hidden.stats).toEqual(shown.stats);
      expect(hidden.daily).toEqual(shown.daily);
      expect(hidden.abcdeCompleted).toEqual(zeroCounts);
      await db.group.update({ where: { id: me.groupId }, data: { excludeFromReports: false } });
      expect(await report()).toEqual(shown);
    });

    it("a frog moved between an excluded and a normal project keeps its day; only abcdeCompleted follows the project", async () => {
      const hidden = await seedUser("owner-1", { groupName: "Hidden", excludeFromReports: true });
      const { frogTask } = await addPlan(me, "2026-10-23", "2026-10-23T13:00:00Z");
      expect((await report()).stats.plannedDays).toBe(1);
      await db.task.update({ where: { id: frogTask!.id }, data: { groupId: hidden.groupId, statusId: hidden.doneStatusId } });
      const r = await report();
      expect(r.stats).toMatchObject({ plannedDays: 1, eatenDays: 1 });
      expect(r.abcdeCompleted).toEqual(zeroCounts);
    });
  });

  // ───────────────────────────── isolation between users ─────────────────────────────

  describe("another user's data", () => {
    async function seedStranger() {
      const s = await seedUser("stranger", { groupName: "SECRET-GROUP" });
      const hidden = await seedUser("stranger", { groupName: "SECRET-HIDDEN", excludeFromReports: true });
      for (let k = 0; k < 45; k++) {
        const date = shift(TODAY, -k);
        await addPlan(s, date, `${date}T13:00:00Z`, { reviewedAt: REVIEWED, rating: 5, wentWell: `SECRET-WENT-${k}`, improve: `SECRET-IMPROVE-${k}` }, { title: `SECRET-FROG-${k}`, abcde: "A" });
      }
      await addPlan(hidden, "2026-10-25", null, { reviewedAt: REVIEWED, rating: 1, wentWell: "SECRET-FUTURE" }, { title: "SECRET-HIDDEN-FROG" });
      for (let k = 0; k < 60; k++) await addTask(s, { title: `SECRET-T-${k}`, abcde: ["A", "B", "C", "D", "E"][k % 5], completedAt: `${shift(TODAY, -(k % 20))}T10:00:00Z` });
      for (let k = 0; k < 10; k++) await addTask(s, { title: `SECRET-N-${k}`, completedAt: `${shift(TODAY, -k)}T10:00:00Z` });
      return s;
    }

    it("a stranger's plans, tasks and reflections never change or appear in my report", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z", { reviewedAt: REVIEWED, rating: 3, wentWell: "mine" }, { title: "My frog", abcde: "B" });
      await addPlan(me, "2026-10-22", null);
      const before = await report({ days: "all" });
      const before30 = await report({ days: "30" });

      const stranger = await seedStranger();
      const after = await report({ days: "all" });
      const after30 = await report({ days: "30" });
      expect(after).toEqual(before);
      expect(after30).toEqual(before30);
      for (const r of [after, after30]) {
        const text = JSON.stringify(r);
        expect(text).not.toContain("SECRET");
        expect(text).not.toContain("stranger");
        expect(text).not.toContain(stranger.groupId);
      }
      expect(before.stats).toMatchObject({ plannedDays: 2, eatenDays: 1, current: 1, longest: 1 });
      expect(before.abcdeCompleted).toEqual({ ...zeroCounts, B: 1 });
      expect(before.reflections).toHaveLength(1);
    });

    it("with no data of my own I still see nothing (all zeros) while the stranger has lots", async () => {
      await seedStranger();
      const r = await report({ days: "all" });
      expect(r.stats).toEqual({ plannedDays: 0, eatenDays: 0, eatenRate: 0, beforeNoonRate: 0, current: 0, longest: 0 });
      expect(r.abcdeCompleted).toEqual(zeroCounts);
      expect(r.reflections).toEqual([]);
      expect(r.daily.every((d: Json) => !d.planned)).toBe(true);
    });

    it("the stranger sees their own data (so the checks above are not vacuous), and not mine", async () => {
      await addPlan(me, "2026-10-23", "2026-10-23T14:00:00Z", { reviewedAt: REVIEWED, wentWell: "MINE-ONLY" }, { title: "MY-FROG" });
      await seedStranger();
      signInAs("stranger");
      const r = await report({ days: "all" });
      expect(r.stats.plannedDays).toBe(45);
      expect(r.stats.eatenDays).toBe(45);
      expect(r.stats.current).toBe(45);
      expect(r.reflections).toHaveLength(30);
      expect(r.reflections[0].frogTitle).toBe("SECRET-FROG-0");
      // 60 lettered + 45 frogs (all A) + 10 none; the hidden project's data is not counted
      expect(r.abcdeCompleted).toEqual({ A: 12 + 45, B: 12, C: 12, D: 12, E: 12, none: 10 });
      const text = JSON.stringify(r);
      expect(text).not.toContain("MINE-ONLY");
      expect(text).not.toContain("MY-FROG");
      expect(text).not.toContain("SECRET-HIDDEN");
    });

    it("a plan of mine can't be pointed at a stranger's task to leak it (FK to a foreign task is not followed into titles)", async () => {
      // Direct DB write that the API would never allow: my plan's frog is a stranger's task in a stranger's project.
      const s = await seedUser("stranger", { groupName: "SECRET-GROUP" });
      const foreign = await addTask(s, { title: "SECRET-FOREIGN-FROG", completedAt: "2026-10-23T14:00:00Z" });
      await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-23", frogTaskId: foreign.id, reviewedAt: REVIEWED, rating: 3 } });
      const r = await report();
      expect(JSON.stringify(r)).not.toContain("SECRET");
      expect(r.reflections[0].frogTitle).toBeNull();
      expect(r.stats.plannedDays).toBe(0);
    });
  });

  // ───────────────────────────── scale ─────────────────────────────

  describe("performance and scale", () => {
    it("~400 plans and 2000 completed tasks: correct numbers, fast answer", { timeout: 60_000 }, async () => {
      const N_PLANS = 400;
      const N_TASKS = 2000;
      const letters = ["A", "B", "C", "D", "E", null] as const;
      const midday = (key: string, hour: number) => new Date(`${key}T${String(hour).padStart(2, "0")}:00:00Z`);

      const frogTasks = Array.from({ length: N_PLANS }, (_, k) => {
        const date = shift(TODAY, -k);
        return {
          id: `perf-frog-${k}`,
          title: `Frog ${k}`,
          groupId: me.groupId,
          statusId: k % 4 === 0 ? me.statusId : me.doneStatusId,
          priority: "MEDIUM" as const,
          order: 0,
          createdBy: "owner-1",
          completedAt: k % 4 === 0 ? null : midday(date, 9), // 9:00Z = 05:00 EDT: before noon
        };
      });
      const fillers = Array.from({ length: N_TASKS }, (_, i) => ({
        id: `perf-task-${i}`,
        title: `Task ${i}`,
        groupId: me.groupId,
        statusId: me.doneStatusId,
        priority: "MEDIUM" as const,
        order: 0,
        createdBy: "owner-1",
        abcde: letters[i % 6],
        completedAt: midday(shift(TODAY, -(i % 500)), 12),
      }));
      await db.task.createMany({ data: [...frogTasks, ...fillers] });
      await db.dailyPlan.createMany({
        data: frogTasks.map((t, k) => ({
          userId: "owner-1",
          date: shift(TODAY, -k),
          frogTaskId: t.id,
          reviewedAt: k < 40 ? REVIEWED : null,
          rating: k < 40 ? (k % 5) + 1 : null,
          wentWell: k < 40 ? `w${k}` : null,
        })),
      });

      const started = performance.now();
      const res = await call({ tz: "UTC", days: "all" });
      const elapsed = performance.now() - started;
      expect(res.status).toBe(200);
      const r = await res.json();
      expect(elapsed).toBeLessThan(5000);

      // k%4==0 are open (100), 300 eaten before noon. today (k=0) open → streak counts back from yesterday: k=1,2,3 then k=4 open.
      expect(r.stats.plannedDays).toBe(400);
      expect(r.stats.eatenDays).toBe(300);
      expect(r.stats.eatenRate).toBeCloseTo(0.75, 12);
      expect(r.stats.beforeNoonRate).toBe(1);
      expect(r.stats.current).toBe(3);
      expect(r.stats.longest).toBe(3);
      expect(r.daily).toHaveLength(400);
      expect(r.daily.filter((d: Json) => d.eaten)).toHaveLength(300);
      // 2000 fillers by letter (i % 6) + the 300 completed frogs (no letter)
      const per = (i: number) => Math.floor((N_TASKS - 1 - i) / 6) + 1;
      expect(r.abcdeCompleted).toEqual({ A: per(0), B: per(1), C: per(2), D: per(3), E: per(4), none: per(5) + 300 });
      expect(Object.values(r.abcdeCompleted).reduce((a: number, b) => a + (b as number), 0)).toBe(N_TASKS + 300);
      expect(r.reflections).toHaveLength(30);
      expect(r.reflections[0].date).toBe(TODAY);
      expect(r.reflections[0].eaten).toBe(false); // k=0 is the open one
      expect(r.reflections[1]).toMatchObject({ date: shift(TODAY, -1), eaten: true, frogTitle: "Frog 1" });

      // A 30-day window over the same data
      const r30 = await report({ tz: "UTC", days: "30" });
      expect(r30.stats.plannedDays).toBe(30);
      expect(r30.stats.eatenDays).toBe(22); // k = 0..29 minus k%4==0 (8 values)
      expect(r30.stats.current).toBe(3);
    });
  });
});

// ───────────────────────────── /api/reports is unchanged ─────────────────────────────

describe("GET /api/reports (existing endpoint) is unchanged by the Frog work", () => {
  beforeEach(() => {
    signInAs("owner-1");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const reports = (qs = "days=7") => getReports(new NextRequest(`http://localhost/api/reports?${qs}`));

  it("401 without a user", async () => {
    setFakeUser(null);
    expect((await reports()).status).toBe(401);
  });

  it("returns the same KPIs/series for a simple fixture and ignores daily plans entirely", async () => {
    const { group, statuses, tasks } = await seedGroup("owner-1", {
      groupName: "P",
      tasks: [
        { title: "T1", status: "Done", priority: "HIGH", completedAt: new Date("2026-10-23T10:00:00Z"), extra: { createdAt: new Date("2026-10-20T00:00:00Z") } },
        { title: "T2", status: "Done", priority: "LOW", completedAt: new Date("2026-10-10T10:00:00Z"), extra: { createdAt: new Date("2026-10-01T00:00:00Z") } },
        { title: "T3", priority: "MEDIUM", extra: { createdAt: new Date("2026-10-22T00:00:00Z") } },
        { title: "T4", status: "Done", priority: "HIGH", completedAt: new Date("2026-10-22T00:00:00Z"), archivedAt: new Date("2026-10-23T00:00:00Z"), extra: { createdAt: new Date("2026-10-21T00:00:00Z") } },
        { title: "Deleted", status: "Done", completedAt: new Date("2026-10-23T00:00:00Z"), deletedAt: new Date("2026-10-23T01:00:00Z") },
        { title: "Sub", parentTitle: "T1", status: "Done", completedAt: new Date("2026-10-23T00:00:00Z") },
      ],
    });
    await seedGroup("owner-1", { groupName: "Excluded", excludeFromReports: true, tasks: [{ title: "X", status: "Done", completedAt: new Date("2026-10-23T00:00:00Z") }] });
    await seedGroup("stranger", { groupName: "SECRET", tasks: [{ title: "SECRET", status: "Done", completedAt: new Date("2026-10-23T00:00:00Z") }] });

    const run = async () => {
      const res = await reports();
      expect(res.status).toBe(200);
      return res.json();
    };
    const first = await run();

    expect(Object.keys(first).sort()).toEqual(["byPriority", "byProject", "cfd", "completedTasks", "days", "groups", "kpis", "range", "recentActivity"]);
    expect(first.range).toEqual({ days: 7, start: "2026-10-18T00:00:00.000Z", end: "2026-10-24T12:00:00.000Z", bucketDays: 1 });
    expect(first.groups).toHaveLength(1);
    expect(first.groups[0].id).toBe(group.id);
    expect(first.kpis).toEqual({ throughput: 2, avgCycleTime: 2.2, wip: 1, completionRate: 75, createdInWindow: 3, totalTasks: 4 });
    expect(first.days).toHaveLength(7);
    expect(first.days.map((d: Json) => d.date)).toEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
    const completedByDay = Object.fromEntries(first.days.map((d: Json) => [d.date, d.completed]));
    expect(completedByDay["2026-10-23"]).toBe(1);
    expect(completedByDay["2026-10-22"]).toBe(1);
    expect(first.byPriority).toEqual([
      { priority: "URGENT", total: 0, done: 0 },
      { priority: "HIGH", total: 2, done: 2 },
      { priority: "MEDIUM", total: 1, done: 0 },
      { priority: "LOW", total: 1, done: 1 },
    ]);
    expect(first.byProject).toHaveLength(1);
    expect(first.byProject[0]).toMatchObject({ id: group.id, name: "P", total: 4, done: 3, wip: 1, completedInWindow: 2 });
    expect(first.completedTasks.map((t: Json) => t.title)).toEqual(["T1", "T4"]);
    expect(JSON.stringify(first)).not.toContain("SECRET");
    expect(statuses["Done"].id).toBeTruthy();
    expect(tasks["T1"].id).toBeTruthy();

    // Adding frog plans (eaten, reviewed, etc.) changes nothing about the old report.
    await db.dailyPlan.create({ data: { userId: "owner-1", date: "2026-10-23", frogTaskId: tasks["T1"].id, reviewedAt: new Date(), rating: 5, wentWell: "x" } });
    expect(await run()).toEqual(first);
  });

  it("the 'all' range and the groupId filter keep working", async () => {
    const { group } = await seedGroup("owner-1", {
      tasks: [{ title: "T1", status: "Done", completedAt: new Date("2026-10-23T10:00:00Z"), extra: { createdAt: new Date("2026-09-01T00:00:00Z") } }],
    });
    const all = await (await reports("days=all")).json();
    expect(all.range.start).toBe("2026-09-01T00:00:00.000Z");
    expect(all.kpis.totalTasks).toBe(1);
    const filtered = await (await reports(`days=7&groupId=${group.id}`)).json();
    expect(filtered.byProject).toHaveLength(1);
    const other = await (await reports("days=7&groupId=does-not-exist")).json();
    expect(other.kpis.totalTasks).toBe(0);
  });
});
