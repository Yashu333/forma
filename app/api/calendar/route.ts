import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { addDays, isDateKey, isValidTimeZone, localDateKey, localDateTimeToInstant } from "@/lib/frog/dates";

const MAX_DAYS = 62;

// A task as the calendar shows it: the board fields plus its project and a
// done flag (its column is a "done" column).
const taskSelect = {
  id: true,
  title: true,
  groupId: true,
  statusId: true,
  priority: true,
  dueDate: true,
  repeat: true,
  abcde: true,
  abcdeRank: true,
  completedAt: true,
  group: { select: { id: true, name: true, color: true } },
  status: { select: { celebrate: true } },
} as const;

type Row = { status: { celebrate: boolean } } & Record<string, unknown>;
const shape = ({ status, ...rest }: Row) => ({ ...rest, done: status.celebrate });

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const tz = sp.get("tz");
  if (!isDateKey(from) || !isDateKey(to) || from > to) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD dates, from <= to" }, { status: 400 });
  }
  if (!isValidTimeZone(tz)) return NextResponse.json({ error: "tz must be an IANA time zone" }, { status: 400 });
  if (addDays(from, MAX_DAYS - 1) < to) {
    return NextResponse.json({ error: `The range can span at most ${MAX_DAYS} days` }, { status: 400 });
  }

  // [start of `from`, start of the day after `to`) in the user's zone.
  const gte = localDateTimeToInstant(from, "00:00", tz);
  const lt = localDateTimeToInstant(addDays(to, 1), "00:00", tz);
  const todayStart = localDateTimeToInstant(localDateKey(new Date(), tz), "00:00", tz);

  const mine = { parentTaskId: null, deletedAt: null, archivedAt: null, group: { ownerId: user.id } } as const;
  const open = { status: { celebrate: false } } as const;

  const [tasks, overdue, unscheduled, recurring, statuses] = await Promise.all([
    db.task.findMany({ where: { ...mine, dueDate: { gte, lt } }, orderBy: { dueDate: "asc" }, select: taskSelect }),
    db.task.findMany({ where: { ...mine, ...open, dueDate: { lt: todayStart } }, orderBy: { dueDate: "asc" }, take: 50, select: taskSelect }),
    db.task.findMany({ where: { ...mine, ...open, dueDate: null }, orderBy: { updatedAt: "desc" }, take: 200, select: taskSelect }),
    db.task.findMany({
      where: { ...mine, ...open, dueDate: { not: null }, repeat: { not: Prisma.DbNull } },
      take: 100,
      select: { id: true, title: true, repeat: true, dueDate: true, group: { select: { id: true, name: true, color: true } } },
    }),
    db.status.findMany({
      where: { group: { ownerId: user.id } },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: { id: true, name: true, groupId: true, order: true, celebrate: true },
    }),
  ]);

  const statusesByGroup: Record<string, unknown[]> = {};
  for (const s of statuses) (statusesByGroup[s.groupId] ??= []).push(s);

  return NextResponse.json({
    tasks: tasks.map(shape),
    overdue: overdue.map(shape),
    unscheduled: unscheduled.map(shape),
    statusesByGroup,
    recurring,
  });
}
