import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { hasNul } from "@/lib/frog/validate";
import { parseWeekdays } from "@/lib/habits/streak";

const MAX_ACTIVE = 20;
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

async function findOwn(id: string, userId: string) {
  if (hasNul(id)) return null;
  return db.habit.findFirst({ where: { id, userId } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const habit = await findOwn(id, user.id);
  if (!habit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return bad("name must not be empty");
    if (name.length > 100) return bad("name must be 100 characters or fewer");
    if (hasNul(name)) return bad("name must not contain NUL characters");
    data.name = name;
  }
  if (body.weekdays !== undefined) {
    const weekdays = parseWeekdays(body.weekdays);
    if (!weekdays) return bad("weekdays must be a list of days 0 (Sunday) to 6 (Saturday)");
    data.weekdays = weekdays;
  }
  if (body.order !== undefined) {
    if (typeof body.order !== "number" || !Number.isFinite(body.order)) return bad("order must be a number");
    data.order = body.order;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") return bad("archived must be a boolean");
    if (!body.archived && habit.archivedAt) {
      const active = await db.habit.count({ where: { userId: user.id, archivedAt: null } });
      if (active >= MAX_ACTIVE) return bad(`You can track up to ${MAX_ACTIVE} habits. Archive one first.`);
    }
    data.archivedAt = body.archived ? new Date() : null;
  }

  const updated = await db.habit.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const habit = await findOwn(id, user.id);
  if (!habit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.habit.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
