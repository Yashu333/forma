import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { hasNul } from "@/lib/frog/validate";
import { isValidTimeZone } from "@/lib/frog/dates";
import { spawnNextInstance } from "@/lib/recurrence/server";

interface Update { id: string; order: number; statusId: string }

function parseUpdates(v: unknown): Update[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 500) return null;
  for (const u of v) {
    if (!u || typeof u !== "object") return null;
    const { id, order, statusId } = u as Record<string, unknown>;
    if (typeof id !== "string" || !id || hasNul(id)) return null;
    if (typeof statusId !== "string" || !statusId || hasNul(statusId)) return null;
    if (typeof order !== "number" || !Number.isFinite(order)) return null;
  }
  return v as Update[];
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const updates = parseUpdates(body?.updates);
  if (!updates) return NextResponse.json({ error: "updates must be a list of { id, order, statusId }" }, { status: 400 });
  const tz = isValidTimeZone(body?.tz) ? body.tz : "UTC";

  // Every task must be one of the caller's (not in the trash), and every target
  // column must belong to that task's own project. Otherwise nothing is written.
  const taskIds: string[] = [...new Set(updates.map(u => u.id))];
  const current = await db.task.findMany({
    where: { id: { in: taskIds }, deletedAt: null, group: { ownerId: user.id } },
    select: { id: true, statusId: true, groupId: true },
  });
  if (current.length !== taskIds.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const currentById = new Map<string, { statusId: string; groupId: string }>(current.map((t: { id: string; statusId: string; groupId: string }) => [t.id, t]));

  const wantedStatusIds: string[] = [...new Set<string>([...updates.map(u => u.statusId), ...current.map((t: { statusId: string }) => t.statusId)])];
  const statuses = await db.status.findMany({
    where: { id: { in: wantedStatusIds } },
    select: { id: true, celebrate: true, groupId: true },
  });
  const statusById = new Map<string, { celebrate: boolean; groupId: string }>(statuses.map((s: { id: string; celebrate: boolean; groupId: string }) => [s.id, s]));
  for (const u of updates) {
    if (statusById.get(u.statusId)?.groupId !== currentById.get(u.id)!.groupId) {
      return NextResponse.json({ error: "statusId does not belong to the task's project" }, { status: 400 });
    }
  }

  // Which tasks are actually changing column, and are they entering or leaving
  // a "done" (celebrate) column? That stamps/clears completedAt for reports.
  const now = new Date();
  const statusChanged: string[] = [];
  const completedNow: string[] = [];

  const spawned = await db.$transaction(async (tx: typeof db) => {
    for (const { id, order, statusId } of updates) {
      const prevStatusId = currentById.get(id)!.statusId;
      const changed = prevStatusId !== statusId;
      let completedAtUpdate: Record<string, Date | null> = {};
      if (changed) {
        statusChanged.push(id);
        const wasDone = !!statusById.get(prevStatusId)?.celebrate;
        const isDone = !!statusById.get(statusId)?.celebrate;
        if (isDone && !wasDone) { completedAtUpdate = { completedAt: now }; completedNow.push(id); }
        else if (!isDone && wasDone) completedAtUpdate = { completedAt: null };
      }
      await tx.task.update({ where: { id }, data: { order, statusId, ...completedAtUpdate } });
    }
    if (statusChanged.length) {
      await tx.activity.createMany({
        data: statusChanged.map(id => ({
          taskId: id, userId: user.id, action: "status_changed",
          metadata: { to: updates.find(u => u.id === id)!.statusId, from: currentById.get(id)!.statusId },
        })),
      });
    }
    const created = [];
    for (const id of completedNow) {
      const next = await spawnNextInstance(tx, id, tz, user.id, now);
      if (next) created.push(next);
    }
    return created;
  });

  // `spawned` lets the board show the next copies of repeating tasks without a reload.
  return NextResponse.json({ ok: true, spawned });
}
