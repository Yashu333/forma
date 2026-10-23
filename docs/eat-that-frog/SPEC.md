# Eat That Frog — Feature Spec

Brings three ideas from Brian Tracy's *Eat That Frog!* into Forma:

1. **Eat the frog** — every day has exactly one *frog*: the most important task, done first.
2. **ABCDE method** — label tasks by consequence (A must / B should / C nice / D delegate / E eliminate) and never do a B while an A is open.
3. **Reflect** — close each day: see what got done, decide what happens to unfinished work, write a short reflection, pick tomorrow's frog. Track frog streaks over time.

**Out of scope for this build:** Pomodoro ↔ task linking, Goals / key result areas, the weekly "creative procrastination" sweep, and changes to the existing dashboard THINK/PLAN/DO/REFLECT strip. Do not touch `app/(timer)/pomodoro/` or the Spotify code.

---

## Product decisions (already made — do not re-litigate)

| Question | Decision |
|---|---|
| ABCDE vs existing priority | **Separate field.** `priority` (Urgent/High/Medium/Low) stays untouched. ABCDE is nullable and added alongside it. |
| Where the daily flow lives | **New `/today` page** in the `(app)` route group, with a sidebar link between Dashboard and Pomodoro. |
| Frog strictness | Frog is **highlighted** by default. An optional **frog-first mode** (user setting, off by default) dims other tasks until the frog is eaten — milestone M7, stretch. |
| How "today" is defined | The **user's local date**, sent by the browser as `YYYY-MM-DD` plus an IANA time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). The server never uses its own clock to decide what "today" is. |
| One frog per day | Enforced by `DailyPlan` having one `frogTaskId` and `@@unique([userId, date])`. |

---

## Data model

Add to `prisma/schema.prisma`:

```prisma
enum Abcde {
  A
  B
  C
  D
  E
}

model Task {
  // ...existing fields...
  abcde       Abcde?
  abcdeRank   Int?        // A-1, A-2… ordering within a letter; null = unranked
  plannedFor  String?     // local date "YYYY-MM-DD" this task is planned for; null = backlog
  frogPlans   DailyPlan[]
}

model DailyPlan {
  id          String    @id @default(cuid())
  userId      String
  date        String    // local date "YYYY-MM-DD"
  frogTaskId  String?
  plannedAt   DateTime? // set when the morning "Plan my day" flow is saved
  reviewedAt  DateTime? // set when the evening "Close the day" flow is saved
  wentWell    String?
  improve     String?
  rating      Int?      // 1–5, "how did today go?"
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  frogTask    Task?     @relation(fields: [frogTaskId], references: [id], onDelete: SetNull)

  @@unique([userId, date])
  @@index([userId, date])
}

model UserSettings {
  // ...existing fields...
  frogFirstMode Boolean @default(false)   // M7 only — add the column in M7's migration, not M1's
}
```

- Migration is hand-written SQL in a new folder, e.g. `prisma/migrations/20261023000000_add_eat_that_frog/migration.sql`, matching the existing style (see `20260725000000_add_task_archive_complete`). It must apply cleanly on a fresh DB **and** produce no drift (`prisma migrate diff … --exit-code` returns 0). `scripts/test-db.sh` checks both.
- Update `types/index.ts`: `Abcde` type, new `Task` fields, a `DailyPlan` interface.
- **Warning:** `lib/db.ts` exports `db: any`, so TypeScript will **not** catch wrong Prisma field names. Every query touching new fields must be covered by an integration test against the real local DB.

### "Done" and "eaten"

- A task is **done** when its status has `celebrate: true` (this already stamps `completedAt` in `PATCH /api/tasks/[id]`). Reuse that. To mark a task done from `/today`, PATCH its `statusId` to the **first celebrate status by `order`** in its group. If the group has no celebrate status, the "done" control is disabled with a tooltip: "This project has no Done column".
- The frog of plan `date` is **eaten** if `frogTask.completedAt` is set and `localDateKey(completedAt, tz) <= date`. Completing it later doesn't count for that day's streak.
- **Eaten before noon:** eaten, and the local hour of `completedAt` is < 12.

### Ownership and security

