# Eat That Frog — Progress

Branch: `claude/eat-that-frog` · Spec: [SPEC.md](./SPEC.md) · How it's built: [WORKFLOW.md](./WORKFLOW.md)

## Milestones

- [x] M0 — Test infrastructure (vitest, integration helpers, test DB)
- [ ] M1 (in progress) — Schema + migration + `lib/frog` pure logic
- [ ] M2 — ABCDE on tasks (API + TaskDetail + TaskCard)
- [ ] M3 — Today API (get / candidates / put)
- [ ] M4 — `/today` page: Plan my day + Today view + frog card
- [ ] M5 — Reflect: Close the day + streak
- [ ] M6 — Reports Frog section + dashboard frog card
- [ ] M7 — *(stretch)* Frog-first mode

## Log

<!-- one line per event: date · milestone · what happened · commit -->
- 2026-10-23 · plan · Spec, workflow, agent team and `scripts/test-db.sh` created. Baseline: tsc clean, build OK, lint 16 problems (pre-existing), migrations apply to local Postgres with no drift.
- 2026-10-24 · M0 · Done. Tester: Gate green (unit 2, integration 9). Reviewer: APPROVE, 3 nits. Commit 1998d61.

## Decisions

<!-- choices made on the user's behalf during the build -->
- Custom agent types (`frog-*`) didn't load in this session, so the workflow's fallback is used: `general-purpose` agents told to follow `.claude/agents/frog-*.md`.
- vitest pinned at 3.2.7: vitest 5 rejects the project's `@types/node@^20` peer, and 4.1.12 crashed npm's arborist on install. Did not bump `@types/node`.
- `fileParallelism: false` is global in `vitest.config.ts` (vitest 3 only accepts it at the root); integration files share one DB so they run serially.
- Integration setup (Supabase mock + DB reset per test) lives in `tests/integration/setup.ts`; tests must not call a per-file setup function.
- M0 was committed (1998d61) before the reviewer finished, as a checkpoint after the tester passed the Gate; the reviewer then approved it, so no follow-up commit was needed.

## Blockers

## Open review findings (non-blocking)

- M0 nit: `resetDb` guard checks `process.env.DATABASE_URL`, while `lib/db.ts` captures it at import. Optional hardening: also `SELECT current_database()` and require a `_test` suffix.
- M0 nit: `infra.test.ts` isolation pair relies on in-order execution; would be flaky if `sequence.shuffle` were enabled.

## Morning summary

_Not written yet._
