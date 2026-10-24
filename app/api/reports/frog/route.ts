import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { frogStats } from "@/lib/frog/stats";
import { utcWindowForLocalDate } from "@/lib/frog/today";
import {
  MAX_REFLECTIONS,
  bucketAbcde,
  buildDailyStrip,
  buildReflections,
  earliestPlanDate,
  parseFrogReportQuery,
  rangeStart,
  type FrogReport,
} from "@/lib/frog/reports";

export const dynamic = "force-dynamic";

type PlanRow = {
  date: string;
  frogTask: { completedAt: Date | null; groupId: string } | null;
};
type ReflectionRow = {
  date: string;
  reviewedAt: Date | null;
  rating: number | null;
  wentWell: string | null;
  improve: string | null;
  frogTask: { completedAt: Date | null; title: string; groupId: string } | null;
};

/**
 * Frog report for the Reports page.
 *
 * excludeFromReports (deliberate deviation from the literal spec): the setting
 * hides a project's tasks from the task reports, but a daily frog streak is a
 * user-level habit, and the streak here must equal the one /api/today and the
 * dashboard chip show. So frog stats and the calendar count every plan whose
 * frog sits in one of the user's own projects, excluded or not. Only `abcdeCompleted` honours the setting (it counts
 * tasks, like /api/reports), and the reflections journal blanks the TITLE of a
 * frog in an excluded project so its task names don't leak into Reports (the day
 * itself still counts as eaten or not). A frog task in the trash still counts,
 * like the streak in /api/today.
 *
 * Streaks and counts come from ALL of the user's plans (userId filter), so a
 * streak isn't cut at the window edge. `days` is clamped 7..365 or "all";
 * `daily` is capped at 400 days for "all" while `stats` cover everything.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // "Today" is whatever the browser says it is; the server clock is never used.
  const parsed = parseFrogReportQuery(new URL(req.url).searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { tz, today, days } = parsed.value;

  const groups: { id: string; excludeFromReports: boolean }[] = await db.group.findMany({
    where: { ownerId: user.id },
    select: { id: true, excludeFromReports: true },
  });
  const owned = new Set(groups.map((g) => g.id));
  const groupIds = groups.filter((g) => !g.excludeFromReports).map((g) => g.id);
  const inScope = new Set(groupIds);

  const [planRows, reflectionRows]: [PlanRow[], ReflectionRow[]] = await Promise.all([
    db.dailyPlan.findMany({
      where: { userId: user.id },
      select: { date: true, frogTask: { select: { completedAt: true, groupId: true } } },
    }),
    db.dailyPlan.findMany({
      where: {
        userId: user.id,
        date: { lte: today },
        reviewedAt: { not: null },
        OR: [{ rating: { not: null } }, { wentWell: { not: null } }, { improve: { not: null } }],
      },
      orderBy: { date: "desc" },
      take: MAX_REFLECTIONS,
      select: {
        date: true, reviewedAt: true, rating: true, wentWell: true, improve: true,
        frogTask: { select: { completedAt: true, title: true, groupId: true } },
      },
    }),
  ]);

  // Stats and the calendar count every frog in the user's own projects, excluded
  // or not (see the doc comment). A frog in someone else's project can't be set
  // through the API, but is never followed if a row points at one. In the journal
  // an excluded project's frog keeps `eaten` correct but loses its title.
  const plans = planRows.map((p) => ({ date: p.date, frogTask: p.frogTask && owned.has(p.frogTask.groupId) ? p.frogTask : null }));
  const reflectionPlans = reflectionRows.map((p) => ({
    ...p,
    frogTask: p.frogTask && owned.has(p.frogTask.groupId)
      ? { ...p.frogTask, title: inScope.has(p.frogTask.groupId) ? p.frogTask.title : null }
      : null,
  }));

  const start = rangeStart(today, days, earliestPlanDate(plans, today));
  const stats = frogStats(plans, tz, today, days);
  const daily = buildDailyStrip(plans, tz, start, today);

  // Completed top-level tasks (archived included, trash excluded, like
  // /api/reports). The DB filter is a coarse UTC window; bucketAbcde then
  // judges the exact local day. "all" has no lower bound.
  const completedWindow: { gte?: Date; lt?: Date } = {};
  if (days !== "all") {
    const lo = utcWindowForLocalDate(start);
    if (lo) completedWindow.gte = lo.gte;
  }
  const hi = utcWindowForLocalDate(today);
  if (hi) completedWindow.lt = hi.lt;
  const completed: { abcde: "A" | "B" | "C" | "D" | "E" | null; completedAt: Date }[] = groupIds.length
    ? await db.task.findMany({
        where: { groupId: { in: groupIds }, parentTaskId: null, deletedAt: null, completedAt: { not: null, ...completedWindow } },
        select: { abcde: true, completedAt: true },
      })
    : [];
  const abcdeCompleted = bucketAbcde(completed, tz, days === "all" ? null : start, today);

  const report: FrogReport = {
    stats,
    daily,
    abcdeCompleted,
    reflections: buildReflections(reflectionPlans, tz, today),
  };
  return NextResponse.json(report);
}
