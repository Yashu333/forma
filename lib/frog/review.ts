import type { TodayCompletedTask, TodayPayload } from "@/types";
import { addDays, isDateKey, isValidTimeZone } from "./dates";
import { activeFrog, isFrogEaten, isTaskDone, streakLabel } from "./dayview";
import { isPlanDate, PLAN_DATE_ERROR } from "./today";
import type { Parsed } from "./validate";

// Pure logic behind "Close the day": the POST /api/today/review body parser
// (used by the route) and the helpers the review flow UI is built from.
// Client-safe: no DB, no React, nothing from today.server.ts.

export type MoveAction = "tomorrow" | "backlog" | "archive";
export const MOVE_ACTIONS: readonly MoveAction[] = ["tomorrow", "backlog", "archive"];

/** Most tasks one review may move (same ceiling as planning a day). */
export const MAX_REVIEW_MOVES = 200;
/** Longest wentWell / improve text, counted after trimming. */
export const MAX_REVIEW_TEXT = 2000;

export interface ReviewMove {
  taskId: string;
  action: MoveAction;
}

/** The body of POST /api/today/review. */
export interface ReviewPostBody {
  date: string;
  tz: string;
  moves: ReviewMove[];
  wentWell?: string | null;
  improve?: string | null;
  rating?: number | null;
  tomorrowFrogTaskId?: string | null;
}

/**
 * A parsed review. For `wentWell`, `improve` and `rating`: `undefined` means the
 * key was absent (leave the stored value alone), `null` means clear it. An empty
 * or whitespace-only text is stored as null: "no reflection" has one spelling.
 */
export interface ReviewInput {
  date: string;
  /** addDays(date, 1), already checked to be a supported plan date. */
  tomorrow: string;
  tz: string;
  moves: ReviewMove[];
  wentWell: string | null | undefined;
  improve: string | null | undefined;
  rating: number | null | undefined;
  /** null: leave tomorrow's plan untouched. */
  tomorrowFrogTaskId: string | null;
}

const fail = (error: string): Parsed<never> => ({ ok: false, error });
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Trimmed text, or null when empty; an error when it is not a string or too long. */
function parseText(v: unknown, field: string): Parsed<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (typeof v !== "string") return fail(`${field} must be a string or null`);
  const text = v.trim();
  if (text.length > MAX_REVIEW_TEXT) return fail(`${field} can be at most ${MAX_REVIEW_TEXT} characters`);
  return { ok: true, value: text === "" ? null : text };
}

/** An integer 1-5 or null. */
export function parseRating(v: unknown): Parsed<number | null> {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) return { ok: true, value: v };
  return fail("rating must be an integer from 1 to 5 or null");
}

/**
 * Validates a POST /api/today/review body. Shape and value problems only (400s):
 * whether the task ids exist and belong to the caller is the route's business
 * (a 404). `date` and tomorrow are both checked against the supported range
 * here, before any DB work, so an unsupported day can never fail after a commit.
 */
