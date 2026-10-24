import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Priority } from "@/types";
import { hasNul, parsePlannedFor } from "@/lib/frog/validate";

const PRIORITIES: readonly string[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

// Quick capture: one call creates a task at the top of the project's first open
// column. The client works out the due instant from the user's local date and
// time, so the server never guesses their time zone.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");

  const { title, groupId, priority, dueDate } = body;
  if (typeof title !== "string" || !title.trim()) return bad("title is required");
  if (title.trim().length > 500) return bad("title must be 500 characters or fewer");
  if (hasNul(title)) return bad("title must not contain NUL characters");
  if (typeof groupId !== "string" || !groupId || hasNul(groupId)) return bad("groupId is required");
  if (priority !== undefined && priority !== null && !PRIORITIES.includes(priority)) {
    return bad("priority must be one of URGENT, HIGH, MEDIUM, LOW");
  }

  let due: Date | null = null;
  if (dueDate !== undefined && dueDate !== null) {
    due = typeof dueDate === "string" ? new Date(dueDate) : new Date(NaN);
    if (Number.isNaN(due.getTime())) return bad("dueDate must be an ISO date-time");
  }

  const plannedIn = body.plannedFor === undefined ? undefined : parsePlannedFor(body.plannedFor);
  if (plannedIn && !plannedIn.ok) return bad(plannedIn.error);

  const group = await db.group.findFirst({
    where: { id: groupId, ownerId: user.id },
    select: {
      id: true,
      name: true,
      color: true,
      statuses: { where: { celebrate: false }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 1, select: { id: true } },
    },
  });
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const status = group.statuses[0];
  if (!status) return bad("This project has no open column to add the task to");

  const top = await db.task.aggregate({
    where: { statusId: status.id, parentTaskId: null, deletedAt: null, archivedAt: null },
    _min: { order: true },
  });
  const order = top._min.order === null || top._min.order === undefined ? 0 : top._min.order - 1;

  const task = await db.$transaction(async (tx: typeof db) => {
    const created = await tx.task.create({
      data: {
        title: title.trim(),
        groupId: group.id,
        statusId: status.id,
        priority: ((priority as Priority | null) ?? "MEDIUM") as Priority,
        order,
        dueDate: due,
        plannedFor: plannedIn?.ok ? plannedIn.value : null,
        createdBy: user.id,
      },
      include: {
        group: { select: { id: true, name: true, color: true } },
        _count: { select: { subtasks: { where: { deletedAt: null, archivedAt: null } }, comments: true } },
      },
    });
    await tx.activity.create({ data: { taskId: created.id, userId: user.id, action: "created" } });
    return created;
  });

  return NextResponse.json(task, { status: 201 });
}
