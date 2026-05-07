import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await db.userSettings.findUnique({ where: { userId: user.id } });
  if (!settings) {
    return NextResponse.json({ focusMins: 25, shortMins: 5, longMins: 15, sessionsBeforeLong: 4 });
  }
  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { focusMins, shortMins, longMins, sessionsBeforeLong } = await req.json();

  const settings = await db.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, focusMins, shortMins, longMins, sessionsBeforeLong },
    update: { focusMins, shortMins, longMins, sessionsBeforeLong },
  });

  return NextResponse.json(settings);
}
