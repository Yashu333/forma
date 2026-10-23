# Eat That Frog — Build Workflow (for the orchestrating session)

You are the **orchestrator**. You don't write feature code yourself: you run the team in `.claude/agents/`, keep `PROGRESS.md` current, and commit and push after each milestone. Build everything in `SPEC.md`, milestone by milestone (M0 → M6, then M7 if time allows), while the user is asleep. Don't stop to ask the user questions: product decisions are already in `SPEC.md`. When something is genuinely ambiguous, pick the option most consistent with the spec and the existing code, record it under **Decisions** in `PROGRESS.md`, and keep going.

## The team

| Agent | File | Role |
|---|---|---|
| `frog-developer` | `.claude/agents/frog-developer.md` | Implements one milestone; fixes test failures and review findings. |
| `frog-tester` | `.claude/agents/frog-tester.md` | Writes and extends tests, then runs the full **Gate**. Doesn't edit product code. |
| `frog-reviewer` | `.claude/agents/frog-reviewer.md` | Read-only review of the milestone diff against the spec. Returns APPROVE or CHANGES_REQUESTED. |

**If those names aren't available as `subagent_type`s** (agent files added mid-session may not load until restart), spawn `general-purpose` instead with a prompt that starts: *"Read `.claude/agents/frog-developer.md` and follow it exactly as your role instructions. Then: …"* (same for tester and reviewer). Use `run_in_background: false` for each step, because each step depends on the previous one.

## One-time setup (also after any container restart)

```bash
cd /home/user/forma
git checkout claude/eat-that-frog && git pull origin claude/eat-that-frog || true
npm ci --no-audit --no-fund          # node_modules is not committed
npx prisma generate
bash scripts/test-db.sh              # local Postgres + fresh migrated DB + drift check
```

## The Gate (definition of "green")

The tester runs all of these. A milestone can't be committed unless every one passes:

1. `npx prisma validate` and `bash scripts/test-db.sh`: migrations apply to a fresh DB, no drift.
2. `npx tsc --noEmit`: zero errors.
3. **Lint, no new problems.** The baseline before this work is **16 problems (10 errors, 6 warnings)**, all in pre-existing files: `app/(timer)/pomodoro/page.tsx`, `components/board/KanbanBoard.tsx`, `components/board/ProjectSettingsModal.tsx`, `components/dashboard/Greeting.tsx`, `components/reports/ReportsDashboard.tsx`, `components/sidebar/Sidebar.tsx`, `components/ui/DatePicker.tsx`. Run `npx eslint .`: the total must not go above 16. Every file created or changed in this milestone must have **zero** problems that weren't there before (`npx eslint <files>`; compare with `git stash`, or with the baseline for those pre-existing files).
4. `npm test`: unit tests pass (from M0 on).
5. `npm run test:integration`: integration tests pass (from M0 on).
6. Production build:
   `DATABASE_URL=postgres://x:y@localhost:5432/x NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx next build` succeeds.

## The loop (per milestone)

```
for M in M0..M6 (then M7 if time permits):
  1. Mark M "in progress" in PROGRESS.md.
  2. DEVELOP  → frog-developer: "Implement <M> from docs/eat-that-frog/SPEC.md." Include any notes from PROGRESS.md.
  3. TEST     → frog-tester: "Test <M>." It writes or extends tests for M, then runs the Gate.
       FAIL → frog-developer with the tester's exact failure output → back to step 3.
              At most 3 fix rounds; then see "When stuck".
  4. REVIEW   → frog-reviewer: "Review <M>. Diff: git diff HEAD (plus untracked files)."
       CHANGES_REQUESTED → frog-developer fixes the findings → frog-tester re-runs the Gate → frog-reviewer re-reviews.
              At most 2 review rounds; after that, record the remaining non-blocking findings in PROGRESS.md and continue.
              BLOCKING findings (security, data loss, wrong spec behaviour, broken build) must be fixed — no round limit.
  5. COMMIT   → yourself: git add -A (check `git status` first — never commit .env*, node_modules, .next)
                 git commit -m "<M>: <summary>"  (message ends with the attribution lines below)
                 git push -u origin claude/eat-that-frog   (on network failure, retry 4× with 2s/4s/8s/16s backoff)
  6. Update PROGRESS.md (tick M, short log line with the commit hash), commit and push it.
```

Commit message footer (required): end every commit message with the attribution lines your session's system reminder gives you (`Co-Authored-By: …` and `Claude-Session: …`).

## Rules

- Work **only** on branch `claude/eat-that-frog`. Never push to `main`. **Don't open a pull request** — the user will review in the morning and decide.
- Never apply migrations to any real or remote database. Only the local `forma_test` DB. Don't create `.env.local`.
- Don't modify Pomodoro or Spotify code, or the existing reports logic beyond adding the Frog section.
- Don't "fix" the pre-existing lint errors (out of scope, and it bloats the diff).
- Don't skip, disable or weaken a test to get green.
- Keep each agent's prompt self-contained: agents start cold. Tell them the milestone, point them to `SPEC.md`, and paste any failure output or findings verbatim.

## When stuck

If a milestone can't reach green after the round limits: commit nothing broken. Run `git stash` (or `git stash -u`) to save the work-in-progress under the name `wip-<M>`, write the blocker in detail under **Blockers** in `PROGRESS.md` (what fails, the output, what was tried), commit and push PROGRESS.md, then continue with the next milestone **only if it doesn't depend on the blocked one** (M3 depends on M1; M4 on M3; M5 on M4; M6 on M3). Otherwise stop and write the morning summary.

## Finish: morning summary

When done (or stopped), fill in the **Morning summary** section of `PROGRESS.md`:
- what was built, per milestone, with commit hashes;
- Gate results on the final commit (paste the test counts);
- decisions you made on the user's behalf;
- open review findings and blockers;
- **what the user must do to try it:**
  1. `git checkout claude/eat-that-frog && npm install`
  2. apply the migration to their Supabase DB: `npx prisma migrate deploy` (uses `DIRECT_URL` from `.env.local`)
  3. `npm run dev` → open `/today`.

Commit and push it. That is the last action.