export function parseReviewPost(body: unknown): Parsed<ReviewInput> {
  if (!isPlainObject(body)) return fail("Body must be a JSON object");

  if (!isDateKey(body.date)) return fail("date must be a date in YYYY-MM-DD format");
  if (!isPlanDate(body.date)) return fail(PLAN_DATE_ERROR);
  if (!isValidTimeZone(body.tz)) return fail("tz must be an IANA time zone such as Europe/Berlin");
  const tomorrow = addDays(body.date, 1);
  if (!isPlanDate(tomorrow)) return fail("date is too close to the end of the supported calendar to have a next day");

  const { moves, tomorrowFrogTaskId } = body;
  if (!Array.isArray(moves)) return fail("moves must be an array of { taskId, action }");
  if (moves.length > MAX_REVIEW_MOVES) return fail(`moves can hold at most ${MAX_REVIEW_MOVES} entries`);
  const parsedMoves: ReviewMove[] = [];
  const seen = new Set<string>();
  for (const m of moves) {
    if (!isPlainObject(m)) return fail("each move must be an object with taskId and action");
    if (typeof m.taskId !== "string" || m.taskId === "") return fail("move taskId must be a non-empty string");
    if (typeof m.action !== "string" || !(MOVE_ACTIONS as readonly string[]).includes(m.action)) {
      return fail("move action must be one of tomorrow, backlog, archive");
    }
    if (seen.has(m.taskId)) return fail("moves must not contain the same task twice");
    seen.add(m.taskId);
    parsedMoves.push({ taskId: m.taskId, action: m.action as MoveAction });
  }

  const wentWell = parseText(body.wentWell, "wentWell");
  if (!wentWell.ok) return wentWell;
  const improve = parseText(body.improve, "improve");
  if (!improve.ok) return improve;

  let rating: number | null | undefined;
  if (body.rating !== undefined) {
    const r = parseRating(body.rating);
    if (!r.ok) return r;
    rating = r.value;
  }

  if (tomorrowFrogTaskId !== undefined && tomorrowFrogTaskId !== null) {
    if (typeof tomorrowFrogTaskId !== "string" || tomorrowFrogTaskId === "") {
      return fail("tomorrowFrogTaskId must be a task id or null");
    }
    // It has to be on tomorrow's list, so it can't be sent anywhere else.
    const move = parsedMoves.find((m) => m.taskId === tomorrowFrogTaskId);
    if (move && move.action !== "tomorrow") {
      return fail("tomorrowFrogTaskId can't be moved to the backlog or archived");
    }
  }

  return {
    ok: true,
    value: {
      date: body.date,
      tomorrow,
      tz: body.tz,
      moves: parsedMoves,
      wentWell: wentWell.value,
      improve: improve.value,
      rating,
      tomorrowFrogTaskId: (tomorrowFrogTaskId as string | null | undefined) ?? null,
    },
  };
}

// ── The review flow (client) ────────────────────────────────────────────────

/** Open tasks planned for today: the ones the review has to decide about. Input order is kept. */
export function unfinishedTasks<T extends { completedAt?: string | Date | null }>(tasks: readonly T[]): T[] {
  return tasks.filter((t) => !isTaskDone(t));
}

export type MoveChoices = Record<string, MoveAction>;

/** Everything unfinished moves to tomorrow unless the user says otherwise. */
export function initialMoves(unfinished: readonly { id: string }[]): MoveChoices {
  return Object.fromEntries(unfinished.map((t) => [t.id, "tomorrow" as const]));
}

/** The choice for a task; tomorrow when none was made. */
export function moveFor(moves: MoveChoices, id: string): MoveAction {
  return moves[id] ?? "tomorrow";
}

/** The unfinished tasks going to tomorrow, in list order: the candidates for tomorrow's frog. */
export function tomorrowCandidates<T extends { id: string }>(unfinished: readonly T[], moves: MoveChoices): T[] {
  return unfinished.filter((t) => moveFor(moves, t.id) === "tomorrow");
}

/** How many unfinished tasks each action got. */
export function countMoves(unfinished: readonly { id: string }[], moves: MoveChoices): Record<MoveAction, number> {
  const counts: Record<MoveAction, number> = { tomorrow: 0, backlog: 0, archive: 0 };
  for (const t of unfinished) counts[moveFor(moves, t.id)]++;
  return counts;
}

/**
 * Tomorrow's frog for the flow. `choice` is what the user did: undefined = not
 * touched yet (suggest the first candidate, the best one since the list is in
 * compareTasks order), null = an explicit Skip, an id = their pick. A pick that
 * is no longer a candidate (they changed a task's move afterwards) falls back to
 * the suggestion. No candidates, no frog.
 */
export function resolveTomorrowFrog(candidates: readonly { id: string }[], choice: string | null | undefined): string | null {
  if (candidates.length === 0) return null;
  if (choice === null) return null;
  if (choice !== undefined && candidates.some((c) => c.id === choice)) return choice;
  return candidates[0].id;
}

/** The reflection form's state (what the user typed and picked). */
export interface ReflectionDraft {
  rating: number | null;
  wentWell: string;
  improve: string;
}

/** The form prefilled from the stored plan (when reviewing again), else blank. */
export function initialReflection(plan: Pick<NonNullable<TodayPayload["plan"]>, "rating" | "wentWell" | "improve"> | null | undefined): ReflectionDraft {
  return { rating: plan?.rating ?? null, wentWell: plan?.wentWell ?? "", improve: plan?.improve ?? "" };
}

