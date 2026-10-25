# Mobile PWA: progress

Spec: `SPEC.md`. Workflow: `WORKFLOW.md`.

## Milestones

- [x] P0: Mobile check harness (b6e6f0e, review fixes in the next commit)
- [x] P1: Installable app (1405c02, tests 7ebd4fd, maskable fix in the next commit)
- [ ] P2: Service worker, offline page, updates
- [ ] P3: Mobile app shell
- [ ] P4: Page pass A (daily flow)
- [ ] P5: Page pass B (planning and insight)
- [ ] P6: Polish and final sweep

## Log

- Plan written: SPEC, WORKFLOW, agent team (`.claude/agents/pwa-*.md`), baselines recorded from `main` at `2f756df`.

- P0: harness built and approved by review; review fixes applied (signal cleanup, below-the-fold tap targets, `--only` validated before seeding, all off-machine requests blocked, full-height screenshots).
- P1: manifest, icons, Apple metadata, proxy matcher, sw.js headers. Gate PASS (unit 1079, UI 164 baseline failures only, integration 1 baseline failure only, build OK, harness unchanged from P0). Review APPROVE; maskable F now drawn at full size (already inside the safe zone).

## Decisions

- P0: the harness measures overflow against the device width (360/390), not `innerWidth`. Chrome's mobile emulation zooms out to fit a too-wide page and grows `innerWidth` to match, so the spec's `scrollWidth <= innerWidth + 1` could never fail (a 520px test element passed under it).
- P0: elements too wide for a page's own `overflow-y-auto` wrapper scroll inside it and don't show in the document check; the harness lists those scrollers as information. The board's `.kanban-canvas` is one, and that's intended.
- P0: the harness builds into the normal `.next` (the output dir can't change without editing `next.config.ts`) and rebuilds when its marker doesn't match. It empties `forma_test`, so it never runs alongside the integration tests.
- P2: the offline page's CSS/JS/fonts are precached by parsing them out of the `/offline` HTML on install (`assetUrlsIn`: every `src`/`href` under `/_next/static/`) and adding them to `forma-static` in the same install as that HTML, so the cached page and its assets always come from one build. Retry is a plain `<a href="">` (reloads the URL the offline copy stands in for, works even without JS); a tiny client component reloads 1 s after `online` if still online.
- P2: `/login` and `/signup` navigations are `network-only`: never stored, but the offline page is served when the network fails (instead of the browser's error page). Every other rule-2 path (and any non-navigation request to /login, /signup) passes through untouched.
- P2: a navigation that times out (5 s) serves the stored copy if there is one; with none it keeps waiting for the network instead of calling a slow connection offline.
- P2: the update toast sits at `bottom: calc(5rem + safe-area-inset-bottom)` with 16px gutters under `lg` (clears the P3 tab bar and the floating add button), bottom-right at `lg`. It has a Dismiss icon button besides Reload.
- P2: `OfflineBanner` is built but not mounted: the shell is a flex row today, so the bar would either overlap the page (fixed) or squash it (in flow). P3 mounts it when it restructures the shell.
- P2: sign-out deletes `forma-pages-*` through the worker (`CLEAR_RUNTIME_CACHES`, 1 s cap); if no worker is running it deletes them from the page directly. `forma-static-*` (no user data) stays.
- P1: Next 16 emits `mobile-web-app-capable`, not `apple-mobile-web-app-capable`. Not adding the apple- tag: iOS 16.4+ launches standalone from the manifest. Check the status bar on a real iPhone in P3; add the tag via `other` only if it shows opaque.

## Mobile harness results

- P0 baseline: 32/34 pass. Only `/pomodoro` overflows (+7px at 360 and 390), from the flip-clock digit row (flex, `gap: clamp(6px,2vw,14px)`). Every page renders signed in through the mock auth. The most small-target warnings are on: calendar-day row controls (20px tall), habits weekday toggles (28×28), month-grid chips (30×24), the today-label A–E filters (20px tall), the Today checkbox (20×20). The board's status-chip strip is squeezed to 40px wide at 360.

## Mobile harness results (after P0 review fixes)

- 32/34 pass; only `/pomodoro` overflows. Tap-target warnings now include content below the first screen: today 13/10, today-label 7, calendar-day 19, habits 11 at 390 and 81 at 360 (history cells are 31×36 at 360), task-detail 17, reports 5.

## Open review findings

- ~~For P2: confirm the configured `Cache-Control` on `/sw.js`~~ Resolved in P2: `next start` serves `/sw.js` with `no-cache, no-store, must-revalidate`, the configured Content-Type and CSP.
- For P3: `viewportFit: cover` + black-translucent status bar means an installed iPhone app draws under the notch until P3's safe-area padding lands. Must land before merging.

## Blockers

## Summary
