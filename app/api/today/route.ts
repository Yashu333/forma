import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { isDateKey, isValidTimeZone } from "@/lib/frog/dates";
import { parseTodayPut } from "@/lib/frog/today";
import { buildTodayPayload, visibleTopLevelTask } from "@/lib/frog/today.server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // "Today" is whatever the browser says it is; the server clock is never used.
  // (new URL(req.url), not req.nextUrl, so a plain Request works too.)
  const query = new URL(req.url).searchParams;
  const date = query.get("date");
  const tz = query.get("tz");
  if (!isDateKey(date)) return NextResponse.json({ error: "date must be a date in YYYY-MM-DD format" }, { status: 400 });
  if (!isValidTimeZone(tz)) return NextResponse.json({ error: "tz must be an IANA time zone such as Europe/Berlin" }, { status: 400 });

  return NextResponse.json(await buildTodayPayload(user.id, date, tz));
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseTodayPut(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { date, tz, taskIds, ranks, frogTaskId, finalize } = parsed.value;

  // Every task must be the caller's, top-level and not in the trash or archive.
  // A foreign id and a missing id look the same (404), and nothing is written
  // until all of them pass. The current letters are read here to know which
  // rank changes are real letter changes worth an activity row.
  const owned: { id: string; abcde: string | null }[] = taskIds.length
    ? await db.task.findMany({
        where: { id: { in: taskIds }, ...visibleTopLevelTask(user.id) },
        select: { id: true, abcde: true },
      })
    : [];
  if (owned.length !== taskIds.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const currentLetter = new Map(owned.map((t) => [t.id, t.abcde]));

  const now = new Date();
  const writes = [
    db.task.updateMany({ where: { id: { in: taskIds } }, data: { plannedFor: date } }),
    // Tasks dropped from the plan go back to the backlog. Only ones the plan
    // screen could have shown are touched (same filter as the ownership check).
    db.task.updateMany({
      where: { ...visibleTopLevelTask(user.id), plannedFor: date, id: { notIn: taskIds } },
      data: { plannedFor: null },
    }),
  ];
  for (const [id, { abcde, abcdeRank }] of Object.entries(ranks)) {
    writes.push(db.task.update({ where: { id }, data: { abcde, abcdeRank } }));
    if (abcde !== currentLetter.get(id)) {
      writes.push(db.activity.create({
        data: { taskId: id, userId: user.id, action: "abcde_changed", metadata: { from: currentLetter.get(id), to: abcde } },
      }));
    }
  }
  writes.push(db.dailyPlan.upsert({
    where: { userId_date: { userId: user.id, date } },
    create: { userId: user.id, date, frogTaskId, plannedAt: finalize ? now : null },
    // A plain save keeps an earlier plannedAt; only finalize (re)stamps it.
    update: { frogTaskId, ...(finalize && { plannedAt: now }) },
  }));
  await db.$transaction(writes);

  return NextResponse.json(await buildTodayPayload(user.id, date, tz));
}