/** The first problem with the reflection, or null. Text counts after trimming, like the server. */
export function reflectionProblem(draft: ReflectionDraft): string | null {
  if (draft.rating !== null && !(Number.isInteger(draft.rating) && draft.rating >= 1 && draft.rating <= 5)) {
    return "Pick a rating from 1 to 5.";
  }
  if (draft.wentWell.trim().length > MAX_REVIEW_TEXT) return `"What went well?" can be at most ${MAX_REVIEW_TEXT} characters.`;
  if (draft.improve.trim().length > MAX_REVIEW_TEXT) return `"What would you do differently?" can be at most ${MAX_REVIEW_TEXT} characters.`;
  return null;
}

/**
 * The POST body for the flow. Only the unfinished tasks get a move (done tasks
 * stay where they are). The reflection is always sent in full: the form is
 * prefilled from the stored plan, so sending it back never loses anything.
 * `tomorrowFrogTaskId` null means "leave tomorrow's plan alone".
 */
export function buildReviewBody(args: {
  date: string;
  tz: string;
  unfinished: readonly { id: string }[];
  moves: MoveChoices;
  reflection: ReflectionDraft;
  tomorrowFrogTaskId: string | null;
}): ReviewPostBody {
  const { date, tz, unfinished, moves, reflection, tomorrowFrogTaskId } = args;
  return {
    date,
    tz,
    moves: unfinished.map((t) => ({ taskId: t.id, action: moveFor(moves, t.id) })),
    wentWell: reflection.wentWell.trim(),
    improve: reflection.improve.trim(),
    rating: reflection.rating,
    tomorrowFrogTaskId,
  };
}

export type StepId = "done" | "unfinished" | "reflect" | "frog";

/** The steps to show: Unfinished needs unfinished tasks, Frog needs a task going to tomorrow. */
export function reviewSteps(hasUnfinished: boolean, hasTomorrowCandidates: boolean): StepId[] {
  const steps: StepId[] = ["done"];
  if (hasUnfinished) steps.push("unfinished");
  steps.push("reflect");
  if (hasTomorrowCandidates) steps.push("frog");
  return steps;
}

export type FrogOutcome = "eaten" | "not-eaten" | "none";

/** Whether today's frog was eaten; "none" when there is no frog (or it was eliminated). */
export function frogOutcome(payload: Pick<TodayPayload, "frog" | "date">, tz: string): FrogOutcome {
  const frog = activeFrog(payload.frog);
  if (!frog) return "none";
  return isFrogEaten(frog, payload.date, tz) ? "eaten" : "not-eaten";
}

/** The short line above the "Done today" list. */
export function doneTodayLine(doneCount: number, outcome: FrogOutcome): string {
  if (outcome === "eaten") return "You ate the frog. The hardest part of the day is behind you.";
  if (doneCount === 0) {
    return outcome === "not-eaten"
      ? "Nothing got ticked off today, and the frog is still waiting. Tomorrow is a fresh start."
      : "Nothing got ticked off today. Tomorrow is a fresh start.";
  }
  const n = `${doneCount} ${doneCount === 1 ? "task" : "tasks"} done today.`;
  return outcome === "not-eaten" ? `${n} The frog is still waiting. Make it your first move tomorrow.` : `${n} Nicely done.`;
}

/** The done list with the frog first, then by completion time (the API sends oldest first). */
export function sortDone(done: readonly TodayCompletedTask[], frogId: string | null): TodayCompletedTask[] {
  return [...done].sort((a, b) => Number(b.id === frogId) - Number(a.id === frogId));
}

export interface ReviewSummary {
  outcome: FrogOutcome;
  frogTitle: string | null;
  doneCount: number;
  streakCurrent: number;
  streakLongest: number;
  streakText: string;
}

/** What the "Day closed" card shows, from the payload the review returned. */
export function summarizeReview(payload: TodayPayload, tz: string): ReviewSummary {
  const frog = activeFrog(payload.frog);
  const { current, longest } = payload.streak;
  return {
    outcome: frogOutcome(payload, tz),
    frogTitle: frog?.title ?? null,
    doneCount: payload.completedToday.length,
    streakCurrent: current,
    streakLongest: longest,
    streakText: streakLabel(current) ?? "No frog streak yet. Eat tomorrow's frog to start one.",
  };
}

/** True once the day was closed (the Today view then shows the Day closed card). */
export function isReviewed(payload: Pick<TodayPayload, "plan">): boolean {
  return payload.plan?.reviewedAt != null;
}
