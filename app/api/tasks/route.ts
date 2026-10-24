import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Priority } from "@/types";
import { hasNul } from "@/lib/frog/validate";

const PRIORITIES: readonly string[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, groupId, statusId, priority, order, parentTaskId, dueDate } = await req.json();
  if (typeof title !== "string" || !title.trim() || typeof groupId !== "string" || !groupId || typeof statusId !== "string" || !statusId) {
    return NextResponse.json({ error: "title, groupId, statusId required" }, { status: 400 });
  }
  if (hasNul(title) || hasNul(groupId) || hasNul(statusId)) {
    return NextResponse.json({ error: "Fields must not contain NUL characters" }, { status: 400 });
  }
  if (priority !== undefined && priority !== null && !PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: "priority must be one of URGENT, HIGH, MEDIUM, LOW" }, { status: 400 });
  }
  const due = dueDate ? new Date(dueDate) : null;
  if (due && Number.isNaN(due.getTime())) {
    return NextResponse.json({ error: "dueDate must be a valid date" }, { status: 400 });
  }

  // The project must be the caller's, the column must belong to it, and a parent task must be in it too.
  const group = await db.group.findFirst({ where: { id: groupId, ownerId: user.id }, select: { id: true } });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const status = await db.status.findFirst({ where: { id: statusId, groupId }, select: { id: true } });
  if (!status) return NextResponse.json({ error: "statusId does not belong to this project" }, { status: 400 });
  if (parentTaskId) {
    const parent = typeof parentTaskId === "string" && !hasNul(parentTaskId)
      ? await db.task.findFirst({ where: { id: parentTaskId, groupId, deletedAt: null }, select: { id: true } })
      : null;
    if (!parent) return NextResponse.json({ error: "Parent task not found" }, { status: 404 });
  }

  const task = await db.task.create({
    data: {
      title: title.trim(),
      groupId,
      statusId,
      priority: (priority as Priority) ?? "MEDIUM",
      order: order ?? 0,
      parentTaskId: parentTaskId ?? null,
      dueDate: due,
      createdBy: user.id,
    },
    include: { _count: { select: { subtasks: { where: { deletedAt: null, archivedAt: null } }, comments: true } } },
  });

  await db.activity.create({
    data: { taskId: task.id, userId: user.id, action: "created" },
  });

  return NextResponse.json(task, { status: 201 });
}
