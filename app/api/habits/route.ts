import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { isDateKey, isValidTimeZone } from "@/lib/frog/dates";
import { hasNul } from "@/lib/frog/validate";
import { parseWeekdays } from "@/lib/habits/streak";
import { habitPayload } from "@/lib/habits/server";

const MAX_ACTIVE = 20;
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const today = sp.get("today");
  const tz = sp.get("tz");
  if (!isDateKey(today)) return bad("today must be a YYYY-MM-DD date");
  if (!isValidTimeZone(tz)) return bad("tz must be an IANA time zone");

  const rows = await db.habit.findMany({
    where: { userId: user.id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { checks: { select: { date: true } } },
  });
  type Row = (typeof rows)[number];
  const active = rows.filter((h: Row) => !h.archivedAt);
  const archived = rows.filter((h: Row) => h.archivedAt).map((h: Row) => ({ id: h.id, name: h.name, weekdays: h.weekdays }));
  return NextResponse.json({ habits: active.map((h: Row) => habitPayload(h, today, tz)), archived });
}

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
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return bad("name is required");
  if (name.length > 100) return bad("name must be 100 characters or fewer");
  if (hasNul(name)) return bad("name must not contain NUL characters");
  const weekdays = body.weekdays === undefined ? [0, 1, 2, 3, 4, 5, 6] : parseWeekdays(body.weekdays);
  if (!weekdays) return bad("weekdays must be a list of days 0 (Sunday) to 6 (Saturday)");

  const [count, last] = await Promise.all([
    db.habit.count({ where: { userId: user.id, archivedAt: null } }),
    db.habit.findFirst({ where: { userId: user.id }, orderBy: { order: "desc" }, select: { order: true } }),
  ]);
  if (count >= MAX_ACTIVE) return bad(`You can track up to ${MAX_ACTIVE} habits. Archive one first.`);

  const habit = await db.habit.create({
    data: { userId: user.id, name, weekdays, order: (last?.order ?? -1) + 1 },
  });
  return NextResponse.json(habit, { status: 201 });
}
