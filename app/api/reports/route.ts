import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

type TaskRow = {
  id: string;
  title: string;
  groupId: string;
  statusId: string;
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  createdAt: Date;
  completedAt: Date | null;
};

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const groupId = params.get("groupId") || undefined;
  const rangeParam = params.get("days") || "30";
  const isAllTime = rangeParam === "all";
  const rangeDays = isAllTime ? 0 : Math.min(Math.max(Number(rangeParam) || 30, 7), 365);

  const now = new Date();

  // Projects the user owns, excluding any marked out of reporting entirely —
  // for filter dropdown + per-project breakdown. Excluded projects never
  // appear here, so they can't be reached via groupId either.
  const groups = await db.group.findMany({
    where: { ownerId: user.id, excludeFromReports: false },
    orderBy: { order: "asc" },
    select: { id: true, name: true, color: true },
  });
  const groupIds: string[] = groups.map((g: { id: string }) => g.id);
  const groupById = new Map(groups.map((g: { id: string; name: string; color: string }) => [g.id, g]));

  // Only tasks in the user's (non-excluded) projects, excluding trash.
  // Archived tasks ARE included — archiving is "done & filed", which is
  // exactly what reports track.
  const scopeGroupIds = groupId ? groupIds.filter(id => id === groupId) : groupIds;

  const statuses = await db.status.findMany({
    where: { groupId: { in: scopeGroupIds } },
    select: { id: true, name: true, celebrate: true, groupId: true },
  });
  const doneStatusIds = new Set(
    statuses.filter((s: { celebrate: boolean }) => s.celebrate).map((s: { id: string }) => s.id),
  );

  const tasks: TaskRow[] = await db.task.findMany({
    where: {
      groupId: { in: scopeGroupIds },
      parentTaskId: null,
      deletedAt: null,
    },
    select: {
      id: true, title: true, groupId: true, statusId: true,
      priority: true, createdAt: true, completedAt: true,
    },
  });

  // "All time" spans from the oldest task in scope (min 7 days so the chart
  // always has a real range) rather than a fixed lookback window.
  let windowStart: Date;
  let effectiveRangeDays: number;
  if (isAllTime) {
    const earliest = tasks.reduce<Date | null>((min, t) => (!min || t.createdAt < min ? t.createdAt : min), null);
    windowStart = earliest ? new Date(earliest) : new Date(now.getTime() - 6 * DAY);
    windowStart.setUTCHours(0, 0, 0, 0);
    effectiveRangeDays = Math.max(7, Math.ceil((now.getTime() - windowStart.getTime()) / DAY) + 1);
  } else {
    windowStart = new Date(now.getTime() - (rangeDays - 1) * DAY);
    windowStart.setUTCHours(0, 0, 0, 0);
    effectiveRangeDays = rangeDays;
  }
  // Bucket by week once the range gets long, so the time-series charts stay readable.
  const bucketDays = effectiveRangeDays > 90 ? 7 : 1;

  // ── KPI cards ──────────────────────────────────────────────────────────
  const completedInWindow = tasks.filter(
    t => t.completedAt && t.completedAt >= windowStart,
  );
  const throughput = completedInWindow.length;

  // Cycle time (days) = createdAt → completedAt, over tasks completed in window.
  const cycleTimes = completedInWindow
    .filter(t => t.completedAt)
    .map(t => (t.completedAt!.getTime() - t.createdAt.getTime()) / DAY)
    .filter(d => d >= 0);
  const avgCycleTime = cycleTimes.length
    ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
    : 0;

  // Work in progress = active (not done, not completed) tasks right now.
  const wip = tasks.filter(t => !doneStatusIds.has(t.statusId) && !t.completedAt).length;

  const totalDone = tasks.filter(t => !!t.completedAt).length;
  const completionRate = tasks.length ? Math.round((totalDone / tasks.length) * 100) : 0;

  const createdInWindow = tasks.filter(t => t.createdAt >= windowStart).length;

  // ── Completed tasks list (drill-down for the "Completed" KPI) ──────────
  const completedTasks = completedInWindow
    .slice()
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())
    .map(t => {
      const g = groupById.get(t.groupId) as { name: string; color: string } | undefined;
      return {
        id: t.id,
        title: t.title,
        priority: t.priority,
        completedAt: t.completedAt,
        cycleTimeDays: Math.round(((t.completedAt!.getTime() - t.createdAt.getTime()) / DAY) * 10) / 10,
        projectId: t.groupId,
        projectName: g?.name ?? "Unknown",
        projectColor: g?.color ?? "#B8AFA7",
      };
    });

  // ── Throughput & created per bucket (line/area) ─────────────────────────
  // Bucketed by day normally, by week once the range is long (see bucketDays).
  const bucketCount = Math.ceil(effectiveRangeDays / bucketDays);
  const days: { date: string; completed: number; created: number }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const d = new Date(windowStart.getTime() + i * bucketDays * DAY);
    days.push({ date: dayKey(d), completed: 0, created: 0 });
  }
  const bucketIndex = (d: Date) => Math.min(
    bucketCount - 1,
    Math.max(0, Math.floor((d.getTime() - windowStart.getTime()) / (bucketDays * DAY))),
  );
  for (const t of tasks) {
    if (t.completedAt && t.completedAt >= windowStart) {
      days[bucketIndex(t.completedAt)].completed++;
    }
    if (t.createdAt >= windowStart) {
      days[bucketIndex(t.createdAt)].created++;
    }
  }

  // ── Cumulative Flow Diagram ────────────────────────────────────────────
  // Reconstruct how many tasks sat in "backlog / in-progress / done" buckets
  // at the end of each day. We derive per-task timelines from createdAt (enters
  // the flow) and completedAt (moves to done). Intermediate columns aren't
  // individually timestamped, so we collapse into three flow bands, which is
  // the standard CFD read: total scope, work started, work finished.
  const cfd = days.map((d, i) => {
    const bucketEnd = new Date(windowStart.getTime() + (i + 1) * bucketDays * DAY - 1);
    let created = 0, done = 0;
    for (const t of tasks) {
      if (t.createdAt <= bucketEnd) created++;
      if (t.completedAt && t.completedAt <= bucketEnd) done++;
    }
    return { date: d.date, done, inProgress: Math.max(created - done, 0) };
  });

  // ── Breakdown by priority ──────────────────────────────────────────────
  const priorityOrder = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
  const byPriority = priorityOrder.map(p => {
    const inP = tasks.filter(t => t.priority === p);
    return {
      priority: p,
      total: inP.length,
      done: inP.filter(t => !!t.completedAt).length,
    };
  });

  // ── Breakdown by project ───────────────────────────────────────────────
  const byProject = scopeGroupIds
    .map(gid => {
      const g = groupById.get(gid) as { id: string; name: string; color: string } | undefined;
      const inG = tasks.filter(t => t.groupId === gid);
      return {
        id: gid,
        name: g?.name ?? "Unknown",
        color: g?.color ?? "#B8AFA7",
        total: inG.length,
        done: inG.filter(t => !!t.completedAt).length,
        wip: inG.filter(t => !doneStatusIds.has(t.statusId) && !t.completedAt).length,
        completedInWindow: inG.filter(t => t.completedAt && t.completedAt >= windowStart).length,
      };
    })
    .filter(p => p.total > 0)
    .sort((a, b) => b.total - a.total);

  // ── Recent activity feed ───────────────────────────────────────────────
  const activity = await db.activity.findMany({
    where: { task: { groupId: { in: scopeGroupIds }, deletedAt: null } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true, action: true, createdAt: true,
      task: { select: { title: true, groupId: true } },
    },
  });
  const recentActivity = activity.map((a: {
    id: string; action: string; createdAt: Date;
    task: { title: string; groupId: string } | null;
  }) => ({
    id: a.id,
    action: a.action,
    createdAt: a.createdAt,
    taskTitle: a.task?.title ?? "—",
    projectName: a.task ? (groupById.get(a.task.groupId) as { name: string } | undefined)?.name ?? "" : "",
    projectColor: a.task ? (groupById.get(a.task.groupId) as { color: string } | undefined)?.color ?? "#B8AFA7" : "#B8AFA7",
  }));

  return NextResponse.json({
    range: { days: effectiveRangeDays, start: windowStart.toISOString(), end: now.toISOString(), bucketDays },
    groups,
    kpis: {
      throughput,
      avgCycleTime: Math.round(avgCycleTime * 10) / 10,
      wip,
      completionRate,
      createdInWindow,
      totalTasks: tasks.length,
    },
    days,
    cfd,
    byPriority,
    byProject,
    completedTasks,
    recentActivity,
  });
}
