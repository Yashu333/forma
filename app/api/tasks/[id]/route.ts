import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Priority } from "@/types";

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

  const body = await req.json();
  const { title, description, priority, statusId, dueDate, order, archived } = body;

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
  if (statusId !== undefined) {
    const existing = await db.task.findUnique({ where: { id }, select: { statusId: true, completedAt: true } });
    const [prevStatus, nextStatus] = await Promise.all([
      existing ? db.status.findUnique({ where: { id: existing.statusId }, select: { celebrate: true } }) : null,
      db.status.findUnique({ where: { id: statusId }, select: { celebrate: true } }),
    ]);
    const wasDone = !!prevStatus?.celebrate;
    const isDone = !!nextStatus?.celebrate;
    if (isDone && !wasDone) completedAtUpdate = { completedAt: new Date() };
    else if (!isDone && wasDone) completedAtUpdate = { completedAt: null };
  }

  const task = await db.task.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(priority !== undefined && { priority: priority as Priority }),
      ...(statusId !== undefined && { statusId }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(order !== undefined && { order }),
      ...completedAtUpdate,
    },
    include: {
      subtasks: activeSubtasks,
      comments: { orderBy: { createdAt: "asc" } },
      _count: activeCount,
    },
  });

  if (statusId && statusId !== body.prevStatusId) {
    await db.activity.create({
      data: { taskId: id, userId: user.id, action: "status_changed", metadata: { to: statusId } },
    });
  }

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
