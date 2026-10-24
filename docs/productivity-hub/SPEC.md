# Productivity hub: build plan

Six features that turn Forma from a kanban board with a daily planner into the one place the user runs their day. Build them in order, one milestone at a time. Each milestone ships on its own and leaves the app working.

| # | Milestone | What the user gets |
|---|---|---|
| H1 | Quick capture and search | Ctrl+K searches every task and jumps anywhere. `Q` adds a task from anywhere with plain-text dates, project and priority. |
| H2 | Recurring tasks | "Gym every Mon, Wed, Fri". Completing one creates the next. |
| H3 | Calendar | Month and week views of tasks by due date. Drag to reschedule. |
| H4 | Focus time on tasks | Pick a task in Pomodoro. Every focus session is logged against it. Reports show where the time went. |
| H5 | Habits | Daily check-ins with streaks, on /today and on their own page. |
| H6 | Weekly review | One screen on Sunday or Monday: what got done, what slipped, a short reflection, and next week's frogs. |
| H7 | *(optional, ask first)* Google Calendar events | Read-only Google Calendar events on /today and the calendar. Needs the user to create Google Cloud OAuth credentials. |

**Out of scope:** email, chat, notes and docs, finance, a phone app or PWA (the user will come back to these). Don't add them, and don't redesign existing screens beyond what a milestone says.

---

## Ground rules (read before H1)

