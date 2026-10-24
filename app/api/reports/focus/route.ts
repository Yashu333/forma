import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { addDays, isDateKey, isValidTimeZone, localDateTimeToInstant } from "@/lib/frog/dates";
import { dailyFocus } from "@/lib/focus/stats";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90];

type Session = {
  startedAt: Date;
  durationSec: number;
  task: { id: string; title: string; group: { id: string; name: string; color: string; excludeFromReports: boolean } } | null;
};

// Where the focus time went: per day, per project and per task. Sessions on a
// project excluded from reports still count in the totals but aren't named.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const days = Number(sp.get("days") ?? "30");
  const tz = sp.get("tz");
  const today = sp.get("today");
  if (!RANGES.includes(days)) return NextResponse.json({ error: "days must be 7, 30 or 90" }, { status: 400 });
  if (!isValidTimeZone(tz)) return NextResponse.json({ error: "tz must be an IANA time zone" }, { status: 400 });
  if (!isDateKey(today)) return NextResponse.json({ error: "today must be a YYYY-MM-DD date" }, { status: 400 });

  const gte = localDateTimeToInstant(addDays(today, -(days - 1)), "00:00", tz);
  const lt = localDateTimeToInstant(addDays(today, 1), "00:00", tz);

  const sessions: Session[] = await db.focusSession.findMany({
    where: { userId: user.id, startedAt: { gte, lt } },
    select: {
      startedAt: true,
      durationSec: true,
      task: { select: { id: true, title: true, group: { select: { id: true, name: true, color: true, excludeFromReports: true } } } },
    },
  });

  let untrackedSec = 0;
  const byProject = new Map<string, { id: string; name: string; color: string; sec: number }>();
  const byTask = new Map<string, { id: string; title: string; group: { id: string; name: string; color: string }; sec: number; sessions: number }>();
  for (const s of sessions) {
    if (!s.task) { untrackedSec += s.durationSec; continue; }
    const g = s.task.group;
    if (g.excludeFromReports) continue;
    const p = byProject.get(g.id) ?? { id: g.id, name: g.name, color: g.color, sec: 0 };
    p.sec += s.durationSec;
    byProject.set(g.id, p);
    const t = byTask.get(s.task.id) ?? { id: s.task.id, title: s.task.title, group: { id: g.id, name: g.name, color: g.color }, sec: 0, sessions: 0 };
    t.sec += s.durationSec;
    t.sessions += 1;
    byTask.set(s.task.id, t);
  }

  return NextResponse.json({
    totalSec: sessions.reduce((a, s) => a + s.durationSec, 0),
    sessions: sessions.length,
    daily: dailyFocus(sessions, tz, today, days),
    byProject: [...byProject.values()].sort((a, b) => b.sec - a.sec),
    topTasks: [...byTask.values()].sort((a, b) => b.sec - a.sec).slice(0, 10),
    untrackedSec,
  });
}
