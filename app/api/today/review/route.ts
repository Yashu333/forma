import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { parseReviewPost } from "@/lib/frog/review";
import { buildTodayPayload, visibleTopLevelTask } from "@/lib/frog/today.server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // date, tz, tomorrow's date and every field are checked before any DB work.
  const parsed = parseReviewPost(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { date, tomorrow, tz, moves, wentWell, improve, rating, tomorrowFrogTaskId } = parsed.value;

  // Every task named must be the caller's, top-level and not in the trash or
  // archive. A foreign id and a missing id look the same (404), and nothing is
  // written until all of them pass. (Archived tasks count as gone, so an
  // archive move can't be repeated; the UI never offers one twice because
  // archived tasks leave the Today list.)
  const ids = [...new Set([...moves.map((m) => m.taskId), ...(tomorrowFrogTaskId ? [tomorrowFrogTaskId] : [])])];
  if (ids.length) {
    const owned: { id: string }[] = await db.task.findMany({
      where: { id: { in: ids }, ...visibleTopLevelTask(user.id) },
      select: { id: true },
    });
    if (owned.length !== ids.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const idsFor = (action: string) => moves.filter((m) => m.action === action).map((m) => m.taskId);
  const toTomorrow = idsFor("tomorrow");
  const toBacklog = idsFor("backlog");
  const toArchive = idsFor("archive");

  const now = new Date();
  const writes = [];
  if (toTomorrow.length) {
    writes.push(db.task.updateMany({ where: { id: { in: toTomorrow } }, data: { plannedFor: tomorrow } }));
  }
  if (toBacklog.length) {
    writes.push(db.task.updateMany({ where: { id: { in: toBacklog } }, data: { plannedFor: null } }));
  }
  if (toArchive.length) {
    // Same as the archive PATCH: the task and its subtasks, plus an activity row.
    // plannedFor stays as it was (archived tasks drop out of every plan view).
    writes.push(db.task.updateMany({
      where: { OR: [{ id: { in: toArchive } }, { parentTaskId: { in: toArchive } }] },
      data: { archivedAt: now },
    }));
    writes.push(db.activity.createMany({
      data: toArchive.map((taskId) => ({ taskId, userId: user.id, action: "archived" })),
    }));
  }
  // A task sent off tomorrow's list (edited review) can't stay tomorrow's frog.
  const leaving = [...toBacklog, ...toArchive];
  if (leaving.length) {
    writes.push(db.dailyPlan.updateMany({
      where: { userId: user.id, date: tomorrow, frogTaskId: { in: leaving } },
      data: { frogTaskId: null },
    }));
  }

  // Omitted = keep what's stored, null = clear it. A missing row is created
  // (frog null, plannedAt null), so a review never needs a plan first.
  const reflection = {
    ...(wentWell !== undefined && { wentWell }),
    ...(improve !== undefined && { improve }),
    ...(rating !== undefined && { rating }),
  };
  writes.push(db.dailyPlan.upsert({
    where: { userId_date: { userId: user.id, date } },
    create: { userId: user.id, date, frogTaskId: null, ...reflection, reviewedAt: now },
    update: { ...reflection, reviewedAt: now },
  }));

  if (tomorrowFrogTaskId) {
    writes.push(db.task.updateMany({ where: { id: tomorrowFrogTaskId }, data: { plannedFor: tomorrow } }));
    // plannedAt is left alone (null on create): tomorrow's morning flow still
    // runs, now with this frog preselected. An already-planned day keeps its stamp.
    writes.push(db.dailyPlan.upsert({
      where: { userId_date: { userId: user.id, date: tomorrow } },
      create: { userId: user.id, date: tomorrow, frogTaskId: tomorrowFrogTaskId },
      update: { frogTaskId: tomorrowFrogTaskId },
    }));
  }
  await db.$transaction(writes);

  return NextResponse.json(await buildTodayPayload(user.id, date, tz));
}
