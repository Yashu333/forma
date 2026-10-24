// The fetch calls the weekly review makes. Each throws an Error carrying the
// server's `{ error }` message so the UI can show it.

export type MoveAction = "keep" | "nextWeek" | "backlog" | "archive";

interface GroupRef {
  id: string;
  name: string;
  color: string;
}

export interface ReviewData {
  weekStart: string;
  weekEnd: string;
  nextWeekStart: string;
  review: { win: string | null; obstacle: string | null; focus: string | null; rating: number | null; reviewedAt: string | null } | null;
  stats: {
    tasksDone: number;
    frogs: { planned: number; eaten: number; days: { date: string; planned: boolean; eaten: boolean; title: string | null }[] };
    focusSec: number;
    focusSessions: number;
    habits: { scheduled: number; done: number } | null;
    avgRating: number | null;
    ratedDays: number;
  };
  done: { id: string; title: string; completedAt: string; group: GroupRef }[];
  dailyNotes: { date: string; wentWell: string | null; improve: string | null; rating: number | null }[];
  slipped: { id: string; title: string; dueDate: string | null; plannedFor: string | null; abcde: string | null; abcdeRank: number | null; time: string | null; group: GroupRef }[];
  nextWeek: {
    dates: string[];
    frogs: Record<string, { id: string; title: string; planned: boolean } | null>;
  };
  candidates: { id: string; title: string; abcde: string | null; abcdeRank: number | null; group: GroupRef }[];
}

export interface ReviewSave {
  weekStart: string;
  tz: string;
  today: string;
  moves: { taskId: string; action: MoveAction }[];
  win: string;
  obstacle: string;
  focus: string;
  rating: number | null;
  frogs: { date: string; taskId: string | null }[];
}

async function check(res: Response, fallback: string): Promise<Response> {
  if (!res.ok) {
    let message = fallback;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // not JSON: keep the fallback
    }
    throw new Error(message);
  }
  return res;
}

export async function fetchReview(weekStart: string, today: string, tz: string, signal?: AbortSignal): Promise<ReviewData> {
  const qs = new URLSearchParams({ weekStart, today, tz });
  return (await check(await fetch(`/api/review?${qs}`, { signal }), "Couldn't load the review")).json();
}

export async function saveReview(body: ReviewSave): Promise<void> {
  await check(
    await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    "Couldn't save the review",
  );
}

export interface ReviewStatus {
  weekStart: string;
  nudge: boolean;
  thisWeekFocus: string | null;
}

export async function fetchReviewStatus(today: string, signal?: AbortSignal): Promise<ReviewStatus> {
  const qs = new URLSearchParams({ today });
  return (await check(await fetch(`/api/review/status?${qs}`, { signal }), "Couldn't load the review status")).json();
}
