# Eat That Frog — Progress

Branch: `claude/eat-that-frog` · Spec: [SPEC.md](./SPEC.md) · How it's built: [WORKFLOW.md](./WORKFLOW.md)

## Milestones

- [x] M0 — Test infrastructure (vitest, integration helpers, test DB)
- [x] M1 — Schema + migration + `lib/frog` pure logic
- [x] M2 — ABCDE on tasks (API + TaskDetail + TaskCard)
- [x] M3 — Today API (get / candidates / put)
- [x] M4 — `/today` page: Plan my day + Today view + frog card
- [x] M5 — Reflect: Close the day + streak
- [x] M6 — Reports Frog section + dashboard frog card
- [ ] M7 (in progress) — *(stretch)* Frog-first mode

## Log

<!-- one line per event: date · milestone · what happened · commit -->
- 2026-10-23 · plan · Spec, workflow, agent team and `scripts/test-db.sh` created. Baseline: tsc clean, build OK, lint 16 problems (pre-existing), migrations apply to local Postgres with no drift.
- 2026-10-24 · M0 · Done. Tester: Gate green (unit 2, integration 9). Reviewer: APPROVE, 3 nits. Commit 1998d61.
- 2026-10-24 · M1 · Done. Tester found 1 bug (`addDays` returned garbage out of range), fixed in 1 round; Gate green (unit 235, integration 31, lint 16 = baseline, build OK). Reviewer: APPROVE, 3 nits. Commits 97b801e, b2b58eb.
- 2026-10-24 · M2 · Done. Tester: Gate green first time (unit 276, integration 132) and found a real hole: `PATCH` accepted any `statusId`, including another user's status column. Fixed in 1 round (+ archive/title/priority 400s, 15 hardening tests). Final Gate: unit 276, integration 147, lint 16 = baseline, build OK. Reviewer: APPROVE, no blockers. Commits aa9faad, 3d797bc, 3f2b7ae.
- 2026-10-24 · M3 · Done. Tester wrote 437 integration tests (3 files + helpers) and found 1 bug: dates at the calendar extremes (0000/0001) caused a 500 on GET and a commit-then-500 on PUT. Fixed in 1 round by rejecting dates outside 0001-01-03..9998-12-29 with a 400 (before any write). Final Gate: unit 312, integration 437, lint 16 = baseline, build OK. Reviewer: APPROVE, no blockers. Commits 25ac217, 633b053, 29f3500. **Note:** the message of 633b053 says 'extreme-date tests failing until fix lands', but that commit already contains the fix (it landed between my status check and the commit); the code in it is the green state.
- 2026-10-24 · M4 · Done. Tester added UI test tooling (jsdom + Testing Library, `npm run test:ui`, 115 UI tests) and 89 adversarial unit tests, did a Playwright visual pass at 375/1280px (no overflow), and found 2 bugs: a stale background refresh could overwrite newer state, and a React style-prop conflict on the frog card. Both fixed in 1 round with 6 polish items (radio keyboard pattern, hint, explicit purple instead of the redefined `--accent`, contrast). Reviewer: APPROVE + 1 real bug (an Eliminated E-frog came back from the server as a live frog card with an enabled 'Ate it'; the test double had hidden it by nulling the frog), fixed with a client-side `activeFrog` helper, a stepper scroll reset, row aria groups and a shared `lib/frog/clock.ts`. Final Gate: unit 473, UI 115 (stable x2), integration 437, lint 16 = baseline, build OK. Commits 07d683b, 88082af, 306d241, 14f0432 plus the fix commit below.
- 2026-10-24 · M5 · Done. Tester wrote 171 integration tests for the review route + 86 adversarial unit tests + 150 UI tests and did a Playwright pass at 320/375/1280px; found 1 bug: a NUL character (`\u0000`) in the reflection text or a task id reached Postgres and caused a 500 (fixed in 1 round with a shared `hasNul` helper applied to the review route, PUT /api/today and the new PATCH checks; also a 320px stepper wrap). Final Gate: unit 656, UI 246 (stable x2), integration 608, lint 16 = baseline, build OK. Reviewer: APPROVE, no blockers; 1 SHOULD-FIX queued for the M6 developer (see below). Commits 05caa5d, 3ffa09b, 1d4e1b8.
- 2026-10-24 · M6 · Done. Tester wrote 143 integration tests for `/api/reports/frog` (+ a `/api/reports` regression test), 100 edge unit tests and ~160 UI tests, did a Playwright pass at 320/375/1280px (no overflow from M6; the one 320px overflow is the pre-existing Reports header filter row), found no product bugs. Reviewer: APPROVE, no blockers, 2 SHOULD-FIX (applied in 1 round): the excludeFromReports streak mismatch (see the deliberate-deviation decision below) and the Frog section vanishing for an empty project / failed `/api/reports`; plus 3 nits (all-time subtitle, '0%' with 0 planned, non-colour cue on calendar cells). Final Gate: unit 814, UI 416 (stable x2), integration 752, lint 16 = baseline, build OK. Commits 990bb0e, 5ca0874 plus the fix commit.

