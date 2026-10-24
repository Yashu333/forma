import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { addDays, isDateKey } from "@/lib/frog/dates";
import { defaultReviewWeek, isReviewNudgeDay, weekStartOf } from "@/lib/review/week";

export const dynamic = "force-dynamic";

// What Today needs to know about the weekly review: whether to nudge for the
// week that is up for review, and last week's "one focus" to show this week.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new URL(req.url).searchParams.get("today");
  if (!isDateKey(today)) return NextResponse.json({ error: "today must be a YYYY-MM-DD date" }, { status: 400 });

  const reviewWeek = defaultReviewWeek(today);
  const lastWeek = addDays(weekStartOf(today), -7);
  const rows: { weekStart: string; focus: string | null; reviewedAt: Date | null }[] = await db.weeklyReview.findMany({
    where: { userId: user.id, weekStart: { in: [reviewWeek, lastWeek] } },
    select: { weekStart: true, focus: true, reviewedAt: true },
  });

  const reviewed = rows.some((r) => r.weekStart === reviewWeek && r.reviewedAt != null);
  return NextResponse.json({
    weekStart: reviewWeek,
    nudge: isReviewNudgeDay(today) && !reviewed,
    thisWeekFocus: rows.find((r) => r.weekStart === lastWeek)?.focus ?? null,
  });
}
