# Mobile PWA: progress

Spec: `SPEC.md`. Workflow: `WORKFLOW.md`.

## Milestones

- [x] P0: Mobile check harness (b6e6f0e, review fixes in the next commit)
- [x] P1: Installable app (1405c02, tests 7ebd4fd, maskable fix in the next commit)
- [x] P2: Service worker, offline page, updates (d3bf21d, tests 3d2ce73/d1eeebb, review fixes 8626ead)
- [x] P3: Mobile app shell (c63ad3c, tests 195c9d3, review fixes 7ae1b93)
- [x] P4: Page pass A (daily flow) (2ae563a, tests bdb2559/35891b8, fixes in the next commit)
- [ ] P5: Page pass B (planning and insight)
- [ ] P6: Polish and final sweep

## Log

- Plan written: SPEC, WORKFLOW, agent team (`.claude/agents/pwa-*.md`), baselines recorded from `main` at `2f756df`.

- P0: harness built and approved by review; review fixes applied (signal cleanup, below-the-fold tap targets, `--only` validated before seeding, all off-machine requests blocked, full-height screenshots).
- P1: manifest, icons, Apple metadata, proxy matcher, sw.js headers. Gate PASS (unit 1079, UI 164 baseline failures only, integration 1 baseline failure only, build OK, harness unchanged from P0). Review APPROVE; maskable F now drawn at full size (already inside the safe zone).
- P2: Gate PASS (unit 1157, UI baseline failures only, build OK, harness unchanged). Review APPROVE; 10 findings fixed in 8626ead (incl. clearing cached pages whenever /login or /signup loads, page-side clear on sign-out) and re-review APPROVE.
- P3: Gate PASS (unit 1175, UI baseline failures only, build OK, harness: every page clean except /pomodoro, which is P5). Review CHANGES_REQUESTED → 10 fixes in 7ae1b93 (outlined Add, drawer hidden when closed + focus in/out, Escape, install prompt captured on every page) → re-review APPROVE. Desktop pixel diff vs c24ae4e: 0 on dashboard, today, group, calendar, habits.
- P4: tap-target warnings 0 on today, today-label, today-new, task-detail (+ new harness states today-close, task-detail-date, task-detail-abcde). Desktop pixel diff vs 7ae1b93: 0 on 5 pages. Review APPROVE. Gate FAIL on 2 new tests (useFitInViewport didn't reset its shift on close) → fixed with the review items (habit hit areas no longer overlap, Rough sheet nowrap scoped, focus ring on the inner box under lg, pill row aligned, habit names truncate with title).

## Decisions

- P0: the harness measures overflow against the device width (360/390), not `innerWidth`. Chrome's mobile emulation zooms out to fit a too-wide page and grows `innerWidth` to match, so the spec's `scrollWidth <= innerWidth + 1` could never fail (a 520px test element passed under it).
- P0: elements too wide for a page's own `overflow-y-auto` wrapper scroll inside it and don't show in the document check; the harness lists those scrollers as information. The board's `.kanban-canvas` is one, and that's intended.
- P0: the harness builds into the normal `.next` (the output dir can't change without editing `next.config.ts`) and rebuilds when its marker doesn't match. It empties `forma_test`, so it never runs alongside the integration tests.
- P2: the offline page's CSS/JS/fonts are precached by parsing them out of the `/offline` HTML on install (`assetUrlsIn`: every `src`/`href` under `/_next/static/`) and adding them to `forma-static` in the same install as that HTML, so the cached page and its assets always come from one build. Retry is a plain `<a href="">` (reloads the URL the offline copy stands in for, works even without JS); a tiny client component reloads 1 s after `online` if still online.
- P2: `/login` and `/signup` navigations are `network-only`: never stored, but the offline page is served when the network fails (instead of the browser's error page). A 200 from either (review fix) deletes `forma-pages-*`: the proxy redirects signed-in users away, so a 200 means no session (expired, or signed out on another device). Every other rule-2 path (and any non-navigation request to /login, /signup) passes through untouched.
- P2 (review): the navigation timeout is 8 s, not 5 s, so only a connection that is up but moves no data falls back to the stored copy (an online user on a slow link otherwise got stale signed-in HTML with no cue). On timeout the stored copy is served if there is one; with none it keeps waiting for the network instead of calling a slow connection offline.
- P2: the update toast sits at `bottom: calc(5rem + safe-area-inset-bottom)` with 16px gutters under `lg` (clears the P3 tab bar and the floating add button), bottom-right at `lg`. It has a Dismiss icon button besides Reload.
- P2: `OfflineBanner` is built but not mounted: the shell is a flex row today, so the bar would either overlap the page (fixed) or squash it (in flow). P3 mounts it when it restructures the shell.
- P2: sign-out deletes `forma-pages-*` both through the worker (`CLEAR_RUNTIME_CACHES`, 1 s cap) and, in parallel, from the page (Cache Storage is shared), so a slow or stopped worker can't leave them behind. A navigation in flight during a clear doesn't store its page (`clearGen`). `forma-static-*` (no user data) stays.
- P2 (review): `/manifest.webmanifest` is cache first like `/icons/*`. `sw.js` header: any edit to it must bump `CACHE_VERSION`; icons and the manifest are unhashed, so changing them needs a bump too; app deploys don't touch `sw.js`, so they never show the update toast and old chunks pile up in `forma-static` until the next bump. `CACHE_VERSION` stays 1 for now because no version has shipped yet.
- P1: Next 16 emits `mobile-web-app-capable`, not `apple-mobile-web-app-capable`. Not adding the apple- tag: iOS 16.4+ launches standalone from the manifest. Check the status bar on a real iPhone in P3; add the tag via `other` only if it shows opaque.

- P3: the floating add button in `CommandPalette.tsx` has always shown on desktop too (its `lg:hidden` lost to `.btn-primary`'s display). To keep desktop identical it's now hidden only under lg (`max-lg:!hidden`), where the tab bar's Add replaces it. Whether desktop should keep it is a product call for later.
- P3: the Install app row also shows on desktop Chrome/Edge when the browser offers installation (decision 7 doesn't limit it to mobile).
- P3 (review): the tab bar's Add is an outlined 44×28 slot (`border` at rest, `border-strong` on hover, like the desktop sidebar's add button), not filled orange: pages already have their own orange primary (Close the day, Fill my day), and Ember allows one per view. SPEC P3 updated.

- P4: on /today's Habits card under sm, names stay on one line and truncate (full name in `title`); the row and week-strip gaps shrink slightly to make room.

- P5: dnd-kit gives a drag to the first sensor that accepts the event, and `pointerdown` comes before `touchstart`, so the PointerSensor (5px, no hold) always took fingers and the TouchSensor's 200ms hold never applied. The board and the calendar now use `MouseAndPenSensor` (`lib/dnd-touch.ts`: the PointerSensor, ignoring `pointerType: "touch"`) next to the unchanged TouchSensor. Board cards on touch are `touch-action: manipulation` (was `none`), so a swipe that starts on a card scrolls; after the hold, dnd-kit cancels the scroll itself. Checked with CDP touch events at 390: a quick vertical swipe on a card scrolls its column (no drag), a horizontal swipe moves the board exactly one column (snap), hold-and-drag moves a card into the next column. A stylus on a touch screen (`(hover: none)`) also goes to the TouchSensor and its hold, since cards pan there and a pen stroke would otherwise scroll and cancel the drag; a pen where the screen can hover still drags at once (review fix). The other sortable lists keep the plain PointerSensor: the sidebar's projects, TaskDetail's subtasks, LabelTasks on /today/label and /habits. Each drags only from a dedicated grip with `touch-action: none`, so a finger on the grip drags at once and a swipe anywhere else scrolls; there's no scroll gesture to confuse with a drag.
- P5: board under lg: columns are `min(85vw, 320px)` with `scroll-snap-type: x mandatory` and a 12px scroll padding (the next column peeks in by about 30px); snapping is switched off while a card is dragged so it can't fight dnd-kit's auto-scroll (`onDragCancel` now also clears the dragged card, or snapping stayed off after a cancelled drag, and puts the card back in the column it started in, since `onDragOver` had already moved it there optimistically and nothing saved it). Each column is a full-height lane whose card list scrolls on its own (`overscroll-y-contain` only: `contain` on both axes stopped sideways swipes from reaching the board). The header wraps: name and buttons (44px) on top, the status counts on their own scrollable row.
- P5: calendar month under sm: chips don't fit 46px columns, so a cell is one button with the date and up to four dots in the project colours (a dashed ring for a repeat's next occurrence); it picks the day whose list shows below the grid (the week view's day card, `DayCard`), today by default (else the 1st). Any day in the grid can be picked, the few from the months either side included; showing another month drops the pick. Phone and desktop markup are switched with `useMediaQuery` (`lib/use-media-query.ts`), not CSS, because both would mount the same dnd-kit draggable ids. The hook is false where matchMedia is missing (jsdom), so the existing tests see desktop.
- P5: the Unscheduled tray was `hidden lg:flex`, so phones and tablets had no tray at all. Under lg (not just under sm) the header has an "Unscheduled N" button that opens it as a bottom sheet (dialog, focus moved in and back, Escape, Tab wraps, full-width rows). Holding a task fades the sheet out (it stays mounted so the drag survives) and the drop closes it; tapping a task closes it and opens the task. Under lg the calendar's DndContext also has `centerOnPointer` (snapCenterToCursor), so the dragged pill sits under the finger and `closestCenter` picks the day under the finger, not the one under the centre of a screen-wide row. Checked with CDP touch: hold a sheet row, drag onto 27 October, it lands there.
- P5 (review): under sm the calendar title is 22px and the view switch and Unscheduled are a little narrower, so the month header is two rows at 360 and 390 (title and arrows; view switch and Unscheduled). The week and day titles are longer and still put the arrows on a row of their own.
- P5 (review): opening a task from a search result (`/group/<id>?task=<id>`) could silently fail on any screen size, also at e4a0356: the board dropped the param at once, the re-render without it cancelled the task fetch, and a reply slower than that navigation was ignored. The harness's task-detail states started failing on it (timing only, not P5 markup). The param now goes once the task has arrived (or failed to); a test covers the order.
- P5: the week agenda had no vh height, so nothing changed there; `DayPlanner` uses `calc(100dvh - 12rem)`. Time blocks of 30 minutes or more get a 32px control row under lg; shorter blocks keep the 20px row (the timeline is 96px an hour, a 15 minute block is 24px tall).
- P5: /pomodoro overflow (+7px) had two causes, both before touch detection or the stylesheet: the root was `width: 100vw` while body still had its default 8px margin, and the clock's non-touch card sizes (88px minimum) made a 380px row. Fixes, no logic touched: `maxWidth: 100%` on the root, and each digit variable is wrapped in `min(<old clamp>, Nvw)` (19vw wide, 24.6vw tall, about 18vw font, the old proportions), which only changes anything below about 460px wide. Also `100vh` → `100dvh` and safe-area padding on all four sides (env() is 0 on desktop).
- P5: /reports: the project menu is right-aligned under its button; under lg the filters wrap to the left edge, where it stuck out past the screen, so it uses `useFitInViewport`. Chart legends wrap (`flex-wrap`); the charts already sized themselves to their container.
- P5: desktop check: 1280×800 and 1024×768 screenshots of group, calendar month/week/day, habits, review, reports, login, signup and pomodoro against e4a0356 (worktree build, same mock auth and seed) differ in 0 pixels, and the layout box of every element on each page (including what's below the fold in inner scrollers) is identical. /pomodoro needed no masking: with the timer stopped the clock shows a fixed 25:00.

## Mobile harness results

- P0 baseline: 32/34 pass. Only `/pomodoro` overflows (+7px at 360 and 390), from the flip-clock digit row (flex, `gap: clamp(6px,2vw,14px)`). Every page renders signed in through the mock auth. The most small-target warnings are on: calendar-day row controls (20px tall), habits weekday toggles (28×28), month-grid chips (30×24), the today-label A–E filters (20px tall), the Today checkbox (20×20). The board's status-chip strip is squeezed to 40px wide at 360.

## Mobile harness results (after P0 review fixes)

- 32/34 pass; only `/pomodoro` overflows. Tap-target warnings now include content below the first screen: today 13/10, today-label 7, calendar-day 19, habits 11 at 390 and 81 at 360 (history cells are 31×36 at 360), task-detail 17, reports 5.

## Mobile harness results (P5)

- 42/42 pass (new state `calendar-tray`: the Unscheduled sheet). /pomodoro no longer overflows. Tap-target warnings are 0 on group, calendar-month, calendar-week, calendar-day, calendar-tray, habits, review and reports at both viewports (were 4, 19, 11 and 5 on calendar-month, calendar-day, habits and reports). The only warnings left are command-palette (2) and sidebar-drawer (5), from P3's shell.

## Open review findings

- [NIT, P3 → P6] The open drawer doesn't trap focus: Tab past its last item reaches `main` and the tab bar behind the backdrop. Make them `inert` while open, or wrap Tab; use `focus({ preventScroll: true })`.
- [Pre-existing, not ours] `/today` shows two filled orange buttons of its own on every screen size ("Close the day" and the frog card's "Ate it"). Changing it would change desktop, so it's left for the owner to decide.
- [Needs a real iPhone] Notch/home-indicator padding and the black-translucent status bar: Playwright's Chromium reports every `env(safe-area-inset-*)` as 0.


- ~~For P2: confirm the configured `Cache-Control` on `/sw.js`~~ Resolved in P2: `next start` serves `/sw.js` with `no-cache, no-store, must-revalidate`, the configured Content-Type and CSP.
- For P3: `viewportFit: cover` + black-translucent status bar means an installed iPhone app draws under the notch until P3's safe-area padding lands. Must land before merging.

## Blockers

## Summary
