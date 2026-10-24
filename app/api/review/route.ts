import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { addDays, isDateKey, isValidTimeZone, localDateKey, localDateTimeToInstant, localTimeOfDay } from "@/lib/frog/dates";
import { hasNul } from "@/lib/frog/validate";
import { evaluatePlan } from "@/lib/frog/stats";
import { parseRating } from "@/lib/frog/review";
import { visibleTopLevelTask } from "@/lib/frog/today.server";
import { completionRate } from "@/lib/habits/streak";
import { isWeekStart, weekDates, weekStartOf } from "@/lib/review/week";

export const dynamic = "force-dynamic";

const MAX_TEXT = 2000;
const MAX_MOVES = 200;
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

const groupSelect = { select: { id: true, name: true, color: true } } as const;

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const weekStart = sp.get("weekStart");
  const tz = sp.get("tz");
  const today = sp.get("today");
  if (!isDateKey(today)) return bad("today must be a YYYY-MM-DD date");
  if (!isValidTimeZone(tz)) return bad("tz must be an IANA time zone");
  if (!isWeekStart(weekStart)) return bad("weekStart must be a Monday as YYYY-MM-DD");
  if (weekStart > weekStartOf(today)) return bad("weekStart can not be after the current week");

  const dates = weekDates(weekStart);
  const weekEnd = dates[6];
  const nextWeekStart = addDays(weekStart, 7);
  const nextDates = weekDates(nextWeekStart);
  const gte = localDateTimeToInstant(weekStart, "00:00", tz);
  const lt = localDateTimeToInstant(nextWeekStart, "00:00", tz);
  const now = new Date();
  const slippedBefore = lt < now ? lt : now; // due in the week, and already past

  const [doneRows, plans, slippedRows, focus, habits, review, nextPlans, candidates] = await Promise.all([
    db.task.findMany({
      where: { parentTaskId: null, deletedAt: null, group: { ownerId: user.id }, completedAt: { gte, lt } },
      orderBy: { completedAt: "asc" },
      take: 500,
      select: { id: true, title: true, completedAt: true, group: groupSelect },
    }),
    db.dailyPlan.findMany({
      where: { userId: user.id, date: { in: dates } },
      select: { date: true, wentWell: true, improve: true, rating: true, frogTask: { select: { id: true, title: true, completedAt: true } } },
    }),
    db.task.findMany({
      where: {
        ...visibleTopLevelTask(user.id),
        status: { celebrate: false },
        OR: [
          { dueDate: { gte, lt: slippedBefore } },
          { plannedFor: { in: dates.filter((d) => d < today) } },
        ],
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: 200,
      select: { id: true, title: true, dueDate: true, plannedFor: true, abcde: true, abcdeRank: true, group: groupSelect },
    }),
    db.focusSession.aggregate({
      where: { userId: user.id, startedAt: { gte, lt } },
      _sum: { durationSec: true },
      _count: true,
    }),
    db.habit.findMany({
      where: { userId: user.id, archivedAt: null },
      select: { weekdays: true, createdAt: true, checks: { where: { date: { in: dates } }, select: { date: true } } },
    }),
    db.weeklyReview.findUnique({ where: { userId_weekStart: { userId: user.id, weekStart } } }),
    db.dailyPlan.findMany({
      where: { userId: user.id, date: { in: nextDates } },
      select: { date: true, plannedAt: true, frogTask: { select: { id: true, title: true } } },
    }),
    db.task.findMany({
      where: { ...visibleTopLevelTask(user.id), status: { celebrate: false } },
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
      select: { id: true, title: true, abcde: true, abcdeRank: true, group: groupSelect },
    }),
  ]);

  type Plan = (typeof plans)[number];
  const frogDays = dates.map((date) => {
    const plan = plans.find((p: Plan) => p.date === date);
    const day = evaluatePlan({ date, frogTask: plan?.frogTask ?? null }, tz);
    return { date, planned: day.planned, eaten: day.eaten, title: plan?.frogTask?.title ?? null };
  });
  const ratings = plans.map((p: Plan) => p.rating).filter((r: number | null): r is number => r !== null);

  let habitScheduled = 0;
  let habitDone = 0;
  const lastDay = weekEnd < today ? weekEnd : today;
  for (const h of habits as { weekdays: number[]; createdAt: Date; checks: { date: string }[] }[]) {
    if (lastDay < weekStart) continue;
    const r = completionRate(h.weekdays, new Set(h.checks.map((c) => c.date)), weekStart, lastDay, localDateKey(h.createdAt, tz));
    habitScheduled += r.scheduled;
    habitDone += r.done;
  }

  type Next = (typeof nextPlans)[number];
  return NextResponse.json({
    weekStart,
    weekEnd,
    nextWeekStart,
    review: review
      ? { win: review.win, obstacle: review.obstacle, focus: review.focus, rating: review.rating, reviewedAt: review.reviewedAt }
      : null,
    stats: {
      tasksDone: doneRows.length,
      frogs: { planned: frogDays.filter((d: { planned: boolean }) => d.planned).length, eaten: frogDays.filter((d: { eaten: boolean }) => d.eaten).length, days: frogDays },
      focusSec: focus._sum.durationSec ?? 0,
      focusSessions: focus._count,
      habits: habitScheduled > 0 ? { scheduled: habitScheduled, done: habitDone } : null,
      avgRating: ratings.length ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : null,
      ratedDays: ratings.length,
    },
    done: doneRows,
    dailyNotes: plans
      .filter((p: Plan) => p.wentWell || p.improve)
      .sort((a: Plan, b: Plan) => a.date.localeCompare(b.date))
      .map((p: Plan) => ({ date: p.date, wentWell: p.wentWell, improve: p.improve, rating: p.rating })),
    slipped: slippedRows.map((t: { dueDate: Date | null }) => ({ ...t, time: t.dueDate ? localTimeOfDay(t.dueDate, tz) : null })),
    nextWeek: {
      dates: nextDates,
      frogs: Object.fromEntries(nextDates.map((d) => {
        const p = nextPlans.find((x: Next) => x.date === d);
        return [d, p?.frogTask ? { id: p.frogTask.id, title: p.frogTask.title, planned: p.plannedAt != null } : null];
      })),
    },
    candidates,
  });
}

