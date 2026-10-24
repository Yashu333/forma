// Server-side only: reads the database. Client code must not import this file
// (use the pure helpers in today.ts instead).
import { db } from "@/lib/db";
import { openAtasks, compareTasks } from "./abcde";
import { completedOnLocalDate, utcWindowForLocalDate } from "./today";
import { evaluatePlan } from "./stats";
import { computeStreaks } from "./streak";

// What a Today payload needs to know about a task's project. `doneStatusId` is
// the first celebrate status by board order: where the "done" control moves a task.
const groupWithDoneStatus = {
  select: {
    id: true,
    name: true,
    color: true,
    statuses: { where: { celebrate: true }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 1, select: { id: true } },
  },
} as const;

type GroupRow = { id: string; name: string; color: string; statuses: { id: string }[] };

function withDoneStatus({ statuses, ...group }: GroupRow) {
  return { ...group, doneStatusId: statuses[0]?.id ?? null };
}

// A task the user can see on a board's top level: theirs, top-level, not in the
// trash, not archived.
export const visibleTopLevelTask = (userId: string) =>
  ({ parentTaskId: null, deletedAt: null, archivedAt: null, group: { ownerId: userId } }) as const;

/**
 * The payload of GET /api/today (also returned by PUT /api/today) for one local
 * day. Every query is scoped to `userId`: tasks through `group.ownerId`, plans
 * through `userId`. Assumes `date` and `tz` are already validated.
 *
 * - `tasks`: everything planned for `date`, done AND open (done ones keep their
 *   `completedAt`, so the list can show them checked off), sorted with compareTasks.
 * - `frog`: the plan's frog with its project and open subtasks. It is null when
 *   the plan has none or the task is in the trash. An archived frog is still
 *   returned: an eaten frog that was filed away is still today's frog.
 * - `completedToday`: every top-level task of the user (archived included) whose
 *   completedAt is on `date` in `tz`, oldest first.
 * - `streak`: from ALL the user's plans, so it isn't cut off at any window.
 */
export async function buildTodayPayload(userId: string, date: string, tz: string) {
  const window = utcWindowForLocalDate(date);

  const [plan, plannedTasks, completedRaw, allPlans] = await Promise.all([
    db.dailyPlan.findUnique({ where: { userId_date: { userId, date } } }),
    db.task.findMany({
      where: { ...visibleTopLevelTask(userId), plannedFor: date },
      include: { group: groupWithDoneStatus },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    }),
    window
      ? db.task.findMany({
          where: {
            parentTaskId: null,
            deletedAt: null,
            group: { ownerId: userId },
            completedAt: { gte: window.gte, lt: window.lt },
          },
          select: {
            id: true,
            title: true,
            abcde: true,
            abcdeRank: true,
            completedAt: true,
            group: { select: { id: true, name: true, color: true } },
          },
        })
      : Promise.resolve([]),
    db.dailyPlan.findMany({
      where: { userId },
      select: { date: true, frogTask: { select: { completedAt: true } } },
    }),
  ]);

  const tasks = plannedTasks
    .map((t: { group: GroupRow }) => ({ ...t, group: withDoneStatus(t.group) }))
    .sort(compareTasks);

  let frog = null;
  if (plan?.frogTaskId) {
    const row = await db.task.findFirst({
      where: { id: plan.frogTaskId, deletedAt: null, group: { ownerId: userId } },
      include: {
        group: groupWithDoneStatus,
        subtasks: { where: { deletedAt: null, archivedAt: null }, orderBy: { order: "asc" } },
      },
    });
    if (row) frog = { ...row, group: withDoneStatus(row.group) };
  }

  const streak = computeStreaks(
    allPlans.map((p: { date: string; frogTask: { completedAt: Date | null } | null }) => ({
      date: p.date,
      eaten: evaluatePlan(p, tz).eaten,
    })),
    date,
  );

  return {
    date,
    plan,
    frog,
    tasks,
    completedToday: completedOnLocalDate(completedRaw as { completedAt: Date }[], date, tz),
    openA: openAtasks(tasks).length,
    streak,
  };
}
