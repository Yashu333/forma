import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Abcde, Priority } from "@/types";
import { parseAbcde, parseAbcdeRank, parsePlannedFor } from "@/lib/frog/validate";

const activeSubtasks = { where: { deletedAt: null, archivedAt: null }, orderBy: { order: "asc" } } as const;
const activeCount = { select: { subtasks: { where: { deletedAt: null, archivedAt: null } }, comments: true } } as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const task = await db.task.findUnique({
    where: { id },
    include: {
      subtasks: activeSubtasks,
      comments: { orderBy: { createdAt: "asc" } },
      activity: { orderBy: { createdAt: "asc" } },
      _count: activeCount,
    },
  });

  if (!task || task.deletedAt || task.archivedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(task);
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
  const { title, description, priority, statusId, dueDate, order, archived } = body;

  // The task must live in one of the caller's groups and not be in the trash.
  // Archived tasks pass on purpose: this same handler restores them. The status
  // is selected here so the status-change logic below doesn't need another read.
  const existing = await db.task.findFirst({
    where: { id, deletedAt: null, group: { ownerId: user.id } },
    select: { statusId: true, abcde: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ABCDE / planning fields. Validated before anything is written, including on
  // the archive path below, so bad input is always a 400.
  const abcdeIn = body.abcde === undefined ? undefined : parseAbcde(body.abcde);
  const rankIn = body.abcdeRank === undefined ? undefined : parseAbcdeRank(body.abcdeRank);
  const plannedForIn = body.plannedFor === undefined ? undefined : parsePlannedFor(body.plannedFor);
  for (const parsed of [abcdeIn, rankIn, plannedForIn]) {
    if (parsed && !parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
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
    await db.task.updateMany({
      where: { OR: [{ id }, { parentTaskId: id }] },
      data: { archivedAt: archived ? now : null },
    });
    await db.activity.create({
      data: { taskId: id, userId: user.id, action: archived ? "archived" : "restored" },
    });
    const updated = await db.task.findUnique({
      where: { id },
      include: { subtasks: activeSubtasks, comments: { orderBy: { createdAt: "asc" } }, _count: activeCount },
    });
    return NextResponse.json(updated);
  }

  // If the status is changing, work out whether the task is entering or leaving
  // a "done" (celebrate) status so we can stamp/clear completedAt for reporting.
  let completedAtUpdate: Record<string, Date | null> = {};
  let statusActuallyChanged = false;
  if (statusId !== undefined) {
    statusActuallyChanged = existing.statusId !== statusId;
    const [prevStatus, nextStatus] = await Promise.all([
      db.status.findUnique({ where: { id: existing.statusId }, select: { celebrate: true } }),
      db.status.findUnique({ where: { id: statusId }, select: { celebrate: true } }),
    ]);
    const wasDone = !!prevStatus?.celebrate;
    const isDone = !!nextStatus?.celebrate;
    if (isDone && !wasDone) completedAtUpdate = { completedAt: new Date() };
    else if (!isDone && wasDone) completedAtUpdate = { completedAt: null };
  }

  const writes = [
    db.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(priority !== undefined && { priority: priority as Priority }),
        ...(statusId !== undefined && { statusId }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(order !== undefined && { order }),
        ...abcdeData,
        ...completedAtUpdate,
      },
      include: {
        subtasks: activeSubtasks,
        comments: { orderBy: { createdAt: "asc" } },
        _count: activeCount,
      },
    }),
  ];
  if (statusActuallyChanged) {
    writes.push(db.activity.create({
      data: { taskId: id, userId: user.id, action: "status_changed", metadata: { to: statusId, from: existing.statusId } },
    }));
  }
  if (abcdeChanged) {
    writes.push(db.activity.create({
      data: { taskId: id, userId: user.id, action: "abcde_changed", metadata: { from: existing.abcde, to: abcdeData.abcde } },
    }));
  }

  // The task change and its activity rows commit together or not at all.
  const [task] = await db.$transaction(writes);
  return NextResponse.json(task);
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
