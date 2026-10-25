# Mobile PWA: progress

Spec: `SPEC.md`. Workflow: `WORKFLOW.md`.

## Milestones

- [x] P0: Mobile check harness (b6e6f0e, review fixes 2ee49cb)
- [x] P1: Installable app (1405c02, tests 7ebd4fd, maskable fix e93e457)
- [x] P2: Service worker, offline page, updates (d3bf21d, tests 3d2ce73/d1eeebb, review fixes 8626ead)
- [x] P3: Mobile app shell (c63ad3c, tests 195c9d3, review fixes 7ae1b93)
- [x] P4: Page pass A (daily flow) (2ae563a, tests bdb2559/35891b8, fixes e4a0356)
- [x] P5: Page pass B (planning and insight) (b2a7158, tests fecb71f, fixes 1c40ffd)
- [x] P6: Polish and final sweep (9a4975b, tests 4989a08, fixes b3d6e86)

## Log

- Plan written: SPEC, WORKFLOW, agent team (`.claude/agents/pwa-*.md`), baselines recorded from `main` at `2f756df`.

- P0: harness built and approved by review; review fixes applied (signal cleanup, below-the-fold tap targets, `--only` validated before seeding, all off-machine requests blocked, full-height screenshots).
- P1: manifest, icons, Apple metadata, proxy matcher, sw.js headers. Gate PASS (unit 1079, UI 164 baseline failures only, integration 1 baseline failure only, build OK, harness unchanged from P0). Review APPROVE; maskable F now drawn at full size (already inside the safe zone).
- P2: Gate PASS (unit 1157, UI baseline failures only, build OK, harness unchanged). Review APPROVE; 10 findings fixed in 8626ead (incl. clearing cached pages whenever /login or /signup loads, page-side clear on sign-out) and re-review APPROVE.
- P3: Gate PASS (unit 1175, UI baseline failures only, build OK, harness: every page clean except /pomodoro, which is P5). Review CHANGES_REQUESTED → 10 fixes in 7ae1b93 (outlined Add, drawer hidden when closed + focus in/out, Escape, install prompt captured on every page) → re-review APPROVE. Desktop pixel diff vs c24ae4e: 0 on dashboard, today, group, calendar, habits.
- P4: tap-target warnings 0 on today, today-label, today-new, task-detail (+ new harness states today-close, task-detail-date, task-detail-abcde). Desktop pixel diff vs 7ae1b93: 0 on 5 pages. Review APPROVE. Gate FAIL on 2 new tests (useFitInViewport didn't reset its shift on close) → fixed with the review items (habit hit areas no longer overlap, Rough sheet nowrap scoped, focus ring on the inner box under lg, pill row aligned, habit names truncate with title).
- P5: harness 42/42 (new state calendar-tray), /pomodoro fixed; desktop pixel and box diff vs e4a0356: 0 on 10 pages at 1280 and 1024. Review APPROVE. Gate FAIL on 1 new test (phone month grid ignored taps on days outside the month) → fixed with the review items (pen on touch screens, restore column on cancelled drag, stable media-query subscription, compact calendar header, habits gap) plus a pre-existing `?task=` race; re-review APPROVE.
- P6: shortcuts, `?capture=1`, drawer focus trap, standalone CSS, last tap targets, README. Review APPROVE (with a whole-branch pass). Final Gate PASS on 4989a08: tsc baseline only, eslint 13 (≤14), unit 1209, UI 164 baseline failures only, integration 1 baseline failure only, build OK, harness 42/42 with 0 overflow and 0 small targets. Browser smoke 5/6, Escape over a lingering tooltip needed two presses → fixed in b3d6e86 with the review items (Pomodoro links stay inside the installed app, README notes, shared under-lg query); smoke 6/6 in 4 runs, desktop diff vs 9a4975b 0.

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

- P6: shortcut icons are drawn by `scripts/generate-icons.mjs` from lucide-react's own icon data (`__iconNode` in `lucide-react/dist/esm/icons/<name>.mjs`: Sun, Plus, CalendarDays, as in the tab bar), on the favicon's rounded square in the F's colour, stroke 2.5 on the 24 grid scaled to 20 of the favicon's 32 units. 96×96, transparent corners like the `any` icons. `CACHE_VERSION` stays 1 (the manifest and icons changed, but no version has shipped).
- P6: `?capture=1` is read by `CommandPalette` (mounted once in the app layout) on load and whenever the path changes. It opens add mode and drops the param with `history.replaceState` (other params and the hash kept), not `router.replace`: no server round trip, nothing in flight cancelled. Both happen one tick after the effect, because on the first load child effects run before the app router's effect that hooks `replaceState`; only the hooked version keeps Next's history state (`__NA`) and updates `useSearchParams`. Checked in the built app: `/today?capture=1&x=2` opens Add task with the field focused, the URL becomes `/today?x=2`, the history entry keeps `__NA`, Today still loads, a reload doesn't reopen it, and Back from another page returns to Today. /today reads no search params.
- P6: standalone niceties are one `@media (display-mode: standalone)` block in `globals.css`: `nav`, `.nav-chrome` (the sidebar `aside`) and every `button` get `user-select: none` and `-webkit-touch-callout: none`; fields inside nav chrome stay selectable (an iOS Safari input under `user-select: none` can refuse typing). Content isn't touched. Chromium can't emulate `display-mode`, so it was checked by applying the built rule's body directly: tab bar and sidebar links, buttons → none; page headings and text → auto; the display-name field → text, typing works. External links: the only links that leave the origin are the Spotify track links on /pomodoro, which already have `target="_blank" rel="noopener noreferrer"`; the other `target="_blank"` links (Focus → `/pomodoro`) are same-origin and stay as they are. Spotify's connect flow (`location.href = "/api/spotify/auth"`) is untouched (no Spotify changes).
- P6: the open drawer makes `main` and the tab bar `inert` under lg (`useMediaQuery("(width < 64rem)")`), released on close, on navigation and when the window grows to lg; never at lg. Dismissing releases them before handing focus back to More (an inert button can't take focus). Focus moves use `preventScroll`. In the built app, 25 Tabs from the open drawer cycle through its own items (and the browser chrome) only.
- P6: remaining small targets were real P3 shell controls; under lg the palette's Add task/Search toggles are 44px tall hit areas around the same 28px pill (negative margins, ring on the pill), the drawer's logo link and Projects toggle are 44px tall, project grips 32×32 (like TaskDetail's subtask grips; the row is 32px), and the display-name button a 32px hit area that reaches into the row above the name.

## Mobile harness results

- P0 baseline: 32/34 pass. Only `/pomodoro` overflows (+7px at 360 and 390), from the flip-clock digit row (flex, `gap: clamp(6px,2vw,14px)`). Every page renders signed in through the mock auth. The most small-target warnings are on: calendar-day row controls (20px tall), habits weekday toggles (28×28), month-grid chips (30×24), the today-label A–E filters (20px tall), the Today checkbox (20×20). The board's status-chip strip is squeezed to 40px wide at 360.

## Mobile harness results (after P0 review fixes)

- 32/34 pass; only `/pomodoro` overflows. Tap-target warnings now include content below the first screen: today 13/10, today-label 7, calendar-day 19, habits 11 at 390 and 81 at 360 (history cells are 31×36 at 360), task-detail 17, reports 5.

## Mobile harness results (P5)

- 42/42 pass (new state `calendar-tray`: the Unscheduled sheet). /pomodoro no longer overflows. Tap-target warnings are 0 on group, calendar-month, calendar-week, calendar-day, calendar-tray, habits, review and reports at both viewports (were 4, 19, 11 and 5 on calendar-month, calendar-day, habits and reports). The only warnings left are command-palette (2) and sidebar-drawer (5), from P3's shell.

## Mobile harness results (P6, final)

- 42/42 pass, 0 overflow, 0 small-target warnings on every page at both viewports (command-palette 2 and sidebar-drawer 5 are cleared). Only inner scroller: the board's `.kanban-canvas` (intended). Mock auth only, no off-machine requests.

| Page              | 390x844 | 360x740 |
|-------------------|---------|---------|
| login             | pass    | pass    |
| signup            | pass    | pass    |
| dashboard         | pass    | pass    |
| today             | pass    | pass    |
| today-label       | pass    | pass    |
| today-new         | pass    | pass    |
| group             | pass    | pass    |
| calendar-month    | pass    | pass    |
| calendar-week     | pass    | pass    |
| calendar-day      | pass    | pass    |
| calendar-tray     | pass    | pass    |
| habits            | pass    | pass    |
| review            | pass    | pass    |
| reports           | pass    | pass    |
| pomodoro          | pass    | pass    |
| task-detail       | pass    | pass    |
| task-detail-date  | pass    | pass    |
| task-detail-abcde | pass    | pass    |
| today-close       | pass    | pass    |
| command-palette   | pass    | pass    |
| sidebar-drawer    | pass    | pass    |

## Open review findings

- ~~[NIT, P3 → P6] The open drawer doesn't trap focus~~ Fixed in P6: `main` and the tab bar are `inert` while it's open under lg; focus moves use `preventScroll`.
- [Pre-existing, not ours] `/today` shows two filled orange buttons of its own on every screen size ("Close the day" and the frog card's "Ate it"). Changing it would change desktop, so it's left for the owner to decide.
- [Needs a real iPhone] Notch/home-indicator padding and the black-translucent status bar: Playwright's Chromium reports every `env(safe-area-inset-*)` as 0.


- ~~For P2: confirm the configured `Cache-Control` on `/sw.js`~~ Resolved in P2: `next start` serves `/sw.js` with `no-cache, no-store, must-revalidate`, the configured Content-Type and CSP.
- ~~For P3: an installed iPhone app draws under the notch until P3's safe-area padding lands~~ Resolved in P3 (`pt-safe`/`pb-safe`/`px-safe` on the shell, drawer, tab bar and sheets); a device check is still listed under "Needs a real iPhone".
- [Merge note] `sharp` (icon script and icon tests) arrives as Next's optional dependency and isn't declared; a CI install with `--omit=optional` would break those tests.

## Blockers

## Summary

Built on `feature/mobile-pwa` from `main` at `2f756df`, P0 → P6, each through develop → test (Gate) → review.

**What Forma does on a phone now**
- Installs to the home screen (Android: Chrome menu or the in-app "Install app" row; iPhone: Safari Share → Add to Home Screen, with in-app instructions). Opens full screen on /today, with its own icons and three long-press shortcuts (Today, Quick add, Calendar).
- Opens fast from cache and shows a styled "You're offline" page instead of the browser's error; pages already visited show their last copy. Never caches API data, auth or RSC; sign-out (and any load of /login without a session) clears the stored pages.
- Shows "A new version of Forma is ready" with Reload when the service worker changes.
- Bottom tab bar (Today, Board, Add, Calendar, More) under 1024px, notch and home-indicator spacing, offline bar, no zoom on text fields.
- Every page fits 360px and 390px with no sideways overflow and no tap target under 32px. Board columns swipe and snap; hold to drag (cards, calendar items, stylus too). Calendar month shows dots on phones, the Unscheduled tray is a bottom sheet. Task detail is a full-screen sheet.
- Desktop (1024px and up) is pixel-identical to `main`'s rendering on every page compared.

**Final numbers** (b3d6e86, against the baselines from `main`): tsc 17 errors, all pre-existing; eslint 13 (main had 14); unit 1210 pass; UI 164 failures, exactly the pre-existing list; integration 1 failure, the pre-existing recurrence test; build OK; harness 42/42, 0 overflow, 0 small targets.

**Bugs fixed along the way that also affect desktop**
- Opening a task from search (`?task=`) could silently do nothing on a slow reply.
- A cancelled drag on the board left the card in the wrong column until refresh.
- Touch drag on the board started immediately instead of after the intended 200ms hold.

**Decisions for the owner**
- The floating orange "+" button has always shown on desktop (its `lg:hidden` never worked). It's now hidden only on phones; keep or drop it on desktop?
- /today has two filled orange buttons ("Close the day", "Ate it") on every screen size, against Ember's one-per-view rule.
- Keep the build scaffolding in `main` (`.claude/agents/pwa-*.md`, `docs/mobile-pwa/WORKFLOW.md`, `baseline-*.txt`), or drop it before merging?
- `main` already has 17 TypeScript errors, 164 failing component tests and 1 failing integration test; worth a separate cleanup.

**Check on a real phone** (can't be emulated here): see README "Check on a real phone": notch and home-indicator padding, the iPhone status bar, the install flow on Android and iOS, Pomodoro from the installed app, pen drag on an iPad, Android shortcut icons.

**To try it**
1. `git checkout feature/mobile-pwa && npm install`
2. `npm run build && npm start`, then open it on a phone. Installing needs HTTPS: use a Vercel preview deploy or a tunnel (`localhost` on the computer itself also counts as secure).
3. Android Chrome: menu → Install app. iPhone Safari: Share → Add to Home Screen.
