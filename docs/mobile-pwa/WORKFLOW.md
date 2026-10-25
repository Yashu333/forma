# Mobile PWA: build workflow (for the orchestrating session)

You are the **orchestrator**. You don't write feature code: you run the team in `.claude/agents/pwa-*.md`, keep `PROGRESS.md` current, and commit and push after each milestone. Build `SPEC.md` milestone by milestone, P0 → P6. Don't stop to ask the user: product decisions are in `SPEC.md`. When something is genuinely ambiguous, pick the option most consistent with the spec and the existing code, record it under **Decisions** in `PROGRESS.md`, and keep going.

## The team

| Agent | File | Role |
|---|---|---|
| `pwa-developer` | `.claude/agents/pwa-developer.md` | Implements one milestone; fixes Gate failures and review findings. |
| `pwa-tester` | `.claude/agents/pwa-tester.md` | Writes tests (and in P0 the mobile harness), then runs the full Gate. Doesn't edit product code. |
| `pwa-reviewer` | `.claude/agents/pwa-reviewer.md` | Read-only review of the milestone diff against the spec and the Ember rules. APPROVE or CHANGES_REQUESTED. |

If those names aren't available as `subagent_type`s, spawn `general-purpose` with a prompt that starts: *"Read `.claude/agents/pwa-developer.md` and follow it exactly as your role instructions. Then: …"*. Run steps in the foreground: each depends on the last. Never run two agents that use the test DB or the port-3100 server at the same time.

P0 is tooling, so the tester builds it (the harness is test code); the developer is only called in P0 to fix product bugs the harness exposes, which P0 doesn't do.

## Setup (also after a container restart)

```bash
cd /home/user/forma
git checkout feature/mobile-pwa && git pull origin feature/mobile-pwa || true
npm ci --no-audit --no-fund
npx prisma generate
bash scripts/test-db.sh
```

## Baseline on `main` (not ours to fix)

`main` was already partly red when this branch started. The Gate checks for **no new problems**, not zero:

- `npx tsc --noEmit`: 17 errors, listed in `baseline-tsc-errors.txt` (file and message, line numbers stripped).
- `npm run test:ui`: 164 failing tests (165 on one run: one is flaky), listed in `baseline-ui-failures.txt`.
- `npm run test:integration`: 1 failing test, in `baseline-integration-failures.txt`.
- `npx eslint .`: 14 problems (8 errors, 6 warnings).
- `npm test` (unit): 1023 passing, 0 failing.

Don't fix baseline failures (out of scope), unless a milestone's own change touches that exact code and the fix is a one-liner; then record it in `PROGRESS.md`.

## The Gate (definition of "green")

1. `npx tsc --noEmit`: the set of errors (file + message, no line numbers) is a subset of `baseline-tsc-errors.txt`.
2. `npx eslint .`: total ≤ 14; every file created or changed in this milestone has zero problems that weren't there before.
3. `npm test`: all pass.
4. `npm run test:ui`: every failing test is in `baseline-ui-failures.txt`, and every new test passes. Check with the JSON reporter (`npx vitest run --project ui --reporter=json --outputFile=…`).
5. `npm run test:integration`: failures ⊆ `baseline-integration-failures.txt`. Only needed when the milestone touched `app/api`, `lib/` server code, `prisma/` or `proxy.ts`, plus always in P6.
6. Production build: `DATABASE_URL=postgres://x:y@localhost:5432/x NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx next build` succeeds.
7. From P0 on: `npm run test:mobile` runs. From P3 on, every page the milestone touched has zero overflow at both viewports; P6 requires every page clean.

## The loop (per milestone)

```
for M in P0..P6:
  1. Mark M "in progress" in PROGRESS.md.
  2. DEVELOP → pwa-developer: "Implement <M> from docs/mobile-pwa/SPEC.md." Include notes from PROGRESS.md. (P0: pwa-tester builds the harness instead.)
  3. TEST    → pwa-tester: "Test <M>." Writes tests, runs the Gate.
       FAIL → pwa-developer with the tester's exact output → step 3. At most 3 rounds, then "When stuck".
  4. REVIEW  → pwa-reviewer: "Review <M>." Diff: git diff HEAD plus untracked files.
       CHANGES_REQUESTED → developer fixes → tester re-runs Gate → reviewer re-reviews. At most 2 rounds;
       then record non-blocking findings in PROGRESS.md and continue. BLOCKING findings (security, caching
       user data, broken desktop layout, broken build, spec violation) must be fixed: no round limit.
  5. COMMIT  → git status first; never commit .env*, node_modules, .next, .mobile-shots.
               git commit -m "<M>: <summary>" (end with the session's attribution lines)
               git push -u origin feature/mobile-pwa (retry 4× with 2s/4s/8s/16s on network errors)
  6. Tick M in PROGRESS.md with the commit hash; commit and push.
```

## Rules

- Branch `feature/mobile-pwa` only. Never push to `main`. Don't open a pull request.
- Never touch a real or remote database or real Supabase. Only local `forma_test` and the harness's mock auth server. Don't create `.env.local`.
- Desktop (`lg` and up) must look and behave as before. Mobile changes go behind `max-lg:`/`lg:` variants, or behind media queries.
- No changes to Pomodoro or Spotify logic (P5 allows only the viewport-height and safe-area edits).
- Don't skip, disable or weaken a test to get green.
- Agent prompts are self-contained: name the milestone, point to `SPEC.md`, paste failure output and findings verbatim.

## When stuck

Commit nothing broken. `git stash -u` the work under `wip-<M>`, write the blocker under **Blockers** in `PROGRESS.md` (what fails, the output, what was tried), commit and push PROGRESS.md, and continue with the next milestone if it doesn't depend on the blocked one. Dependencies: P2 needs P1; P3 needs P2 (it mounts the banner and the install button); P4–P6 need P3. P0 blocks nothing (later milestones fall back to review plus jsdom tests).

## Finish

Fill in **Summary** in `PROGRESS.md`: what was built per milestone with commit hashes, final Gate numbers, the final mobile harness table, decisions made, open findings and blockers, and how the user tries it:

1. `git checkout feature/mobile-pwa && npm install`
2. `npm run build && npm start`, then open the site on a phone. Installing needs HTTPS, so test on a Vercel preview deploy or through a tunnel; `localhost` on the computer itself also counts as secure for Chrome's install prompt.
3. Android Chrome: menu → Install app. iPhone Safari: Share → Add to Home Screen.

Commit and push. That's the last action.
