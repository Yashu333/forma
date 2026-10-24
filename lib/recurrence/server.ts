// Server-side only: writes to the database. Client code must not import this
// file (use the pure helpers in rule.ts instead).
import { localDateKey, localDateTimeToInstant, localTimeOfDay } from "@/lib/frog/dates";
import { nextOccurrence, parseRepeatRule } from "./rule";

/**
 * When a repeating top-level task is completed, creates its next instance:
 * same title, notes, priority, project and rule, due on the next occurrence at
 * the same local time of day, in the project's first open column, with fresh
 * copies of its open subtasks. Does nothing for a task that doesn't repeat, has
 * no due date, is a subtask, or already has a successor, so completing it twice
 * never makes two. Call inside the transaction that completes the task (`tx` is
 * the interactive transaction client). Returns the new task, or null.
 */
// `tx` is the Prisma transaction client; `db` is typed any in this codebase, so it is too.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function spawnNextInstance(tx: any, taskId: string, tz: string, userId: string, now: Date = new Date()) {
  const old = await tx.task.findUnique({
    where: { id: taskId },
    include: { subtasks: { where: { deletedAt: null, archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!old || old.deletedAt || old.parentTaskId || !old.dueDate || old.nextInstanceId) return null;
  const rule = parseRepeatRule(old.repeat);
  if (!rule) return null;

  const dueKey = localDateKey(old.dueDate, tz);
  const todayKey = localDateKey(now, tz);
  const nextKey = nextOccurrence(rule, dueKey, todayKey > dueKey ? todayKey : dueKey);
  const nextDue = localDateTimeToInstant(nextKey, localTimeOfDay(old.dueDate, tz), tz);

  const status = await tx.status.findFirst({
    where: { groupId: old.groupId, celebrate: false },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (!status) return null;
  const top = await tx.task.aggregate({
    where: { statusId: status.id, parentTaskId: null, deletedAt: null, archivedAt: null },
    _min: { order: true },
  });

  const seriesId = old.seriesId ?? old.id;
  const created = await tx.task.create({
    data: {
      title: old.title,
      description: old.description,
      groupId: old.groupId,
      statusId: status.id,
      priority: old.priority,
      order: top._min.order === null || top._min.order === undefined ? 0 : top._min.order - 1,
      dueDate: nextDue,
      abcde: old.abcde,
      repeat: old.repeat,
      seriesId,
      createdBy: old.createdBy,
      subtasks: {
        create: old.subtasks.map((s: { title: string; description: string | null; priority: string; order: number; createdBy: string }) => ({
          title: s.title,
          description: s.description,
          priority: s.priority,
          order: s.order,
          groupId: old.groupId,
          statusId: status.id,
          createdBy: s.createdBy,
        })),
      },
    },
    include: { _count: { select: { subtasks: { where: { deletedAt: null, archivedAt: null } }, comments: true } } },
  });

  await tx.task.update({ where: { id: old.id }, data: { nextInstanceId: created.id, seriesId } });
  await tx.activity.create({
    data: { taskId: old.id, userId, action: "recurred", metadata: { from: old.id, to: created.id } },
  });
  return created;
}
