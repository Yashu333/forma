# Mobile PWA: progress

Spec: `SPEC.md`. Workflow: `WORKFLOW.md`.

## Milestones

- [x] P0: Mobile check harness (b6e6f0e, review fixes in the next commit)
- [ ] P1: Installable app
- [ ] P2: Service worker, offline page, updates
- [ ] P3: Mobile app shell
- [ ] P4: Page pass A (daily flow)
- [ ] P5: Page pass B (planning and insight)
- [ ] P6: Polish and final sweep

## Log

- Plan written: SPEC, WORKFLOW, agent team (`.claude/agents/pwa-*.md`), baselines recorded from `main` at `2f756df`.

- P0: harness built and approved by review; review fixes applied (signal cleanup, below-the-fold tap targets, `--only` validated before seeding, all off-machine requests blocked, full-height screenshots).

## Decisions

- P0: the harness measures overflow against the device width (360/390), not `innerWidth`. Chrome's mobile emulation zooms out to fit a too-wide page and grows `innerWidth` to match, so the spec's `scrollWidth <= innerWidth + 1` could never fail (a 520px test element passed under it).
- P0: elements too wide for a page's own `overflow-y-auto` wrapper scroll inside it and don't show in the document check; the harness lists those scrollers as information. The board's `.kanban-canvas` is one, and that's intended.
- P0: the harness builds into the normal `.next` (the output dir can't change without editing `next.config.ts`) and rebuilds when its marker doesn't match. It empties `forma_test`, so it never runs alongside the integration tests.

## Mobile harness results

- P0 baseline: 32/34 pass. Only `/pomodoro` overflows (+7px at 360 and 390), from the flip-clock digit row (flex, `gap: clamp(6px,2vw,14px)`). Every page renders signed in through the mock auth. The most small-target warnings are on: calendar-day row controls (20px tall), habits weekday toggles (28×28), month-grid chips (30×24), the today-label A–E filters (20px tall), the Today checkbox (20×20). The board's status-chip strip is squeezed to 40px wide at 360.

## Mobile harness results (after P0 review fixes)

- 32/34 pass; only `/pomodoro` overflows. Tap-target warnings now include content below the first screen: today 13/10, today-label 7, calendar-day 19, habits 11 at 390 and 81 at 360 (history cells are 31×36 at 360), task-detail 17, reports 5.

## Open review findings

## Blockers

## Summary
