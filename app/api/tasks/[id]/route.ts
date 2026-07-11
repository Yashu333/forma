import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Priority } from "@/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const task = await db.task.findUnique({
    where: { id },
    include: {
      subtasks: { where: { deletedAt: null }, orderBy: { order: "asc" } },
      comments: { orderBy: { createdAt: "asc" } },
      activity: { orderBy: { createdAt: "asc" } },
      _count: { select: { subtasks: { where: { deletedAt: null } }, comments: true } },
    },
  });

  if (!task || task.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(task);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { title, description, priority, statusId, dueDate, order } = body;

  const task = await db.task.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(priority !== undefined && { priority: priority as Priority }),
      ...(statusId !== undefined && { statusId }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(order !== undefined && { order }),
    },
    include: {
      subtasks: { where: { deletedAt: null }, orderBy: { order: "asc" } },
      comments: { orderBy: { createdAt: "asc" } },
      _count: { select: { subtasks: { where: { deletedAt: null } }, comments: true } },
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

  const now = new Date();
  await db.task.updateMany({ where: { OR: [{ id }, { parentTaskId: id }] }, data: { deletedAt: now } });
  return new NextResponse(null, { status: 204 });
}
