# Eat That Frog — Progress

Branch: `claude/eat-that-frog` · Spec: [SPEC.md](./SPEC.md) · How it's built: [WORKFLOW.md](./WORKFLOW.md)

## Milestones

- [x] M0 — Test infrastructure (vitest, integration helpers, test DB)
- [x] M1 — Schema + migration + `lib/frog` pure logic
- [x] M2 — ABCDE on tasks (API + TaskDetail + TaskCard)
- [x] M3 — Today API (get / candidates / put)
- [ ] M4 (in progress) — `/today` page: Plan my day + Today view + frog card
- [ ] M5 — Reflect: Close the day + streak
- [ ] M6 — Reports Frog section + dashboard frog card
- [ ] M7 — *(stretch)* Frog-first mode

## Log

<!-- one line per event: date · milestone · what happened · commit -->
- 2026-10-23 · plan · Spec, workflow, agent team and `scripts/test-db.sh` created. Baseline: tsc clean, build OK, lint 16 problems (pre-existing), migrations apply to local Postgres with no drift.
- 2026-10-24 · M0 · Done. Tester: Gate green (unit 2, integration 9). Reviewer: APPROVE, 3 nits. Commit 1998d61.
- 2026-10-24 · M1 · Done. Tester found 1 bug (`addDays` returned garbage out of range), fixed in 1 round; Gate green (unit 235, integration 31, lint 16 = baseline, build OK). Reviewer: APPROVE, 3 nits. Commits 97b801e, b2b58eb.
- 2026-10-24 · M2 · Done. Tester: Gate green first time (unit 276, integration 132) and found a real hole: `PATCH` accepted any `statusId`, including another user's status column. Fixed in 1 round (+ archive/title/priority 400s, 15 hardening tests). Final Gate: unit 276, integration 147, lint 16 = baseline, build OK. Reviewer: APPROVE, no blockers. Commits aa9faad, 3d797bc, 3f2b7ae.
- 2026-10-24 · M3 · Done. Tester wrote 437 integration tests (3 files + helpers) and found 1 bug: dates at the calendar extremes (0000/0001) caused a 500 on GET and a commit-then-500 on PUT. Fixed in 1 round by rejecting dates outside 0001-01-03..9998-12-29 with a 400 (before any write). Final Gate: unit 312, integration 437, lint 16 = baseline, build OK. Reviewer: APPROVE, no blockers. Commits 25ac217, 633b053. **Note:** the message of 633b053 says 'extreme-date tests failing until fix lands', but that commit already contains the fix (it landed between my status check and the commit); the code in it is the green state.

## Decisions

<!-- choices made on the user's behalf during the build -->
- Custom agent types (`frog-*`) didn't load in this session, so the workflow's fallback is used: `general-purpose` agents told to follow `.claude/agents/frog-*.md`.
- vitest pinned at 3.2.7: vitest 5 rejects the project's `@types/node@^20` peer, and 4.1.12 crashed npm's arborist on install. Did not bump `@types/node`.
- `fileParallelism: false` is global in `vitest.config.ts` (vitest 3 only accepts it at the root); integration files share one DB so they run serially.
- Integration setup (Supabase mock + DB reset per test) lives in `tests/integration/setup.ts`; tests must not call a per-file setup function.
- M0 was committed (1998d61) before the reviewer finished, as a checkpoint after the tester passed the Gate; the reviewer then approved it, so no follow-up commit was needed.

- `lib/frog/stats.ts`, spec-open choices (reviewed OK): a plan counts as a planned day only if it has a frog and its date <= today; `beforeNoonRate` = before-noon eaten / eaten days; counts use the last `rangeDays` days ending today inclusive, while streaks use every plan passed in.
- **Note for M6:** query ALL of the user's plans for `frogStats`/streaks (not just the `days` window), or streaks are truncated at the window edge. Run `isValidTimeZone` before `frogStats` (it throws on a bad tz). `evaluatePlan` in `lib/frog/stats.ts` already returns the `{date, planned, eaten, beforeNoon}` shape for `daily[]`. For `excludeFromReports`, filter plans or null their `frogTask`.
- `openAtasks` treats a task as done when `completedAt` is set.

