// Seeds the mobile harness user's data straight into the local `forma_test` DB
// (created by `bash scripts/test-db.sh`). The app finds rows by the Supabase
// user id: groups through `Group.ownerId`, everything else through `userId`
// (tasks belong to the user through their group).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

export const TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/forma_test";

/** Refuse to touch anything but a local *_test database (same rule as tests/integration/helpers.ts). */
function assertSafeTestDb(raw) {
  const url = new URL(raw);
  const name = url.pathname.replace(/^\//, "");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (!local || !name.endsWith("_test")) {
    throw new Error(`seed: refusing to write to "${name}" on "${url.hostname}"; only local *_test databases are allowed`);
  }
}

/** "YYYY-MM-DD" for `date` in `timeZone`. */
export function dateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Prisma stores DateTime as UTC in `timestamp without time zone` columns.
const ts = (d) => (d ? d.toISOString().replace("Z", "") : null);
const DAY = 24 * 3600 * 1000;

/**
 * Empties every table, then writes the fixture for `userId`. `timeZone` must
 * be the browser's zone, since "today" is the browser's local date.
 * Returns the ids the harness navigates to.
 */
export async function seed({ databaseUrl = TEST_DB_URL, userId, timeZone }) {
  assertSafeTestDb(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
    );
    if (rows.length === 0) throw new Error("seed: forma_test has no tables; run `bash scripts/test-db.sh` first");

    const now = new Date();
    const today = dateKey(now, timeZone);
    const yesterday = dateKey(new Date(now.getTime() - DAY), timeZone);
    const twoDaysAgo = dateKey(new Date(now.getTime() - 2 * DAY), timeZone);
    // A block at 10:00-11:30 "today" (UTC wall clock; the harness browser runs in UTC).
    const blockStart = new Date(`${today}T10:00:00.000Z`);

    const insert = async (table, row) => {
      const cols = Object.keys(row);
      const sql = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`;
      await client.query(sql, Object.values(row));
    };

    await client.query("BEGIN");
    const list = rows.map((r) => `"${r.tablename.replace(/"/g, '""')}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

    // ── Projects ───────────────────────────────────────────────────────────
    const groupId = "mc-group-launch";
    await insert("Group", { id: groupId, name: "Launch plan", color: "#F97316", ownerId: userId, order: 0 });
    await insert("Group", { id: "mc-group-home", name: "Home", color: "#7DBB8A", ownerId: userId, order: 1 });

    const statuses = [
      ["mc-st-todo", groupId, "To do", 0, false],
      ["mc-st-doing", groupId, "In progress", 1, false],
      ["mc-st-review", groupId, "Review", 2, false],
      ["mc-st-done", groupId, "Done", 3, true],
      ["mc-st-home-todo", "mc-group-home", "To do", 0, false],
      ["mc-st-home-done", "mc-group-home", "Done", 1, true],
    ];
    for (const [id, gid, name, order, celebrate] of statuses) {
      await insert("Status", { id, groupId: gid, name, order, celebrate });
    }

    // ── Tasks ──────────────────────────────────────────────────────────────
    let order = 0;
    const task = async (id, fields) => {
      await insert("Task", {
        id,
        groupId,
        statusId: "mc-st-todo",
        priority: "MEDIUM",
        order: order++,
        createdBy: userId,
        createdAt: ts(new Date(now.getTime() - 5 * DAY)),
        updatedAt: ts(now),
        ...fields,
      });
    };

    const frogId = "mc-task-frog";
    await task(frogId, {
      title: "Write the launch announcement",
      description: "Lead with the one thing people can do today. Keep it under 300 words.",
      priority: "HIGH",
      abcde: "A",
      abcdeRank: 1,
      plannedFor: today,
      dueDate: ts(new Date(`${today}T17:00:00.000Z`)),
    });
    await task("mc-task-signup-copy", {
      title: "Fix the signup email copy",
      statusId: "mc-st-doing",
      priority: "URGENT",
      abcde: "B",
      abcdeRank: 1,
      plannedFor: today,
    });
    await task("mc-task-pricing", { title: "Review the pricing page", statusId: "mc-st-review", abcde: "C", abcdeRank: 1, plannedFor: today });
    await task("mc-task-venue", { title: "Book a venue for the meetup", abcde: "D", abcdeRank: 1, plannedFor: today, priority: "LOW" });
    await task("mc-task-screens", { title: "Archive old screenshots", abcde: "E", abcdeRank: 1, plannedFor: today, priority: "LOW" });
    await task("mc-task-interviews", {
      title: "Plan user interviews",
      statusId: "mc-st-doing",
      abcde: "A",
      abcdeRank: 2,
      plannedFor: today,
      scheduledAt: ts(blockStart),
      blockMinutes: 90,
    });
    await task("mc-task-roadmap", {
      title: "Draft the Q4 roadmap with a deliberately long title that has to wrap on a narrow phone screen",
      dueDate: ts(new Date(now.getTime() + DAY)),
    });
    await task("mc-task-backlog", { title: "Collect feedback from the beta group" });
    await task("mc-task-onboarding", {
      title: "Ship the onboarding checklist",
      statusId: "mc-st-done",
      completedAt: ts(new Date(now.getTime() - DAY)),
    });
    await task("mc-task-analytics", {
      title: "Set up analytics",
      statusId: "mc-st-done",
      completedAt: ts(new Date(now.getTime() - 2 * DAY)),
    });
    await task("mc-sub-outline", { title: "Outline the key points", parentTaskId: frogId });
    await task("mc-sub-feedback", {
      title: "Get feedback from Sam",
      parentTaskId: frogId,
      statusId: "mc-st-done",
      completedAt: ts(new Date(now.getTime() - DAY)),
    });
    await insert("Task", {
      id: "mc-task-plants",
      groupId: "mc-group-home",
      statusId: "mc-st-home-todo",
      title: "Water the plants",
      order: 0,
      createdBy: userId,
      updatedAt: ts(now),
    });

    await insert("Comment", {
      id: "mc-comment-1",
      taskId: frogId,
      authorId: userId,
      body: "Draft is in the shared folder.",
      updatedAt: ts(now),
    });

    // ── Today's plan: the frog ───────────────────────────────────────────────
    await insert("DailyPlan", { id: "mc-plan-today", userId, date: today, frogTaskId: frogId, plannedAt: ts(now), updatedAt: ts(now) });
    await insert("DailyNote", { id: "mc-note-today", userId, date: today, body: "Call the bank before noon.", mood: 3, confidence: 2, updatedAt: ts(now) });

    // ── Habits ────────────────────────────────────────────────────────────
    await insert("Habit", { id: "mc-habit-read", userId, name: "Read 20 pages", order: 0 });
    await insert("Habit", { id: "mc-habit-walk", userId, name: "Walk 30 minutes", weekdays: [1, 2, 3, 4, 5], order: 1 });
    for (const [id, habitId, date] of [
      ["mc-check-1", "mc-habit-read", yesterday],
      ["mc-check-2", "mc-habit-read", twoDaysAgo],
      ["mc-check-3", "mc-habit-walk", yesterday],
    ]) {
      await insert("HabitCheck", { id, habitId, date });
    }

    // ── Focus sessions (reports, pomodoro) ────────────────────────────────
    for (const [id, daysAgo] of [["mc-focus-1", 1], ["mc-focus-2", 0]]) {
      const start = new Date(now.getTime() - daysAgo * DAY - 3 * 3600 * 1000);
      await insert("FocusSession", {
        id,
        userId,
        taskId: frogId,
        startedAt: ts(start),
        endedAt: ts(new Date(start.getTime() + 25 * 60 * 1000)),
        durationSec: 25 * 60,
        completed: true,
      });
    }

    await client.query("COMMIT");
    return { today, groupId, taskId: frogId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}