Existing task routes don't check ownership. **New code must.** Every new or changed route verifies that:
- the user is authenticated (same `createClient()` pattern as the other routes), and
- any task id it reads or writes belongs to a group with `ownerId === user.id` (and isn't deleted).

Otherwise return 404. `DailyPlan` rows are always filtered by `userId`. Validate every input: `date` matches `/^\d{4}-\d{2}-\d{2}$/` and is a real date, `tz` passes `isValidTimeZone`, `abcde ∈ {A,B,C,D,E,null}`, `rating` is an integer 1–5 or null, and text fields are trimmed and capped at 2000 chars. Return 400 with `{ error }` on bad input.

---

## Pure logic — `lib/frog/`

Server-agnostic, no DB, fully unit-tested:

- `dates.ts`: `isDateKey(s)`, `isValidTimeZone(tz)`, `localDateKey(date: Date, tz): string`, `localHour(date, tz): number`, `addDays(key, n): string` (DST-safe — do the math on the date key, not on milliseconds).
- `abcde.ts`: `ABCDE_META` (label, short description, colour per letter — A red-ish, B orange, C blue, D purple, E grey, using hex values that read on the dark `--card` background), `compareTasks(a, b)` (letter A→E with null last, then `abcdeRank` with null last, then priority URGENT→LOW, then `order`), `formatAbcde(task)` → `"A-1"` / `"A"` / `""`, `openAtasks(tasks)`.
- `streak.ts`: `computeStreaks(days: { date: string; eaten: boolean }[], today: string) → { current, longest }`. A day with no plan, or a plan whose frog wasn't eaten, breaks the streak — except **today**: an uneaten frog today doesn't break the current streak yet (count back from yesterday).
- `stats.ts`: `frogStats(plans, tz, today, rangeDays)` → `{ plannedDays, eatenDays, eatenRate, beforeNoonRate, current, longest }`.

---

## API

All under `app/api/`. Follow the existing route style (`createClient()` → `getUser()` → 401, then `db`, then `NextResponse.json`).

### `PATCH /api/tasks/[id]` (extend)
Accept `abcde`, `abcdeRank`, `plannedFor` (date key or null). Validate them. When `abcde` changes, write an `Activity` row `action: "abcde_changed"` with `metadata: { from, to }`. Add ownership checks for requests that touch these new fields — or, better, for the whole handler; adding one ownership check at the top is acceptable.

### `GET /api/today?date=YYYY-MM-DD&tz=Area/City`
Returns:
```ts
{
  date: string;
  plan: DailyPlan | null;
  frog: Task & { group: { id, name, color }, subtasks: Task[] } | null;
  tasks: (Task & { group: { id, name, color, doneStatusId: string | null } })[]; // plannedFor === date, top-level, not deleted/archived, sorted with compareTasks
  completedToday: { id, title, abcde, group: { name, color } }[];              // completedAt falls on `date` in tz
  openA: number;                                                              // A tasks in `tasks` not done
  streak: { current: number; longest: number };
}
```

### `GET /api/today/candidates`
Every active top-level task the user owns (not deleted, not archived, not in a celebrate status), with `group { id, name, color }`, grouped or sortable by project. Used by the Plan-my-day picker.

### `PUT /api/today`
Body: `{ date, tz, taskIds: string[], ranks?: Record<taskId, { abcde: Abcde | null; abcdeRank: number | null }>, frogTaskId: string | null, finalize?: boolean }`
- In one `db.$transaction`: set `plannedFor = date` on `taskIds`; clear `plannedFor` on tasks that had `plannedFor = date` but aren't in `taskIds`; apply `ranks`; upsert the `DailyPlan` (userId, date) with `frogTaskId`; if `finalize`, set `plannedAt = now`.
- `frogTaskId` must be in `taskIds` (400 otherwise).

### `POST /api/today/review`
Body:
```ts
{
  date, tz,
  moves: { taskId: string; action: "tomorrow" | "backlog" | "archive" }[],
  wentWell?: string, improve?: string, rating?: number | null,
  tomorrowFrogTaskId?: string | null
}
```
- One transaction. `tomorrow` → `plannedFor = addDays(date, 1)`. `backlog` → `plannedFor = null`. `archive` → `archivedAt = now` for the task and its subtasks (same as the existing archive behaviour), plus an `"archived"` activity row.
- Update today's `DailyPlan` with the reflection fields and `reviewedAt = now` (upsert if missing).
- If `tomorrowFrogTaskId` is set: ensure that task has `plannedFor = tomorrow`, then upsert tomorrow's plan with that frog. Leave `plannedAt` null, so tomorrow's morning flow still runs but starts with the frog preselected.

### `GET /api/reports/frog?tz=…&days=30|90|all&today=YYYY-MM-DD`
`{ stats: frogStats(...), daily: { date, planned: boolean, eaten: boolean, beforeNoon: boolean }[], abcdeCompleted: { A, B, C, D, E, none }, reflections: { date, rating, wentWell, improve, frogTitle, eaten }[] }` (reflections newest first, max 30). Excludes groups with `excludeFromReports`, matching `/api/reports`.

---

## UI

Match the existing look: CSS variables from `app/globals.css` (`--bg`, `--card`, `--elevated`, `--text-*`, `--accent*`, `--border*`), inline `style={{}}` plus Tailwind classes as the current components do, `lucide-react` icons, rounded-2xl cards. Dark theme only (that's what the app has). Must work at phone width: the app layout already pads for the mobile hamburger.

### `/today` page — `app/(app)/today/page.tsx` + `components/today/*`
The page is a server wrapper that renders a client `TodayView`. The client computes `date` and `tz` and fetches `GET /api/today`. Three states:

1. **Plan my day** (no plan, or `plan.plannedAt` is null). A three-step stepper:
   1. **Pick** — candidates grouped by project, each with a checkbox. Tasks already planned for today (e.g. carried over) start checked. Show a live count, and a gentle hint above ~7 tasks: "Fewer, more important tasks beat a long list."
   2. **Label** — each picked task gets A/B/C/D/E buttons with a one-line explanation of each letter. Within a letter, up/down buttons set rank (A-1, A-2…). The list re-sorts live with `compareTasks`.
   3. **Choose your frog** — suggest A-1 (or the first task if there's no A). The user taps to choose. Copy: *"If you have to eat a frog, eat it first thing in the morning."* Save → `PUT /api/today` with `finalize: true`.
2. **Today** (planned, not reviewed):
   - **Frog card** (hero, top): frog emoji/icon, title, project chip, ABCDE badge, subtask progress with the **next unfinished subtask** shown as "Next bite: …", and a big **"Ate it"** button → marks done → confetti (reuse `components/board/ConfettiCelebration`) → card flips to an "Eaten at 9:42" state.
   - **Today's list**, sorted by `compareTasks`: checkbox (done), title, ABCDE badge, project chip. A **D** task shows a "Delegate" tag. An **E** task shows an "Eliminate" button that archives it after a confirm (reuse `components/ui/ConfirmDialog`).
   - **A-first rule**: when `openA > 0`, B/C rows show a subtle "A tasks first" hint. If the user checks off a B/C while A tasks are open, show a non-blocking inline notice: *"N A-task(s) still open — the book says finish those first."*
   - Clicking a task title opens the existing `TaskDetail` slide-over if that's practical to reuse; otherwise link to `/group/[id]`.
   - Header: date, streak chip ("🔥 4-day frog streak"), and an **"Edit plan"** link (back to step 1 with current selections) and a **"Close the day"** button.
3. **Close the day** (review flow; also reachable after `reviewedAt`, to view or edit):
   1. **Done today** — the `completedToday` list, frog highlighted, with a short celebratory line.
   2. **Unfinished** — each open planned task with three choices: Tomorrow (default) / Backlog / Archive.
   3. **Reflect** — rating 1–5, "What went well?", "What would you do differently tomorrow?"
   4. **Tomorrow's frog** — pick from tasks being moved to tomorrow, or skip.
   Save → `POST /api/today/review` → a "Day closed" summary card (frog eaten?, tasks done, streak).

### Task detail and board
- `components/task/TaskDetail.tsx`: an **ABCDE pill picker** next to the priority picker (same dropdown pattern), plus a **"Plan for today"** toggle that sets `plannedFor` to today's local date or null. Saved through the existing save flow.
- `components/board/TaskCard.tsx`: a small ABCDE badge (`A-1`, `B`…) when set, styled from `ABCDE_META`. Keep the card compact; don't add the frog icon on the board.

### Sidebar
Add a **Today** link (lucide `Sun` or a frog-ish icon) using the same markup and active-state pattern as the Dashboard and Reports links in `components/sidebar/Sidebar.tsx`.

### Reports — "Frog" section (Reflect over time)
Add a section to `components/reports/ReportsDashboard.tsx` (or a sibling component it renders), using the same range selector:
- Stat tiles: current streak, longest streak, frogs eaten / planned days (%), eaten before noon (%).
- A **frog calendar strip**: one cell per day in range. Eaten = green, planned but not eaten = muted red, no plan = empty.
- **ABCDE breakdown of completed tasks** — reuse `BreakdownBars` if it fits.
- **Reflections journal**: the latest reflections with date, rating and frog. Collapsed to 5, "show more".

### Dashboard (small)
On `app/(app)/dashboard/page.tsx`, add a compact **Today's Frog** card above the project grid, linking to `/today`. It shows the frog title or "No frog yet — plan your day". The page uses the server clock, so render this card as a small client component that fetches `/api/today` with the browser's date and tz. Don't alter the THINK/PLAN/DO/REFLECT strip.

---

## Milestones and acceptance criteria

Each milestone is developed, tested, reviewed and committed before the next starts. See `WORKFLOW.md`.

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Test infrastructure.** Add `vitest` (dev dep) + `vitest.config.ts` with the `@/` alias. Two projects or configs: `unit` (`**/*.test.ts` under `lib/`, node env) and `integration` (`tests/integration/**/*.test.ts`, which needs `DATABASE_URL`). A `tests/integration/helpers.ts` that truncates tables between tests, seeds a user's group/statuses/tasks, and mocks `@/lib/supabase/server` to return a configurable fake user (`vi.mock`). Scripts: `"test": "vitest run --project unit"`, `"test:integration": "vitest run --project integration"`. Set the integration project's `test.env` in `vitest.config.ts` to the local DB from `scripts/test-db.sh` (`DATABASE_URL`/`DIRECT_URL` = `postgresql://postgres:postgres@localhost:5432/forma_test`): local throwaway creds only. Don't create `.env*` files (they're gitignored). | `npm test` passes with one sample test. `bash scripts/test-db.sh && npm run test:integration` passes with one sample test that calls an existing route handler (e.g. `GET /api/tasks/[id]`) through the mock. |
| **M1** | **Schema + pure logic.** Prisma changes, migration, `types/index.ts`, `lib/frog/{dates,abcde,streak,stats}.ts` + unit tests (DST edges, year boundary, empty input, streak with today uneaten, ties in `compareTasks`). | Migration applies on a fresh DB, no drift; unit tests pass; tsc clean. |
| **M2** | **ABCDE on tasks.** Extend `PATCH /api/tasks/[id]`, the TaskDetail picker + Plan-for-today toggle, the TaskCard badge. Integration tests for the PATCH validation, activity row and ownership 404. | Tests pass; the UI compiles; the reviewer confirms the picker follows the existing priority-picker pattern. |
| **M3** | **Today API.** `GET /api/today`, `GET /api/today/candidates`, `PUT /api/today`. Integration tests: happy path, frog not in taskIds → 400, another user's task → 404, removed tasks get `plannedFor` cleared, tz edge (task completed 23:30 local = previous UTC day shows in `completedToday`). | Tests pass. |
| **M4** | **`/today` page — plan + do.** Plan-my-day stepper, Today view, frog card with confetti, A-first hints, E→archive, sidebar link. | Build passes; the reviewer walks through every UI state in code; the page renders all three states at 375px without horizontal scroll (verified by reading the layout classes). |
| **M5** | **Reflect — close the day.** `POST /api/today/review` + the review flow UI + the "Day closed" summary + streak in the header. Integration tests for each move action, reflection validation, tomorrow's frog creating tomorrow's plan. | Tests pass, build passes. |
| **M6** | **Reports + dashboard.** `GET /api/reports/frog` + the Reports Frog section + the dashboard Today's Frog card. Integration tests for stats (streak across a gap, `excludeFromReports` respected). | Tests pass, build passes. |
| **M7** | *(stretch)* **Frog-first mode.** `UserSettings.frogFirstMode` (its own migration), extend `/api/user-settings`, a toggle on `/today`, dimming plus disabled checkboxes on non-frog tasks until the frog is eaten. | Tests pass, build passes. |