## Decisions

<!-- choices made on the user's behalf during the build -->
- Custom agent types (`frog-*`) didn't load in this session, so the workflow's fallback is used: `general-purpose` agents told to follow `.claude/agents/frog-*.md`.
- vitest pinned at 3.2.7: vitest 5 rejects the project's `@types/node@^20` peer, and 4.1.12 crashed npm's arborist on install. Did not bump `@types/node`.
- `fileParallelism: false` is global in `vitest.config.ts` (vitest 3 only accepts it at the root); integration files share one DB so they run serially.
- Integration setup (Supabase mock + DB reset per test) lives in `tests/integration/setup.ts`; tests must not call a per-file setup function.
- M0 was committed (1998d61) before the reviewer finished, as a checkpoint after the tester passed the Gate; the reviewer then approved it, so no follow-up commit was needed.
- M6 deliberate deviation from the literal spec: frog stats/streaks and the Reports streak ignore `excludeFromReports` (so Reports, /today and the dashboard chip show the same streak); only `abcdeCompleted` honours it, and an excluded project's task titles are blanked in the reflections journal. To restore the literal spec, null `frogTask` for excluded groups in app/api/reports/frog/route.ts.

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

- M4 decisions: no 'no frog today' option (a plan needs a task and a frog; the frog step preselects the suggestion, A-1 or the first open task); done is one-way from `/today` (the checkbox locks, 'Reopen on board' links to the project board); task titles link to `/group/[id]` instead of embedding TaskDetail (no endpoint returns a group's statuses); ranks are sent as full state only for tasks whose letter or rank changed, and `taskIds` is always the whole selection including done tasks; 'Eaten at H:MM' is 24-hour in the browser tz; the active-step colour is an explicit `#7C6EF8` (`ACCENT` in `components/today/bits.tsx`) because `--accent` is redefined to `--elevated` in globals.css (pre-existing, app-wide: it also makes `btn-primary` dark until hover); `Close the day` is a disabled stub until M5.
- **Notes for M5/M6 (UI):** `TodayView` owns data loading, refresh sequencing (`refreshSeq` + `localVersion`: older refreshes are dropped), and the date rollover (swaps in the skeleton and discards stepper/review state). `TodayDay` gets `payload`, `tz`, `onChange`, `onRefresh` and has a header slot for 'Close the day'. `lib/frog/clock.ts` exports `useLocalClock()` (browser date + tz, null on the server) for M6's dashboard card. `components/today/api.ts` has the fetch layer; `lib/frog/dayview.ts`/`plan.ts` hold pure UI logic; `activeFrog()` hides an archived-and-uneaten frog. UI tests mock `fetch` via `tests/ui/fixtures.ts` (`mockApi`); the API test doubles must mirror what the real server returns (an archived frog is still returned).
- Test tooling: `npm test` (unit, node), `npm run test:ui` (jsdom), `npm run test:integration` (real Postgres; shared test DB, so never run two integration runs at once). jsdom is pinned at 26 (27+ needs Node >= 22.12 and the box has 22.22 but keep margin).

- M5 decisions: omitted `wentWell`/`improve`/`rating` leave the stored value alone, `null` clears it, empty/whitespace text is stored as null, text over 2000 chars (after trim) is a 400; `tomorrowFrogTaskId` absent/null leaves tomorrow's plan untouched (the UI's 'Skip' sends null); a set frog upserts tomorrow's plan with `frogTaskId` only (`plannedAt` stays null on create, an existing one is kept); a frog id that is also moved to backlog/archive is a 400; an edited review that sends tomorrow's frog to backlog/archive clears tomorrow's `frogTaskId` (developer's addition); `date` AND date+1 must be in the supported range (so 9998-12-29 is rejected); `moves` accepts any visible top-level task (done ones too, `completedAt` is never cleared); archive sets `archivedAt` on the task and its subtasks with one 'archived' activity row each; each POST re-stamps `reviewedAt`. UI: steps with nothing to decide are left out (Unfinished when nothing is open, Tomorrow's frog when nothing moves to tomorrow); on 'Edit review' only the reflection is editable (moved tasks have left `payload.tasks`), safe (sends moves [] and null frog).
- **Queued for M6 developer (M5 reviewer SHOULD-FIX):** on a closed day (`plan.reviewedAt` set) an uneaten frog that was moved to tomorrow/backlog still shows an enabled 'Ate it' in the hero card. Fix: pass `closed={reviewed}` to FrogCard and render 'Not eaten today.' instead of the button; add a UI test.
- Known limitation: retrying a review POST that already committed an `archive` move gets a persistent 404 (archived tasks no longer pass `visibleTopLevelTask`); non-archive bodies re-POST cleanly.
- NUL character hole (Postgres 22021 → 500) still exists in PRE-EXISTING routes, left alone: GET/DELETE `/api/tasks/[id]`, `/api/tasks/reorder` (no validation at all), PATCH `dueDate`/`order`, and likely `app/api/tasks` POST, comments, groups, user-settings and spotify routes (not inspected).

## Blockers

## Open review findings (non-blocking)

- M4 nits left alone: `ConfirmDialog`'s effect depends on `[onCancel]` and TodayDay passes an inline arrow (re-focuses Confirm on each render while open; harmless today, use a stable callback if M5 adds renders while the dialog is open); `process.env.TZ` is set inside `tests/ui/setup.ts` (works; a `test.env` entry would be less order-sensitive); a midnight rollover while planning/reviewing discards the in-progress form; the frog step always preselects the suggestion, so 'Save disabled until a frog is chosen' is unreachable. `ConfirmDialog` has no `role="dialog"`/`aria-modal` (pre-existing).
- M4 edge: a frog completed on a LATER day and then archived is shown by `activeFrog` (it has `completedAt`) although `isFrogEaten` is false for that plan date, so it would get an 'Ate it' button. Very rare.

- **Pre-existing security gap, NOT fixed (out of scope):** `GET /api/tasks/[id]` returns any user's task, comments and activity to any logged-in user; `DELETE /api/tasks/[id]` soft-deletes any task by id; `PATCH /api/tasks/reorder` writes `order`/`statusId` for arbitrary ids (including a foreign group's status, and stamps `completedAt`). Worth fixing as a separate change.
- M2 should-fix (can ride into a later milestone): `PATCH /api/tasks/[id]` still returns 500 for an invalid `dueDate` string, a non-string `description` or a non-numeric `order` (old fields, unvalidated).
- M2 nits: title isn't trimmed/capped at 2000 chars (would change existing behaviour); a comment in the PATCH route says abcde validation runs on the archive path, but it's dead there (archived + planning fields is rejected earlier).

- M0 nit: `resetDb` guard checks `process.env.DATABASE_URL`, while `lib/db.ts` captures it at import. Optional hardening: also `SELECT current_database()` and require a `_test` suffix.
- M0 nit: `infra.test.ts` isolation pair relies on in-order execution; would be flaky if `sequence.shuffle` were enabled.

## Morning summary

_Not written yet._