type Action = "keep" | "nextWeek" | "backlog" | "archive";
const ACTIONS: readonly string[] = ["keep", "nextWeek", "backlog", "archive"];

function parseText(v: unknown, name: string): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${name} must be text` };
  const t = v.trim();
  if (t.length > MAX_TEXT) return { ok: false, error: `${name} must be ${MAX_TEXT} characters or fewer` };
  if (hasNul(t)) return { ok: false, error: `${name} must not contain NUL characters` };
  return { ok: true, value: t === "" ? null : t };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");

  const { weekStart, tz, today } = body;
  if (!isDateKey(today)) return bad("today must be a YYYY-MM-DD date");
  if (!isValidTimeZone(tz)) return bad("tz must be an IANA time zone");
  if (!isWeekStart(weekStart)) return bad("weekStart must be a Monday as YYYY-MM-DD");
  if (weekStart > weekStartOf(today)) return bad("weekStart can not be after the current week");
  const nextWeekStart = addDays(weekStart, 7);
  const nextDates = weekDates(nextWeekStart);

  const moves: { taskId: string; action: Action }[] = [];
  if (body.moves !== undefined) {
    if (!Array.isArray(body.moves) || body.moves.length > MAX_MOVES) return bad(`moves must be a list of at most ${MAX_MOVES}`);
    const seen = new Set<string>();
    for (const m of body.moves) {
      if (!m || typeof m.taskId !== "string" || !m.taskId || hasNul(m.taskId) || !ACTIONS.includes(m.action)) {
        return bad("each move needs a taskId and an action: keep, nextWeek, backlog or archive");
      }
      if (seen.has(m.taskId)) return bad("a task can only appear once in moves");
      seen.add(m.taskId);
      if (m.action !== "keep") moves.push({ taskId: m.taskId, action: m.action });
    }
  }

  const frogs: { date: string; taskId: string | null }[] = [];
  if (body.frogs !== undefined) {
    if (!Array.isArray(body.frogs) || body.frogs.length > 7) return bad("frogs must be a list of at most 7 days");
    const days = new Set<string>();
    const tasks = new Set<string>();
    for (const f of body.frogs) {
      if (!f || !nextDates.includes(f.date)) return bad("each frog needs a date in the week after the reviewed week");
      if (days.has(f.date)) return bad("each day can have only one frog");
      days.add(f.date);
      if (f.taskId !== null && (typeof f.taskId !== "string" || !f.taskId || hasNul(f.taskId))) return bad("taskId must be a task id or null");
      if (f.taskId) {
        if (tasks.has(f.taskId)) return bad("a task can be the frog of one day only");
        tasks.add(f.taskId);
      }
      frogs.push({ date: f.date, taskId: f.taskId });
    }
  }
  // A frog needs to stay on the plan, so it can not also be sent off it.
  const leaving = new Set(moves.filter((m) => m.action === "backlog" || m.action === "archive").map((m) => m.taskId));
  if (frogs.some((f) => f.taskId && leaving.has(f.taskId))) return bad("A task can not be a frog and also go to the backlog or archive");

  const win = parseText(body.win, "win");
  const obstacle = parseText(body.obstacle, "obstacle");
  const focus = parseText(body.focus, "focus");
  for (const t of [win, obstacle, focus]) if (!t.ok) return bad(t.error);
  const rating = body.rating === undefined ? undefined : parseRating(body.rating);
  if (rating && !rating.ok) return bad(rating.error);

  // Every task named must be the caller's, top-level, and not in the trash or archive.
  const ids = [...new Set([...moves.map((m) => m.taskId), ...frogs.flatMap((f) => (f.taskId ? [f.taskId] : []))])];
  const owned: { id: string; dueDate: Date | null; plannedFor: string | null }[] = ids.length
    ? await db.task.findMany({ where: { id: { in: ids }, ...visibleTopLevelTask(user.id) }, select: { id: true, dueDate: true, plannedFor: true } })
    : [];
  if (owned.length !== ids.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ownedById = new Map(owned.map((t) => [t.id, t]));

  const now = new Date();
  const text = {
    ...(win.ok && win.value !== undefined && { win: win.value }),
    ...(obstacle.ok && obstacle.value !== undefined && { obstacle: obstacle.value }),
    ...(focus.ok && focus.value !== undefined && { focus: focus.value }),
    ...(rating?.ok && { rating: rating.value }),
  };

  await db.$transaction(async (tx: typeof db) => {
    const archived: string[] = [];
    for (const { taskId, action } of moves) {
      const task = ownedById.get(taskId)!;
      if (action === "nextWeek") {
        // Due dates keep their time of day; a task without one is planned for that Monday.
        const data: Record<string, unknown> = {};
        if (task.dueDate) data.dueDate = localDateTimeToInstant(nextWeekStart, localTimeOfDay(task.dueDate, tz), tz);
        if (task.plannedFor || !task.dueDate) data.plannedFor = nextWeekStart;
        await tx.task.update({ where: { id: taskId }, data });
      } else if (action === "backlog") {
        await tx.task.update({ where: { id: taskId }, data: { plannedFor: null, dueDate: null } });
      } else {
        archived.push(taskId);
      }
    }
    if (archived.length) {
      // Same as the archive PATCH: the task and its subtasks, plus an activity row.
      await tx.task.updateMany({ where: { OR: [{ id: { in: archived } }, { parentTaskId: { in: archived } }] }, data: { archivedAt: now } });
      await tx.activity.createMany({ data: archived.map((taskId) => ({ taskId, userId: user.id, action: "archived" })) });
    }

    await tx.weeklyReview.upsert({
      where: { userId_weekStart: { userId: user.id, weekStart } },
      create: { userId: user.id, weekStart, ...text, reviewedAt: now },
      update: { ...text, reviewedAt: now },
    });

    // plannedAt stays null on a new plan, so that morning's planning still runs with the frog preselected.
    for (const { date, taskId } of frogs) {
      if (taskId) {
        await tx.task.update({ where: { id: taskId }, data: { plannedFor: date } });
        await tx.dailyPlan.upsert({
          where: { userId_date: { userId: user.id, date } },
          create: { userId: user.id, date, frogTaskId: taskId },
          update: { frogTaskId: taskId },
        });
      } else {
        await tx.dailyPlan.updateMany({ where: { userId: user.id, date, plannedAt: null }, data: { frogTaskId: null } });
      }
    }
  });

  return NextResponse.json({ ok: true });
}
