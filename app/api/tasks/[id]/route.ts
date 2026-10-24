import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Abcde, Priority } from "@/types";
import { hasNul, parseAbcde, parseAbcdeRank, parsePlannedFor } from "@/lib/frog/validate";
import { isValidTimeZone } from "@/lib/frog/dates";
import { parseRepeatRule } from "@/lib/recurrence/rule";
import { spawnNextInstance } from "@/lib/recurrence/server";

const PRIORITIES: readonly string[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
// Everything this handler can update. The archive toggle must be sent alone.
const UPDATABLE_FIELDS = ["title", "description", "priority", "statusId", "dueDate", "order", "abcde", "abcdeRank", "plannedFor", "repeat", "markDone"];

const activeSubtasks = { where: { deletedAt: null, archivedAt: null }, orderBy: { order: "asc" } } as const;
const activeCount = { select: { subtasks: { where: { deletedAt: null, archivedAt: null } }, comments: true } } as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only the owner's tasks (an id with a NUL can't exist and would make Postgres throw: a 404).
  const task = hasNul(id) ? null : await db.task.findFirst({
    where: { id, group: { ownerId: user.id } },
    include: {
      subtasks: activeSubtasks,
      comments: { orderBy: { createdAt: "asc" } },
      activity: { orderBy: { createdAt: "asc" } },
      _count: activeCount,
    },
  });

  if (!task || task.deletedAt || task.archivedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Focus time spent on this task and its subtasks (from the Pomodoro timer).
  const taskIds = [id, ...task.subtasks.map((s: { id: string }) => s.id)];
  const focus = await db.focusSession.aggregate({
    where: { userId: user.id, taskId: { in: taskIds } },
    _sum: { durationSec: true },
    _count: true,
  });
  return NextResponse.json({ ...task, focus: { totalSec: focus._sum.durationSec ?? 0, sessions: focus._count } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const { title, description, priority, dueDate, order, archived } = body;
  let statusId = body.statusId;
  // The browser's zone, used to work out the next due date of a repeating task.
  const tz = isValidTimeZone(body.tz) ? body.tz : "UTC";

  // The task must live in one of the caller's groups and not be in the trash.
  // Archived tasks pass on purpose: this same handler restores them. The status
  // is selected here so the status-change logic below doesn't need another read.
  // (An id with a NUL can't exist and would make Postgres throw: a 404.)
  const existing = hasNul(id) ? null : await db.task.findFirst({
    where: { id, deletedAt: null, group: { ownerId: user.id } },
    select: { statusId: true, groupId: true, abcde: true, dueDate: true, parentTaskId: true, repeat: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // `markDone: true` is shorthand for "move to this project's first Done column".
  if (body.markDone === true && statusId === undefined && archived === undefined) {
    const done = await db.status.findFirst({
      where: { groupId: existing.groupId, celebrate: true },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!done) return NextResponse.json({ error: "This project has no Done column" }, { status: 400 });
    statusId = done.id;
  }

  // The archive toggle is its own operation. Reject other fields sent with it
  // rather than silently dropping them (the UI only ever sends `{ archived }`).
  if (archived !== undefined) {
    if (typeof archived !== "boolean") {
      return NextResponse.json({ error: "archived must be a boolean" }, { status: 400 });
    }
    const extra = UPDATABLE_FIELDS.filter((f) => body[f] !== undefined);
    if (extra.length > 0) {
      return NextResponse.json(
        { error: `archived cannot be combined with other fields (got ${extra.join(", ")}); send it on its own` },
        { status: 400 },
      );
    }
  }

  // Plain field validation, before anything is written (these used to reach
  // Prisma and come back as a 500).
  if (title !== undefined && typeof title !== "string") {
    return NextResponse.json({ error: "title must be a string" }, { status: 400 });
  }
  // Postgres can't store a NUL; without this the write below throws (a 500).
  if (typeof title === "string" && hasNul(title)) {
    return NextResponse.json({ error: "title must not contain NUL characters" }, { status: 400 });
  }
  if (typeof description === "string" && hasNul(description)) {
    return NextResponse.json({ error: "description must not contain NUL characters" }, { status: 400 });
  }
  if (priority !== undefined && !PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: "priority must be one of URGENT, HIGH, MEDIUM, LOW" }, { status: 400 });
  }

  // ABCDE / planning fields. Validated before anything is written, including on
  // the archive path below, so bad input is always a 400.
  const abcdeIn = body.abcde === undefined ? undefined : parseAbcde(body.abcde);
  const rankIn = body.abcdeRank === undefined ? undefined : parseAbcdeRank(body.abcdeRank);
  const plannedForIn = body.plannedFor === undefined ? undefined : parsePlannedFor(body.plannedFor);
  for (const parsed of [abcdeIn, rankIn, plannedForIn]) {
    if (parsed && !parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Repeat rule: null clears it; setting one needs a due date to anchor on.
  let repeatData: { repeat?: unknown; seriesId?: null } = {};
  if (body.repeat !== undefined) {
    if (body.repeat === null) {
      repeatData = { repeat: null };
    } else {
      const rule = parseRepeatRule(body.repeat);
      if (!rule) return NextResponse.json({ error: "repeat must be a valid repeat rule or null" }, { status: 400 });
      repeatData = { repeat: rule };
    }
  }

  if (repeatData.repeat !== undefined && repeatData.repeat !== null) {
    if (existing.parentTaskId) return NextResponse.json({ error: "Subtasks can't repeat" }, { status: 400 });
    const effectiveDue = dueDate !== undefined ? dueDate : existing.dueDate;
    if (!effectiveDue) return NextResponse.json({ error: "A repeating task needs a due date" }, { status: 400 });
  } else if (repeatData.repeat === undefined && dueDate === null && existing.repeat) {
    // No due date, nothing to anchor the repeat on.
    repeatData = { repeat: null };
  }
  if (dueDate !== undefined && dueDate !== null && (typeof dueDate !== "string" || Number.isNaN(new Date(dueDate).getTime()))) {
    return NextResponse.json({ error: "dueDate must be an ISO date-time or null" }, { status: 400 });
  }

  const abcdeData: { abcde?: Abcde | null; abcdeRank?: number | null; plannedFor?: string | null } = {};
  let abcdeChanged = false;
  if (abcdeIn?.ok) {
    abcdeData.abcde = abcdeIn.value;
    abcdeChanged = abcdeIn.value !== existing.abcde;
    if (abcdeIn.value === null) {
      // A rank only means something within a letter, so removing the letter
      // removes the rank (whatever the request says about it).
      abcdeData.abcdeRank = null;
    } else if (rankIn?.ok) {
      abcdeData.abcdeRank = rankIn.value;
    } else if (abcdeChanged) {
      // "A-2" doesn't carry over to B; moving letters resets the rank.
      abcdeData.abcdeRank = null;
    }
  } else if (rankIn?.ok) {
    if (existing.abcde === null && rankIn.value !== null) {
      return NextResponse.json({ error: "abcdeRank requires an abcde letter" }, { status: 400 });
    }
    abcdeData.abcdeRank = rankIn.value;
  }
  if (plannedForIn?.ok) abcdeData.plannedFor = plannedForIn.value;

  // Archive / restore toggle. Setting archived clears the board view but keeps
  // the task for reporting; restoring returns it to the board.
  if (archived !== undefined) {
    const now = new Date();
    const [, , updated] = await db.$transaction([
      db.task.updateMany({
        where: { OR: [{ id }, { parentTaskId: id }] },
        data: { archivedAt: archived ? now : null },
      }),
      db.activity.create({
        data: { taskId: id, userId: user.id, action: archived ? "archived" : "restored" },
      }),
      db.task.findUnique({
        where: { id },
        include: { subtasks: activeSubtasks, comments: { orderBy: { createdAt: "asc" } }, _count: activeCount },
      }),
    ]);
    return NextResponse.json(updated);
  }

  // If the status is changing, work out whether the task is entering or leaving
  // a "done" (celebrate) status so we can stamp/clear completedAt for reporting.
  let completedAtUpdate: Record<string, Date | null> = {};
  let statusActuallyChanged = false;
  let justCompleted = false;
  if (statusId !== undefined) {
    if (typeof statusId !== "string" || !statusId) {
      return NextResponse.json({ error: "statusId must be a status id" }, { status: 400 });
    }
    if (hasNul(statusId)) {
      return NextResponse.json({ error: "statusId must not contain NUL characters" }, { status: 400 });
    }
    // Both statuses are read inside the task's own group: the new one must
    // belong to it (a foreign or unknown id is a 400, never a write).
    const [prevStatus, nextStatus] = await Promise.all([
      db.status.findUnique({ where: { id: existing.statusId }, select: { celebrate: true } }),
      db.status.findFirst({ where: { id: statusId, groupId: existing.groupId }, select: { celebrate: true } }),
    ]);
    if (!nextStatus) {
      return NextResponse.json({ error: "statusId does not belong to this task's project" }, { status: 400 });
    }
    statusActuallyChanged = existing.statusId !== statusId;
    const wasDone = !!prevStatus?.celebrate;
    const isDone = !!nextStatus.celebrate;
    if (isDone && !wasDone) { completedAtUpdate = { completedAt: new Date() }; justCompleted = true; }
    else if (!isDone && wasDone) completedAtUpdate = { completedAt: null };
  }

  const include = {
    subtasks: activeSubtasks,
    comments: { orderBy: { createdAt: "asc" } },
    _count: activeCount,
  } as const;

  // The task change, its activity rows and (for a repeating task finished just
  // now) the next instance commit together or not at all.
  const result = await db.$transaction(async (tx: typeof db) => {
    let task = await tx.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(priority !== undefined && { priority: priority as Priority }),
        ...(statusId !== undefined && { statusId }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(order !== undefined && { order }),
        ...abcdeData,
        ...repeatData,
        ...completedAtUpdate,
      },
      include,
    });
    if (statusActuallyChanged) {
      await tx.activity.create({
        data: { taskId: id, userId: user.id, action: "status_changed", metadata: { to: statusId, from: existing.statusId } },
      });
    }
    if (abcdeChanged) {
      await tx.activity.create({
        data: { taskId: id, userId: user.id, action: "abcde_changed", metadata: { from: existing.abcde, to: abcdeData.abcde } },
      });
    }
    let nextInstance = null;
    if (justCompleted) {
      nextInstance = await spawnNextInstance(tx, id, tz, user.id);
      if (nextInstance) task = await tx.task.findUnique({ where: { id }, include });
    }
    return { task, nextInstance };
  });
  // `nextInstance` lets the board show the new copy without a reload.
  return NextResponse.json(result.nextInstance ? { ...result.task, nextInstance: result.nextInstance } : result.task);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Move to trash: hidden from board AND reports. Recoverable until purged.
  const now = new Date();
  await db.task.updateMany({ where: { OR: [{ id }, { parentTaskId: id }] }, data: { deletedAt: now } });
  await db.activity.create({ data: { taskId: id, userId: user.id, action: "deleted" } });
  return new NextResponse(null, { status: 204 });
}
