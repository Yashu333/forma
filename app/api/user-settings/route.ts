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
      return NextResponse.json({ focusMins: 25, shortMins: 5, longMins: 15, sessionsBeforeLong: 4, autoStartBreaks: false, autoStartFocus: false });
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

  const { focusMins, shortMins, longMins, sessionsBeforeLong, autoStartBreaks, autoStartFocus } = await req.json();

  const settings = await db.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, focusMins, shortMins, longMins, sessionsBeforeLong, autoStartBreaks, autoStartFocus },
    update: { focusMins, shortMins, longMins, sessionsBeforeLong, autoStartBreaks, autoStartFocus },
  });

  return NextResponse.json(settings);
}
