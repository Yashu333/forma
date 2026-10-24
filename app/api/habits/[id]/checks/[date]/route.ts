import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { addDays, isDateKey } from "@/lib/frog/dates";
import { hasNul } from "@/lib/frog/validate";

const MAX_DAYS_BACK = 35;
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

// Ticks (PUT) or unticks (DELETE) one day of a habit. Both are idempotent.
// `?today=` is the user's local date: a tick can not reach into the future (one
// day of slack for time zones) or more than 35 days back.
async function resolve(req: Request, params: Promise<{ id: string; date: string }>) {
  const { id, date } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const today = new URL(req.url).searchParams.get("today");
  if (!isDateKey(today)) return { error: bad("today must be a YYYY-MM-DD date") };
  if (!isDateKey(date)) return { error: bad("date must be a YYYY-MM-DD date") };
  if (date > addDays(today, 1) || date < addDays(today, -MAX_DAYS_BACK)) {
    return { error: bad(`date must be within ${MAX_DAYS_BACK} days before today, and not in the future`) };
  }

  const habit = hasNul(id) ? null : await db.habit.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!habit) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { habitId: habit.id as string, date };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; date: string }> }) {
  const r = await resolve(req, params);
  if ("error" in r) return r.error;
  await db.habitCheck.upsert({
    where: { habitId_date: { habitId: r.habitId, date: r.date } },
    create: { habitId: r.habitId, date: r.date },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; date: string }> }) {
  const r = await resolve(req, params);
  if ("error" in r) return r.error;
  await db.habitCheck.deleteMany({ where: { habitId: r.habitId, date: r.date } });
  return NextResponse.json({ ok: true });
}
