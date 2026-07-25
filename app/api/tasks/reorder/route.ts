import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { updates } = await req.json() as {
    updates: { id: string; order: number; statusId: string }[];
  };

  // Figure out which of these tasks are actually changing status, so we can
  // stamp/clear completedAt the same way the task-detail status dropdown does
  // — otherwise dragging a card into a "done" column never registers for reports.
  const taskIds = updates.map(u => u.id);
  const current = await db.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, statusId: true },
  });
  const currentStatusById = new Map(current.map((t: { id: string; statusId: string }) => [t.id, t.statusId]));

  const changedStatusIds = new Set(
    updates.filter(u => currentStatusById.get(u.id) !== u.statusId).map(u => u.statusId),
  );
  const prevStatusIds = new Set(
    updates
      .filter(u => currentStatusById.get(u.id) !== u.statusId)
      .map(u => currentStatusById.get(u.id))
      .filter((id): id is string => !!id),
  );
  const relevantStatuses = await db.status.findMany({
    where: { id: { in: [...changedStatusIds, ...prevStatusIds] } },
    select: { id: true, celebrate: true },
  });
  const celebrateByStatusId = new Map(relevantStatuses.map((s: { id: string; celebrate: boolean }) => [s.id, s.celebrate]));

  const now = new Date();
  const statusChangedTaskIds: string[] = [];

  await db.$transaction(
    updates.map(({ id, order, statusId }) => {
      const prevStatusId = currentStatusById.get(id);
      const isStatusChange = prevStatusId !== undefined && prevStatusId !== statusId;
      let completedAtUpdate: Record<string, Date | null> = {};
      if (isStatusChange) {
        statusChangedTaskIds.push(id);
        const wasDone = !!celebrateByStatusId.get(prevStatusId);
        const isDone = !!celebrateByStatusId.get(statusId);
        if (isDone && !wasDone) completedAtUpdate = { completedAt: now };
        else if (!isDone && wasDone) completedAtUpdate = { completedAt: null };
      }
      return db.task.update({ where: { id }, data: { order, statusId, ...completedAtUpdate } });
    }),
  );

  if (statusChangedTaskIds.length) {
    await db.activity.createMany({
      data: statusChangedTaskIds.map(id => ({
        taskId: id, userId: user.id, action: "status_changed",
        metadata: { to: updates.find(u => u.id === id)!.statusId },
      })),
    });
  }

  return NextResponse.json({ ok: true });
}