1. **Read `AGENTS.md` and `CLAUDE.md`.** This is Next.js 16.2: check `node_modules/next/dist/docs/` before writing routing, `searchParams`, or `proxy.ts` code. Route `params` and `searchParams` are Promises.
2. **Ember design system.** Follow the token table and rules in `CLAUDE.md` exactly: token classes only (`bg-surface`, `text-subtle`, `border-border`), `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-outline`, `.forma-input`, `.dropdown-menu`, one orange button per view, sentence case, no emoji, no gradients, no `rounded-2xl`, no uppercase tracked labels. Copy existing components for look and spacing: `components/today/TodayDay.tsx`, `components/sidebar/Sidebar.tsx`, `components/reports/FrogSection.tsx`.
3. **The user's working style** (from their feedback): one direct screen with instant save, not multi-step wizards. Add new UI next to existing UI; don't replace existing flows. Everything must work at 375px wide with no horizontal scroll.
4. **`lib/db.ts` exports `db: any`.** TypeScript won't catch a wrong Prisma field name. Double-check every field name against `prisma/schema.prisma`.
5. **Security for all new code.** Every new route: `createClient()` → `getUser()` → 401. Every task, group, habit or session id read or written must belong to the user (`group: { ownerId: user.id }` for tasks, `userId` for per-user tables); return 404 otherwise. Validate every input (reuse `lib/frog/validate.ts`: `hasNul`, `parsePlannedFor` and the rest) and return 400 with `{ error }`. Text fields: trimmed, max 2000 chars (titles 500).
6. **Dates.** "Today" is always the browser's local date. Use `lib/frog/dates.ts` (`localDateKey`, `isDateKey`, `isValidTimeZone`, `addDays`) and `useLocalClock()` from `lib/frog/clock.ts`. Routes that need "today" take `date`/`today` and `tz` query or body params, the same way `/api/today` does. Do date-only maths on `YYYY-MM-DD` keys, never on milliseconds.
7. **Due dates are datetimes.** `Task.dueDate` stores a local date and time as a UTC instant (see `components/ui/DatePicker.tsx` and the `dueDate` handling in `components/task/TaskDetail.tsx`). When a feature sets a date without a time, use the same default time DatePicker uses when you click a day. Bucket a due date into a day with `localDateKey(dueDate, tz)`.
8. **Client fetch helpers.** Each feature gets its own `api.ts` beside its components, copying the `json()` helper pattern in `components/today/api.ts` (throws an Error carrying the server's `{ error }`).
9. **Migrations.** Hand-write SQL in a new folder under `prisma/migrations/` (copy the style of `20261024000000_add_frog_first_mode`), named `2026102N000000_<name>` in milestone order. They must be additive (new tables, nullable columns or columns with defaults). Run `npx prisma validate` and `npx prisma generate`. **Never run `prisma migrate deploy` or `db push` against the user's database yourself.** Tell the user which migration to apply at the end of each milestone.
10. **Done means:** `npx tsc --noEmit` is clean; `npx eslint <changed files>` adds no new problems (record the `npx eslint .` count before H1 and keep it from rising); `npm test` passes; and the production build passes:
    `DATABASE_URL=postgres://x:y@localhost:5432/x NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx next build`.
11. **Tests.** The user doesn't want the old multi-agent pipeline or UI tests. Do write **unit tests for the pure logic in `lib/`** (parsers, recurrence maths, streaks), because those are where date bugs hide and they run in seconds (`npm test`). Don't add UI or integration tests. The integration suite needs the Linux-only `scripts/test-db.sh`, so it can't run on this Windows machine. If you change something an existing test covers, update that test; if a UI test goes stale, mention it rather than spending time on it.
12. **Git.** Work on branch `claude/productivity-hub`, created from the current HEAD. Commit after each milestone (`H1: quick capture and search`, …) with the attribution footer your session gives you. Don't push or open a PR unless the user asks. Tick the milestone in **Progress** at the bottom of this file in the same commit.

---

## H1: Quick capture and search

### What it does
- **Ctrl+K** (Cmd+K on Mac) opens the palette in **Search** mode, from any page in the `(app)` layout.
- **Q** (when focus isn't in an input, textarea, select or contenteditable) opens it in **Add** mode.
- Inside the palette, **Tab** switches between Add and Search. **Esc** closes it.
- The sidebar gets two rows above the nav links: "Search" with a `Ctrl K` hint (JetBrains Mono, `text-subtle`) and "Add task" with a `Q` hint. On screens narrower than `lg` there's also a floating round "+" button (bottom right, `btn-primary`, 48px, `aria-label="Add task"`) that opens Add mode. That's the one orange button on those screens.
- Layout: a centred `bg-surface` panel with a `border-strong` outline, max width 640px, about 15vh from the top, over `.panel-backdrop`. Below 640px it's full screen. Focus is trapped inside it and returns to the opener when it closes. Use `role="dialog"` with `aria-modal`, and give the results list `role="listbox"` with `aria-activedescendant`.

### Add mode
One input. Below it, a live **preview** of the parsed result: title, then chips for project, due date, priority and (from H2) repeat. Tokens the parser recognised are underlined in the input preview, or shown as chips that can be removed with ×. **Enter** saves and clears the input so the next task can be typed straight away (the user's "type, Enter, repeat" style). The palette stays open; a small "Added to Work · Fri 30 Oct" line confirms each one, with an **Open** link. **Shift+Enter** saves and closes.

Parser: `lib/capture/parse.ts`, pure and unit-tested. `parseCapture(text, { today: string /* date key */, projects: {id,name}[] })` returns:

```ts
{
  title: string;               // text with recognised tokens removed, whitespace collapsed
  groupId: string | null;      // from #project
  priority: Priority | null;   // from !token
  due: { date: string; time: string | null } | null;  // date key + optional "HH:MM"
  planToday: boolean;          // from @today
  repeat: RepeatRule | null;   // H2 adds this; return null until then
  tokens: { start: number; end: number; kind: "project" | "priority" | "date" | "time" | "plan" | "repeat" }[];
}
```

Grammar, case-insensitive. A token counts only as a whole word.
- **Project:** `#name` matches a project whose name, lowercased with spaces removed, starts with what follows `#` (`#work`, `#sidepro`). If several match, use an exact match first, then the shortest name. If nothing matches, leave it in the title.
- **Priority:** `!urgent` `!high` `!medium` `!low`, or `!1` `!2` `!3` `!4` (1 = urgent).
- **Date:** `today`, `tod`, `tomorrow`, `tmr`, a weekday (`mon`…`sun`, `monday`…`sunday`) meaning the next one strictly after today, `next week` (next Monday), `in N days` / `in N weeks`, `30 oct`, `oct 30`, `30/10` (day/month), and ISO `2026-10-30`. A date that has already passed this year rolls to next year. Only the **last** date token wins.
- **Time:** `3pm`, `3:30pm`, `15:00`, `at 9`. A time with no date means today, or tomorrow if that time has already passed.
- **Plan:** `@today` sets `planToday` (puts the task on today's list via `plannedFor`).
- An empty title after stripping tokens is invalid: show "Add a title" and don't save.

Default project: the last project used in Add mode (localStorage `forma.capture.groupId`, read and written in try/catch), otherwise the first project by sidebar order. The preview's project chip is also a dropdown for changing it. With no projects, show "Create a project first" and a link to the dashboard.

API: **`POST /api/capture`** with body `{ title, groupId, priority?, dueDate? /* ISO */, plannedFor? /* date key */, repeat? /* H2 */ }`. It checks the user owns the group and picks the first status by `order` that isn't `celebrate`. It puts the task at the top of that column (`order` = current min − 1, or 0 when empty), creates it and a `created` activity row in one transaction, and returns the task with `group { id, name, color }`. The client builds `dueDate` from `due.date` + `due.time` the way TaskDetail does, so the server never guesses the user's time zone.

While you're in the area, harden **`POST /api/tasks`**: check that `groupId` belongs to the user and `statusId` belongs to that group (404 / 400), and validate `priority` and `dueDate`. The board's add-task flow uses it.

After a capture, if the current page shows that project's board or /today, the new task should appear without a reload. Dispatch `window.dispatchEvent(new CustomEvent("task-created", { detail: task }))`. Have `KanbanBoard` (same group) and `TodayView` (call `refresh`) listen for it, the same way Sidebar listens for `group-deleted`.

### Search mode
- Input with a 150ms debounce, minimum 2 characters. Below 2 characters, show **Go to** rows: Dashboard, Today, Calendar (H3), Habits (H5), Weekly review (H6), Reports, Pomodoro (opens a new tab, as the sidebar does), then every project. Only list pages that exist so far. Typing also filters these rows by name.
- **`GET /api/search?q=`**: the user's tasks where `title` or `description` `contains` q (`mode: "insensitive"`), not deleted, not archived, top-level and subtasks both. Max 20. Order: open tasks first, then by `updatedAt` desc. Return `{ id, title, parentTaskId, parentTitle, done: boolean, dueDate, priority, abcde, abcdeRank, group { id, name, color } }`. Reject q longer than 200 characters or containing NUL (400).
- Each result row: title (matched part in `text-foreground font-medium`, the rest `text-muted-foreground`), "in Parent title" for subtasks, project name in `text-subtle`, and a "Done" tag when done. Rows carry the project colour as a 3px left border, like cards. Matching Go-to rows appear above task results.
- ↑/↓ move the selection, **Enter** opens it, mouse hover selects. With no results, show "No tasks match" and a row "Add "<query>" as a task" that switches to Add mode with the text carried over.
- **Opening a task:** navigate to `/group/<groupId>?task=<id>`, using the parent id for subtasks. `app/(app)/group/[id]/page.tsx` reads `searchParams` (a Promise) and passes `openTaskId` to `KanbanBoard`. KanbanBoard opens `TaskDetail` for that task when it's in `initialTasks`, in an effect that also runs when the prop changes (the board is keyed by group id, so it won't remount when only the query changes). It then removes the param with `router.replace` so a refresh doesn't reopen the panel.

### Files
`components/command/CommandPalette.tsx` (mounted once in `app/(app)/layout.tsx` with the keyboard listener), `components/command/AddMode.tsx`, `components/command/SearchMode.tsx`, `components/command/api.ts`, `lib/capture/parse.ts` + `parse.test.ts`, `app/api/capture/route.ts`, `app/api/search/route.ts`. Changes: `Sidebar.tsx` (the two rows; open the palette with a `window` event `open-command-palette` with `detail: { mode }`), `KanbanBoard.tsx`, the group page, `TodayView.tsx`.

**Unit tests:** every grammar rule, rolling to next year, weekday on the same weekday (means next week), time already passed, last date wins, `#` prefix ambiguity, a title made only of tokens, tokens in the middle of the title, and the year boundary (today = 2026-12-31 → `tomorrow` = 2027-01-01).

---

## H2: Recurring tasks

A recurring task is a normal task with a due date and a repeat rule. When it's completed, the next one is created with the next due date. The completed one stays as history, so reports keep counting it.

### Data
```prisma
model Task {
  // ...
  repeat         Json?    // RepeatRule; null = doesn't repeat
  seriesId       String?  // id of the first task in the series; same on every instance
  nextInstanceId String?  // set on a completed instance once its successor exists (stops duplicates)
}
```
Migration `20261025000000_add_task_repeat`. Add an index on `seriesId`. Update `types/index.ts`.

```ts
type RepeatRule =
  | { freq: "day"; interval: number }                        // every N days
  | { freq: "week"; interval: number; weekdays: number[] }   // 0 = Sun … 6 = Sat, sorted, non-empty
  | { freq: "month"; interval: number; day: number | "last" } // day 1–31; clamps to month end
  | { freq: "year"; interval: number };                      // same month/day as the due date
```
`interval` is 1–365.

### Pure logic: `lib/recurrence/rule.ts` + tests
- `parseRepeatRule(json): RepeatRule | null` validates the shape strictly (used by routes).
- `formatRepeat(rule)` gives sentence-case labels: "Every day", "Every 3 days", "Weekdays" (Mon–Fri), "Every Mon, Wed, Fri", "Every 2 weeks on Tue", "Every month on the 1st", "Every month on the last day", "Every year".
- `nextOccurrence(rule, dueKey, afterKey): string` returns the first occurrence of the series (anchored on `dueKey`) that is **strictly after `afterKey`**. Callers pass `afterKey = max(dueKey, completedLocalKey)`. So finishing a daily task three days late gives tomorrow, not three overdue copies, and finishing early still moves on one step. Week intervals count whole weeks from the week that holds `dueKey` (weeks start Monday). Month day 31 in February gives the 28th or 29th.
- `occurrencesBetween(rule, dueKey, fromKey, toKey, limit = 60)` returns future dates for the calendar's ghost entries (H3).
- Tests: month-end clamping, leap years, `"last"`, multi-weekday sets crossing a week boundary, intervals > 1, `afterKey` far in the future, and `afterKey` before `dueKey`.

### Server: `lib/recurrence/server.ts`
`spawnNextInstance(tx, taskId, tz)` runs inside the caller's transaction (use the interactive `db.$transaction(async (tx) => …)` form). It does nothing unless the task is top-level, has `repeat`, has `dueDate`, and has `nextInstanceId === null`. Otherwise it:
1. Computes the next due date: same local time of day as the old `dueDate`, on `nextOccurrence(rule, localDateKey(dueDate, tz), max(dueKey, localDateKey(now, tz)))`. Build the instant from the date key, the old local time and `tz`. Add a `localDateTimeToInstant(key, "HH:MM", tz)` helper to `lib/frog/dates.ts`, with tests, including a DST change day.
2. Creates the new task: copies `title`, `description`, `priority`, `abcde` (rank reset to null), `groupId`, `repeat`, `createdBy`; sets `seriesId` = old `seriesId ?? old id`, `statusId` = first non-celebrate status by order, `order` = top of that column. `plannedFor` is null.
3. Copies the old task's **subtasks** (not deleted) as fresh open subtasks in the same first status, keeping their `order`.
4. Sets `nextInstanceId` and (if it was null) `seriesId` on the old task, and writes an activity row `action: "recurred"`, `metadata: { from: oldId, to: newId }`.

Call it wherever a task enters a celebrate status:
- `PATCH /api/tasks/[id]` (the `isDone && !wasDone` branch). Convert that handler's `$transaction([...])` to the interactive form.
- `PATCH /api/tasks/reorder` (dragging a card into Done). While you're there, add the ownership check: every id must be a task in a group the user owns, and every `statusId` must be in that task's group. Otherwise return 404 and write nothing.

Both routes accept an optional `tz` in the body (validated with `isValidTimeZone`, falling back to `"UTC"`). Update every client caller that changes a status to send `tz: Intl.DateTimeFormat().resolvedOptions().timeZone`: `KanbanBoard.tsx`, `TaskDetail.tsx`, `components/today/api.ts` `markTaskDone`, and anything else you find with `grep -rn "statusId" components`.

Moving a completed instance back out of Done keeps the spawned successor (no deletion; `nextInstanceId` stops a second copy). Archiving or deleting a recurring task stops the series, because only completion spawns.

### UI
- **TaskDetail:** a "Repeat" picker beside the due date, using the same dropdown pattern as priority. Options: Doesn't repeat, Every day, Weekdays, Every week on <due weekday>, Every month on the <due day>, Every year, Custom… Custom opens an inline row: "Every [N] [days|weeks|months|years]", with weekday toggle chips for weeks and "on day [N | last]" for months. Choosing a repeat on a task with no due date sets the due date to today (default time). Show `formatRepeat` text in the pill. When the task has a successor, show a muted line "Next: Fri 30 Oct" that links to it.
- **TaskCard:** a small lucide `Repeat` icon (12px, `text-subtle`, `aria-label` from `formatRepeat`) next to the due date.
- **Quick capture (H1 parser):** add the tokens `every day`, `daily`, `every weekday`, `weekdays`, `every week`, `weekly`, `every <weekday>[,<weekday>…]` (e.g. `every mon, wed, fri`), `every N days|weeks|months`, `monthly`, `every month on the 1st|15th|last day`, `yearly`, `every year`. A repeat with no date token sets the due date to the first occurrence from today, inclusive. Unit-test each one.
- **/today:** recurring tasks show the `Repeat` icon. Because a new instance's `plannedFor` is null, the user still plans it in. In `/today/new` and the label screen, nothing changes.

---

## H3: Calendar

New page **`/calendar`** (`app/(app)/calendar/page.tsx` server wrapper + client `components/calendar/CalendarView.tsx`). Sidebar link "Calendar" (lucide `CalendarDays`) after Today.

### Views
- Header: month and year title, ‹ › arrows, a "Today" button (`btn-secondary`), and a Month / Week segmented toggle. Remember the view in localStorage `forma.calendar.view`. Below `sm`, default to Week.
- **Month:** a 7-column grid starting Monday, with 6 rows. Each day cell shows the date number (today's in a `primary-soft` circle with `text-foreground`; orange is for the selected/active day) and up to 3 task chips plus "+N more", which expands that day. Chips are `bg-raised` with a 3px left border in the project colour. Done tasks show as `text-faint` with a line through. Overdue open tasks (due before now) put the date in `text-danger`.
- **Week (agenda):** 7 stacked day sections (Mon–Sun). Each has a header ("Mon 26 Oct", plus "Today" tag) and its tasks listed with time (mono), title, project name, priority edge colour, and the `Repeat` icon. Above the week, an **Overdue** section lists open tasks due before today, in any week. This is the phone layout.
- **Ghost entries:** for recurring tasks, future occurrences in the visible range (from `occurrencesBetween`) show as dashed `border-strong` chips with `text-subtle`. Clicking one opens the real current instance. They can't be dragged.
- **Unscheduled tray** (desktop `lg+` only): a right-hand `bg-surface` panel listing open top-level tasks with no due date, grouped by project, with a filter input. Drag a task onto a day to give it a due date.

### Interaction
- Click a task to open `TaskDetail` as a slide-over on the calendar page. It needs `statuses` for the task's group, so the API returns them per group. Update or remove the item in place from TaskDetail's `onUpdated`/`onDeleted`.
- Drag a chip to another day (dnd-kit, the same sensors as the board) → `PATCH /api/tasks/[id] { dueDate }`, keeping the local time of day. Update optimistically and roll back with an inline error on failure. Keyboard alternative: in TaskDetail, use the date picker.
- Click an empty part of a day cell (or a "+" on hover or focus) to open the command palette in Add mode with the date pre-filled as a token (e.g. `fri 30 oct `).
- Arrow keys don't move between days (out of scope). Every chip and button must be reachable with Tab.

### API
**`GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=`** (max 62 days). The query uses `dueDate` within `[start of from, end of to]` in `tz`, and computes the window with the same helper `/api/today` uses (`utcWindowForLocalDate` in `lib/frog/today.ts`, or a range version of it). It returns:
```ts
{
  tasks: (Task & { group: { id, name, color }, done: boolean })[];  // top-level, not deleted/archived, any status
  overdue: same[];                                                   // open, dueDate < now, outside the window too, max 50
  unscheduled: same[];                                               // open, no dueDate, max 200
  statusesByGroup: Record<groupId, Status[]>;
  recurring: { id, title, repeat, dueDate, group }[];                // open recurring tasks, for ghosts
}
```
`done` = the task's status is `celebrate`.

**Dashboard:** no change. **Today:** no change.

---

## H4: Focus time on tasks

### Data
```prisma
model FocusSession {
  id          String   @id @default(cuid())
  userId      String
  taskId      String?
  startedAt   DateTime
  endedAt     DateTime
  durationSec Int
  completed   Boolean  // ran to zero (true) vs skipped/reset early (false)
  createdAt   DateTime @default(now())
  task        Task?    @relation(fields: [taskId], references: [id], onDelete: SetNull)

  @@index([userId, startedAt])
  @@index([taskId])
}
```
Add `focusSessions FocusSession[]` to Task. Migration `20261026000000_add_focus_sessions`.

### API
- **`POST /api/focus-sessions`** `{ taskId: string | null, startedAt, endedAt, durationSec, completed }`. Validate: ISO dates, `endedAt > startedAt`, `durationSec` an integer from 60 to 14400 and no more than `(endedAt − startedAt)` + 5s, and `taskId` owned by the user. Return 201.
- **`GET /api/tasks/[id]`** also returns `focus: { totalSec, sessions }` for the task and its subtasks' sessions. While there, add the ownership check this GET lacks (`group: { ownerId: user.id }`), as `PATCH` already has.
- **`GET /api/reports/focus?days=7|30|90&tz=&today=`** returns `{ totalSec, sessions, daily: { date, sec }[], byProject: { id, name, color, sec }[], topTasks: { id, title, group, sec, sessions }[] /* max 10 */, untrackedSec }`. Sessions with no task count in `untrackedSec`. It respects `excludeFromReports` the way `/api/reports` does (sessions on excluded projects are left out of byProject and topTasks but still count in totals).

### Pomodoro page (`app/(timer)/pomodoro/page.tsx`, 1,481 lines, so make targeted edits)
- Add a **"Working on"** picker above the clock: a button showing the task title, or "Pick a task (optional)" in `text-subtle`. It opens a searchable dropdown. Today's planned tasks come first (from `GET /api/today` with the browser's date and tz), then other open tasks (`GET /api/today/candidates`), with a "No task" row. Persist the choice in localStorage `pomodoro_task_id` and drop it if the task is no longer open.
- `/pomodoro?task=<id>` preselects that task, then `router.replace("/pomodoro")`. The page already reads `useSearchParams` for Spotify; keep both working.
- Track `focusStartedAt` (wall clock, set when a focus session first starts; pausing doesn't reset it) and the accumulated running seconds. Post a session:
  - when a **focus** session hits zero (`fireExpiry` with `mode === "focus"`): `completed: true`, `durationSec` = the configured focus length;
  - when a focus session is **skipped or reset** with at least 60 running seconds: `completed: false`, with the real running seconds.
  Use `fetch(..., { keepalive: true })` and ignore failures (a failed log must never break the timer). Persist pending session data in the existing `pomodoro_timer_state` localStorage blob so a reload mid-session still logs correctly.
- In the session-ended prompt (`pending`), when a task is selected, add a secondary button **"Mark <task> done"**. It moves the task to its project's first celebrate status (`doneStatusId` comes with the today payload; for other tasks, fetch the group's statuses) and clears the picker.
- **Fix the known bug** noted in `docs/eat-that-frog/PROGRESS.md`: Pomodoro's settings save must send only the six timer fields (`focusMins, shortMins, longMins, sessionsBeforeLong, autoStartBreaks, autoStartFocus`), so it stops resetting `frogFirstMode`.

### Elsewhere
- **TaskDetail:** under the meta pickers, a muted line "Focus: 2h 25m · 6 sessions" (hidden when zero), plus a ghost button **"Focus on this"** (lucide `Timer`) that opens `/pomodoro?task=<id>` in a new tab.
- **/today:** the frog card and each open task row get the same `Timer` icon button (`btn-icon`, `aria-label="Focus on <title>"`).
- **Reports:** a "Focus time" section in `ReportsDashboard.tsx` after the existing KPIs, using the same range control. It shows stat tiles (total focus, sessions, average per day), a daily bar chart (reuse `ThroughputChart`'s structure; orange is fine here since focus is progress), focus by project (`BreakdownBars`), and a top-tasks list. Format durations as `2h 25m` / `45m`.

Unit tests: duration formatting, and the daily bucketing in tz (put it in `lib/focus/stats.ts`).

---

## H5: Habits

Habits are not tasks. They don't live on boards, don't have due dates, and don't count in task reports. A habit is a thing you do on certain days of the week, ticked once per day, with a streak. (Recurring tasks from H2 are for to-dos that need a due date and a project.)

### Data
```prisma
model Habit {
  id         String       @id @default(cuid())
  userId     String
  name       String
  weekdays   Int[]        @default([0,1,2,3,4,5,6])  // days it's scheduled; 0 = Sun
  order      Float        @default(0)
  archivedAt DateTime?
  createdAt  DateTime     @default(now())
  checks     HabitCheck[]

  @@index([userId])
}

model HabitCheck {
  id        String   @id @default(cuid())
  habitId   String
  date      String   // local date "YYYY-MM-DD"
  createdAt DateTime @default(now())
  habit     Habit    @relation(fields: [habitId], references: [id], onDelete: Cascade)

  @@unique([habitId, date])
}
```
Migration `20261027000000_add_habits`. Max 20 active habits per user (400 beyond that).

### Pure logic: `lib/habits/streak.ts` + tests
`habitStreak(weekdays, checkedDates: Set<string>, today, createdKey) → { current, longest }`. Only scheduled days count. An unchecked scheduled day breaks the streak, except **today** (an unticked today doesn't break it yet, the same rule as the frog streak in `lib/frog/streak.ts`). Days before `createdKey` don't count. A check on an unscheduled day counts as a bonus: it adds to the streak but missing that day never breaks it. Also `completionRate(weekdays, checks, fromKey, toKey)`.

### API
- `GET /api/habits?today=&tz=` returns active habits in order, each with `checks` for the last 35 days, `streak`, and `scheduledToday`.
- `POST /api/habits { name, weekdays }`, `PATCH /api/habits/[id] { name?, weekdays?, order?, archived? }`, `DELETE /api/habits/[id]` (hard delete, with a confirm in the UI).
- `PUT /api/habits/[id]/checks/[date]` ticks and `DELETE` unticks. Both are idempotent. `date` must be a valid key, no later than `today + 1` (time-zone slack) and no more than 35 days back.

### UI
- **/today:** a compact **Habits** card shown in both the planned and not-planned states (render it in `TodayView`, below the main content). It has one row per habit scheduled today: a checkbox (`input` outline at rest; ticked = `success`), the name, a 7-day row of small squares (ticked = `success`, missed scheduled day = `border` outline, unscheduled = no outline, today with a `primary` focus-style ring), and the streak in mono ("12"; `aria-label="12-day streak"`). Unscheduled habits are hidden here. Tick optimistically. It has a "Manage" ghost link to /habits. With no habits, show one line: "Track a daily habit" → /habits.
- **/habits page** (sidebar link "Habits", lucide `ListChecks`, after Calendar):
  - An add row at the top: name input + Enter, with weekday toggle chips (all on by default) in the same row on desktop and below it on phones.
  - One `bg-surface` card per habit: name (click to rename inline), weekday chips, current and longest streak, 35-day completion rate, and a 5-week × 7-day grid of squares that you can click to tick or untick past days. The card has a menu with Archive and Delete. Reorder with dnd-kit drag handles (the Sidebar project list pattern).
  - Archived habits sit in a collapsed "Archived" section with Restore.

---

## H6: Weekly review

New page **`/review`** (sidebar link "Weekly review", lucide `CalendarCheck`, after Today). One scrolling screen, sections in this order, saved with one button at the bottom ("Save review", the page's single `btn-primary`). Also link to it from the /today header ("Weekly review", ghost). On Fri, Sat, Sun and Mon, when the relevant week has no review yet, show a one-line nudge on /today.

### Which week
Weeks run Monday–Sunday. Default: the **current** week if today is Fri–Sun, otherwise the **previous** week. Header: "Week of 19 Oct" with ‹ › arrows (no further than the current week).

### Data
```prisma
model WeeklyReview {
  id         String    @id @default(cuid())
  userId     String
  weekStart  String    // Monday, "YYYY-MM-DD"
  win        String?   // "Biggest win"
  obstacle   String?   // "What got in the way"
  focus      String?   // "One focus for next week"
  rating     Int?      // 1–5
  reviewedAt DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  @@unique([userId, weekStart])
}
```
Migration `20261028000000_add_weekly_review`.

### Sections
1. **The week in numbers:** stat tiles for tasks done, frogs eaten (x of planned days, with the 7-day strip pattern from `FrogSection`), focus time (H4), habit completion % (H5), and average day rating (from `DailyPlan.rating`). Below that, "Done this week" grouped by project, collapsed to 10 with "Show all".
2. **What you wrote each day:** the week's `DailyPlan.wentWell` / `improve` lines with their dates (skip when there are none).
3. **Slipped:** open top-level tasks that were due in the week (before now) or planned (`plannedFor`) for a day of the week before today, and aren't done. Each row has a radio group (reuse `components/today/RadioGroup.tsx`): **Keep** (default, no change) / **Next week** (due date → next Monday at the same time; if it had no due date, `plannedFor` → next Monday) / **Backlog** (clear `plannedFor` and `dueDate`) / **Archive** (same as the close-day archive: task and its subtasks, plus an `archived` activity row).
4. **Reflect:** a rating of 1–5 (reuse the close-day rating control from `CloseDayFlow.tsx`), plus three textareas: "Biggest win", "What got in the way", "One focus for next week".
5. **Next week's frogs:** seven rows, Mon–Sun of the following week. Each has a picker of open tasks (the candidates list) with "No frog" as the default. A task picked for one day disappears from the other days' pickers. Days that already have a `DailyPlan.frogTaskId` start with it selected.

### API
- **`GET /api/review?weekStart=&tz=&today=`** returns everything the sections need, plus the existing `WeeklyReview` (to edit) and next week's existing frogs. Reuse `lib/frog/stats.ts` / `evaluatePlan` for frog days and `lib/habits/streak.ts` `completionRate` for habits. Put the week maths (`weekStartOf(key)`, `defaultReviewWeek(today)`) in `lib/review/week.ts` with tests.
- **`POST /api/review`** `{ weekStart, tz, today, moves: { taskId, action: "keep" | "nextWeek" | "backlog" | "archive" }[], win?, obstacle?, focus?, rating?, frogs: { date, taskId | null }[] }` in one interactive transaction. It applies the moves, upserts the `WeeklyReview` with `reviewedAt = now`, and for each frog day sets `plannedFor = date` on the task and upserts that day's `DailyPlan` `frogTaskId`. It leaves `plannedAt` null so the morning flow still runs. A `null` taskId clears that day's frog only if the plan has no `plannedAt` yet. Validate that every date is in the following week and that no task appears twice.
- Check `isPlanned()` in `lib/frog/dayview.ts`, and how /today renders a day with a pre-chosen frog but `plannedAt` null, so that a frog chosen here shows up on that morning's /today. The close-day flow already creates tomorrow's plan this way; match its behaviour.

### After saving
The page shows a short summary card ("Review saved · 5 frogs set for next week") with an **Edit** button, in the same pattern as `DayClosedCard`. The "One focus for next week" text appears as a muted line in the /today header during that next week ("This week: ship the portfolio").

---

## H7 (optional, ask the user first): Google Calendar events

Only start this if the user says yes **and** has created a Google Cloud OAuth client (Web app, scope `https://www.googleapis.com/auth/calendar.readonly`, redirect URI `<origin>/api/google/callback`) and put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` in `.env.local` themselves. Supabase's Google sign-in doesn't give a usable long-lived calendar token, so this is a separate connection, modelled on the Spotify routes (`app/api/spotify/auth`, `callback`, `token`).

- Store tokens in a **new** table `GoogleConnection { userId @unique, accessToken, refreshToken, expiresAt, createdAt }`, **not** on `UserSettings`. `GET /api/user-settings` sends the whole row to the browser, and new tokens must never reach the client.
- Routes: `GET /api/google/auth` (redirect, with a `state` value stored in an httpOnly cookie and checked in the callback), `GET /api/google/callback`, `GET /api/google/events?from&to&tz` (server-side refresh when expired; returns `{ connected: boolean, events: { id, title, start, end, allDay, calendarColor }[] }` from the primary calendar), and `DELETE /api/google/connection`.
- UI: a "Connect Google Calendar" secondary button in the calendar page header when not connected. When connected, show events in the calendar (neutral `bg-raised` chips with a clock icon, not draggable, not clickable beyond a tooltip) and a "Today's events" list on /today above the task list. Google event colours count as data colours.

---

## Progress

Tick each milestone in the commit that finishes it, and add a one-line note (commit hash, the migration the user must apply, anything skipped).

- [x] H1 Quick capture and search (no migration; tests deferred by the user)
- [x] H2 Recurring tasks (migration 20261025000000_add_task_repeat; tests deferred)
- [x] H3 Calendar (no migration; tests deferred)
- [ ] H4 Focus time on tasks
- [ ] H5 Habits
- [ ] H6 Weekly review
- [ ] H7 Google Calendar events (optional, only if the user asks)

### Notes and decisions
(Record anything you decided that this plan didn't cover.)

### For the user, after each milestone
1. Apply the new migration to Supabase: `npx prisma migrate deploy` (uses `DIRECT_URL` from `.env.local`). **Do this before running the new code**, because a missing column breaks every query on that table, not just the new feature.
2. `npm run dev` and try the feature.
