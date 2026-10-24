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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  // null, numbers, strings, booleans and arrays are valid JSON but not a settings object.
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const { focusMins, shortMins, longMins, sessionsBeforeLong, autoStartBreaks, autoStartFocus, frogFirstMode } = body as Record<string, unknown>;

  // Omitted fields are `undefined`, which Prisma ignores on update (the stored
  // value stays) and replaces with the schema default on create. That is why a
  // body with only { frogFirstMode } leaves the timer settings alone, and a body
  // without frogFirstMode leaves that value alone.
  // Known limitation: the Pomodoro page keeps the whole GET row as its config and
  // PUTs it back, so its body does include frogFirstMode as it was when that page
  // loaded. Echoing the current value is harmless, but a stale Pomodoro tab
  // (loaded with false, mode then toggled on in /today, settings then saved in
  // the Pomodoro tab) resets it to false. Fixing that needs a change in the
  // Pomodoro code, which is out of scope here.
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