- M2 decisions: setting `abcde` to null also clears `abcdeRank`; changing the letter without sending a rank resets the rank; a non-null rank needs a letter (400 otherwise); `archived` can't be combined with other fields in one PATCH (the UI only ever sends `{archived:true}`); statusId must belong to the task's own group (400). The TaskDetail rank stepper (−/+, cap 99) is a small extra beyond the spec's M2 row.
- **Note for M3:** `lib/frog/validate.ts` (`parseAbcde`, `parseAbcdeRank`, `parsePlannedFor`) is client-safe and reusable. The "rank needs a letter" and "clearing the letter clears the rank" rules live in the PATCH route, not in validate.ts, so `PUT /api/today` `ranks` must apply them itself.

- **Notes for M4/M5/M6 (Today API, `app/api/today/`):**
  - `PUT /api/today`: `frogTaskId` is a required key (null or an id from `taskIds`). `taskIds` is the WHOLE plan: any visible task planned for the date and missing from it gets `plannedFor` cleared, **done tasks included**. `ranks` entries are the full wanted state (`abcde` required; omitted `abcdeRank` = no rank); a null letter with a non-null rank is a 400 (PATCH clears silently instead), so send `{abcde:null, abcdeRank:null}` for 'no letter'. Each `ranks` key must be in `taskIds`. Max 200 tasks.
  - `GET /api/today/candidates` returns a bare array and EXCLUDES done tasks; `GET /api/today` `tasks` INCLUDES done tasks (check `completedAt != null`). So the M4 plan editor must seed `taskIds`/checked state from `GET /api/today` `tasks` and merge candidates in; otherwise 'Edit plan' after eating the frog would un-plan it (and the frog couldn't be re-chosen).
  - `date` must pass `isPlanDate` (0001-01-03..9998-12-29); M5 should use `isPlanDate`/`PLAN_DATE_ERROR` and reuse `visibleTopLevelTask` and `buildTodayPayload` from `lib/frog/today.server.ts`. That file imports the DB: never import it from client code (client-safe: `today.ts`, `abcde.ts`, `dates.ts`, `validate.ts`, `streak.ts`, `stats.ts`).
  - `tasks[].group.doneStatusId` (first celebrate status by order) is what 'done' PATCHes use; null means the project has no Done column. The payload has no exported TS type (`db` is `any`); M4 should add `TodayPayload` types to `types/index.ts`.
  - `completedToday` includes archived tasks (done and filed), excludes deleted; rows carry extra `abcdeRank`, `completedAt`, `group.id`. `frog` is returned even if archived (null if trashed). A PUT race (task trashed between the ownership check and the commit) is a known minor nit.

## Blockers

## Open review findings (non-blocking)

- **Pre-existing security gap, NOT fixed (out of scope):** `GET /api/tasks/[id]` returns any user's task, comments and activity to any logged-in user; `DELETE /api/tasks/[id]` soft-deletes any task by id; `PATCH /api/tasks/reorder` writes `order`/`statusId` for arbitrary ids (including a foreign group's status, and stamps `completedAt`). Worth fixing as a separate change.
- M2 should-fix (can ride into a later milestone): `PATCH /api/tasks/[id]` still returns 500 for an invalid `dueDate` string, a non-string `description` or a non-numeric `order` (old fields, unvalidated).
- M2 nits: title isn't trimmed/capped at 2000 chars (would change existing behaviour); a comment in the PATCH route says abcde validation runs on the archive path, but it's dead there (archived + planning fields is rejected earlier).

- M0 nit: `resetDb` guard checks `process.env.DATABASE_URL`, while `lib/db.ts` captures it at import. Optional hardening: also `SELECT current_database()` and require a `_test` suffix.
- M0 nit: `infra.test.ts` isolation pair relies on in-order execution; would be flaky if `sequence.shuffle` were enabled.

## Morning summary

_Not written yet._
