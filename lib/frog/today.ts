import type { Abcde } from "@/types";
import { isDateKey, isValidTimeZone, localDateKey } from "./dates";
import { parseAbcde, parseAbcdeRank, type Parsed } from "./validate";

// Pure helpers behind /api/today (no DB, safe to import anywhere). The queries
// live in today.server.ts.

/** Most tasks one PUT /api/today may plan. A day this long is already absurd. */
export const MAX_PLAN_TASKS = 200;

export interface TodayPutInput {
  date: string;
  tz: string;
  taskIds: string[];
  /** Desired letter and rank for some of the planned tasks. */
  ranks: Record<string, { abcde: Abcde | null; abcdeRank: number | null }>;
  frogTaskId: string | null;
  finalize: boolean;
}

const fail = (error: string): Parsed<never> => ({ ok: false, error });
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validates a PUT /api/today body. Shape and value problems only: whether the
 * ids exist and belong to the caller is the route's business (that one is a 404).
 *
 * `ranks` entries describe the full wanted state of a task, so a missing
 * `abcdeRank` means "no rank". A rank without a letter is rejected; sending a
 * null letter with a null rank clears both.
 */
export function parseTodayPut(body: unknown): Parsed<TodayPutInput> {
  if (!isPlainObject(body)) return fail("Body must be a JSON object");

  if (!isDateKey(body.date)) return fail("date must be a date in YYYY-MM-DD format");
  if (!isValidTimeZone(body.tz)) return fail("tz must be an IANA time zone such as Europe/Berlin");

  const { taskIds, ranks, frogTaskId, finalize } = body;
  if (!Array.isArray(taskIds)) return fail("taskIds must be an array of task ids");
  if (taskIds.length > MAX_PLAN_TASKS) return fail(`taskIds can hold at most ${MAX_PLAN_TASKS} tasks`);
  for (const id of taskIds) {
    if (typeof id !== "string" || id === "") return fail("taskIds must contain only non-empty strings");
  }
  const ids = taskIds as string[];
  if (new Set(ids).size !== ids.length) return fail("taskIds must not contain duplicates");

  const parsedRanks: TodayPutInput["ranks"] = {};
  if (ranks !== undefined) {
    if (!isPlainObject(ranks)) return fail("ranks must be an object keyed by task id");
    const planned = new Set(ids);
    for (const [id, entry] of Object.entries(ranks)) {
      if (!planned.has(id)) return fail(`ranks has an entry for a task that is not in taskIds: ${id}`);
      if (!isPlainObject(entry)) return fail("each ranks entry must be an object with abcde and abcdeRank");
      const letter = parseAbcde(entry.abcde);
      if (!letter.ok) return fail(letter.error);
      const rank = parseAbcdeRank(entry.abcdeRank === undefined ? null : entry.abcdeRank);
      if (!rank.ok) return fail(rank.error);
      if (letter.value === null && rank.value !== null) return fail("abcdeRank requires an abcde letter");
      parsedRanks[id] = { abcde: letter.value, abcdeRank: rank.value };
    }
  }

  if (frogTaskId !== null && typeof frogTaskId !== "string") {
    return fail("frogTaskId must be a task id or null");
  }
  if (typeof frogTaskId === "string" && !ids.includes(frogTaskId)) {
    return fail("frogTaskId must be one of taskIds");
  }

  if (finalize !== undefined && typeof finalize !== "boolean") return fail("finalize must be a boolean");

  return {
    ok: true,
    value: {
      date: body.date,
      tz: body.tz,
      taskIds: ids,
      ranks: parsedRanks,
      frogTaskId: frogTaskId as string | null,
      finalize: finalize === true,
    },
  };
}

/**
 * A UTC span guaranteed to contain every instant that falls on local day `date`
 * in any time zone (offsets run from UTC-12 to UTC+14), for a coarse DB filter.
 * Returns null when the span would leave the years Postgres timestamps handle
 * sensibly; nothing realistic completes then.
 */
export function utcWindowForLocalDate(date: string): { gte: Date; lt: Date } | null {
  if (!isDateKey(date)) throw new RangeError(`Invalid date key: ${String(date)}`);
  const year = Number(date.slice(0, 4));
  if (year < 1 || year > 9998) return null;
  const midnightUtc = new Date(`${date}T00:00:00Z`).getTime();
  const HOUR = 3_600_000;
  return { gte: new Date(midnightUtc - 14 * HOUR), lt: new Date(midnightUtc + 24 * HOUR + 12 * HOUR) };
}

/** The items whose `completedAt` falls on local day `date` in `tz`, oldest first. */
export function completedOnLocalDate<T extends { completedAt: Date | string | null }>(
  items: readonly T[],
  date: string,
  tz: string,
): T[] {
  return items
    .filter((t) => t.completedAt != null && localDateKey(new Date(t.completedAt), tz) === date)
    .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());
}
