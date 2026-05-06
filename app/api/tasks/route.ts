import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Priority } from "@/types";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, groupId, statusId, priority, order, parentTaskId, dueDate } = await req.json();
  if (!title?.trim() || !groupId || !statusId) {
    return NextResponse.json({ error: "title, groupId, statusId required" }, { status: 400 });
  }

  const task = await db.task.create({
    data: {
      title: title.trim(),
      groupId,
      statusId,
      priority: (priority as Priority) ?? "MEDIUM",
      order: order ?? 0,
      parentTaskId: parentTaskId ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      createdBy: user.id,
    },
    include: { _count: { select: { subtasks: true, comments: true } } },
  });

  await db.activity.create({
    data: { taskId: task.id, userId: user.id, action: "created" },
  });

  return NextResponse.json(task, { status: 201 });
}
