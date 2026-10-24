import type { Abcde } from "@/types";
import { ABCDE_LETTERS } from "./abcde";
import { isDateKey } from "./dates";

// Input validators for the task fields added by the ABCDE feature. They take
// `unknown` (a parsed JSON body) and never throw, so route handlers can turn a
// failure straight into a 400 and later routes (PUT /api/today ranks) can reuse
// them.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * True when the string contains a NUL ("\u0000"). Postgres text columns and
 * parameters can't hold one ("invalid byte sequence for encoding UTF8: 0x00"),
 * so any client string that reaches the database must be checked first, or the
 * handler throws a 500 instead of answering 400.
 */
export function hasNul(s: string): boolean {
  return s.includes("\u0000");
}

// abcdeRank is stored in a Postgres INT (32-bit); anything above would be a 500.
const MAX_RANK = 2_147_483_647;

/** A letter A-E, or null to clear the label. */
export function parseAbcde(v: unknown): Parsed<Abcde | null> {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "string" && (ABCDE_LETTERS as readonly string[]).includes(v)) {
    return { ok: true, value: v as Abcde };
  }
  return { ok: false, error: "abcde must be one of A, B, C, D, E or null" };
}

/** An integer >= 1, or null for "unranked". */
export function parseAbcdeRank(v: unknown): Parsed<number | null> {
  if (v === null) return { ok: true, value: null };
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_RANK) {
    return { ok: true, value: v };
  }
  return { ok: false, error: "abcdeRank must be an integer >= 1 or null" };
}

/** A real "YYYY-MM-DD" date key, or null for "backlog". */
export function parsePlannedFor(v: unknown): Parsed<string | null> {
  if (v === null) return { ok: true, value: null };
  if (isDateKey(v)) return { ok: true, value: v };
  return { ok: false, error: "plannedFor must be a date in YYYY-MM-DD format or null" };
}
