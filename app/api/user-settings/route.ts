import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) console.error("[user-settings GET] auth error:", authError);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const settings = await db.userSettings.findUnique({ where: { userId: user.id } });
    if (!settings) {
      return NextResponse.json({ focusMins: 25, shortMins: 5, longMins: 15, sessionsBeforeLong: 4, autoStartBreaks: false, autoStartFocus: false, frogFirstMode: false });
    }
    return NextResponse.json(settings);
  } catch (e) {
    console.error("[user-settings GET] error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown> | null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  if (body === null) return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });

  const { focusMins, shortMins, longMins, sessionsBeforeLong, autoStartBreaks, autoStartFocus, frogFirstMode } = body;

  // Omitted fields are `undefined`, which Prisma ignores on update (the stored
  // value stays) and replaces with the schema default on create. That is why the
  // Pomodoro page (which never sends frogFirstMode) can't reset it, and why a body
  // with only { frogFirstMode } leaves the timer settings alone.
  if (frogFirstMode !== undefined && typeof frogFirstMode !== "boolean") {
    return NextResponse.json({ error: "frogFirstMode must be a boolean" }, { status: 400 });
  }

  const settings = await db.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, focusMins, shortMins, longMins, sessionsBeforeLong, autoStartBreaks, autoStartFocus, frogFirstMode },
    update: { focusMins, shortMins, longMins, sessionsBeforeLong, autoStartBreaks, autoStartFocus, frogFirstMode },
  });

  return NextResponse.json(settings);
}
