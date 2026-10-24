"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import type { TodayPayload, TodayTask } from "@/types";
import { formatDateKeyLong } from "@/lib/frog/dayview";
import {
  MAX_REVIEW_TEXT,
  buildReviewBody,
  countMoves,
  doneTodayLine,
  frogOutcome,
  initialMoves,
  initialReflection,
  moveFor,
  reflectionProblem,
  resolveTomorrowFrog,
  reviewSteps,
  sortDone,
  tomorrowCandidates,
  unfinishedTasks,
  type MoveAction,
  type MoveChoices,
  type ReflectionDraft,
  type StepId,
} from "@/lib/frog/review";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { saveReview } from "./api";
import RadioGroup from "./RadioGroup";
import { AbcdeBadge, FROG, FrogIcon, ProjectChip } from "./bits";

interface Props {
  payload: TodayPayload;
  tz: string;
  /** The server's answer to the save: the payload with the day closed. */
  onSaved: (payload: TodayPayload) => void;
  onCancel: () => void;
}

const STEP_LABEL: Record<StepId, string> = { done: "Done", unfinished: "Unfinished", reflect: "Reflect", frog: "Frog" };

const cardStyle = { background: "var(--surface)", border: "1px solid var(--border)" } as const;
const errorStyle = { color: "var(--danger)", background: "var(--surface)", border: "1px solid var(--danger)" } as const;

const MOVE_OPTIONS: { value: MoveAction; label: string; color: string }[] = [
  { value: "tomorrow", label: "Tomorrow", color: "var(--primary)" },
  { value: "backlog", label: "Backlog", color: "var(--input)" },
  { value: "archive", label: "Archive", color: "var(--danger)" },
];
const MOVE_VALUES = MOVE_OPTIONS.map((o) => o.value);

const RATINGS = [
  { value: 1, word: "Rough" },
  { value: 2, word: "Meh" },
  { value: 3, word: "Okay" },
  { value: 4, word: "Good" },
  { value: 5, word: "Great" },
] as const;

/**
 * The evening flow: Done today, Unfinished, Reflect, Tomorrow's frog. Steps that
 * have nothing to decide are left out (no unfinished tasks, nobody going to
 * tomorrow). Nothing is sent until the last step's Save. Also used to edit the
 * review of a day that was already closed (the reflection starts prefilled).
 */
export default function CloseDayFlow({ payload, tz, onSaved, onCancel }: Props) {
  const unfinished = useMemo(() => unfinishedTasks(payload.tasks), [payload.tasks]);
  const [moves, setMoves] = useState<MoveChoices>(() => initialMoves(unfinished));
  const [reflection, setReflection] = useState<ReflectionDraft>(() => initialReflection(payload.plan));
  // undefined = not touched (suggest one), null = Skip, string = picked.
  const [frogChoice, setFrogChoice] = useState<string | null | undefined>(undefined);
  const [stepId, setStepId] = useState<StepId>("done");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const savingRef = useRef(false); // a second click can land before the re-render disables the button
  const confirmedArchive = useRef<string | null>(null); // the archive set the user already OK'd (a retry doesn't ask again)

  const candidates = tomorrowCandidates(unfinished, moves);
  const frogId = resolveTomorrowFrog(candidates, frogChoice);
  const steps = reviewSteps(unfinished.length > 0, candidates.length > 0);
  const index = Math.max(0, steps.indexOf(stepId));
  const current = steps[index];
  const last = index === steps.length - 1;
  const moveCounts = countMoves(unfinished, moves);
  const problem = reflectionProblem(reflection);

  // The page scrolls inside the Shell container: bring the top of the next step into view.
  const topRef = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const top = topRef.current;
    if (top && typeof top.scrollIntoView === "function") top.scrollIntoView({ block: "start" });
  }, [current]);

  async function save() {
    if (savingRef.current || reflectionProblem(reflection)) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const body = buildReviewBody({ date: payload.date, tz, unfinished, moves, reflection, tomorrowFrogTaskId: frogId });
      onSaved(await saveReview(body));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the review");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // Archiving hides tasks from their boards, so it is confirmed once, on Save.
  function onSaveClick() {
    if (saving || problem) return;
    const archiveKey = unfinished.filter((t) => moveFor(moves, t.id) === "archive").map((t) => t.id).join(",");
    if (moveCounts.archive > 0 && confirmedArchive.current !== archiveKey) setConfirming(true);
    else void save();
  }
  // Stable: ConfirmDialog re-runs its focus effect whenever this changes.
  const cancelConfirm = useCallback(() => setConfirming(false), []);

  const nextBlocked = current === "reflect" && problem !== null;

  return (
    <div ref={topRef} className="p-5 md:p-7 max-w-3xl mx-auto text-foreground">
      {confirming && (
        <ConfirmDialog
          title={`Archive ${moveCounts.archive} ${moveCounts.archive === 1 ? "task" : "tasks"}?`}
          message="Archived tasks are hidden from the board and kept for reports."
          confirmLabel="Archive and close"
          onConfirm={() => {
            confirmedArchive.current = unfinished.filter((t) => moveFor(moves, t.id) === "archive").map((t) => t.id).join(",");
            setConfirming(false);
            void save();
          }}
          onCancel={cancelConfirm}
        />
      )}

      <div className="mb-5">
        <h1 className="text-[28px] sm:text-4xl font-semibold tracking-[-0.025em] leading-[1.1]">{payload.plan?.reviewedAt ? "Edit your review" : "Close the day"}</h1>
        <p className="text-sm mt-2 text-muted-foreground">{formatDateKeyLong(payload.date)}</p>
      </div>

      <ol className="flex flex-wrap items-center gap-2 mb-5" aria-label="Steps">
        {steps.map((id, i) => {
          const active = i === index;
          const done = i < index;
          return (
            <li key={id} className="flex items-center gap-2 min-w-0" aria-current={active ? "step" : undefined}>
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 tabular ${
                  active || done ? "bg-primary text-primary-foreground" : "bg-raised text-subtle border border-border-strong"
                }`}
              >
                {done ? <Check className="w-3 h-3" aria-hidden="true" /> : i + 1}
              </span>
              <span className={`text-xs font-medium ${active ? "text-foreground" : "text-subtle"}`}>{STEP_LABEL[id]}</span>
              {i < steps.length - 1 && <span className="w-3 sm:w-8 h-px bg-border-strong" />}
            </li>
          );
        })}
      </ol>

      {current === "done" && <DoneStep payload={payload} tz={tz} hasUnfinished={unfinished.length > 0} />}
      {current === "unfinished" && (
        <UnfinishedStep
          tasks={unfinished}
          moves={moves}
          counts={moveCounts}
          onMove={(id, action) => setMoves((m) => ({ ...m, [id]: action }))}
        />
      )}
      {current === "reflect" && <ReflectStep draft={reflection} onChange={setReflection} problem={problem} />}
      {current === "frog" && <FrogStep candidates={candidates} frogId={frogId} onPick={setFrogChoice} />}

      {error && (
        <p role="alert" className="mt-4 text-xs rounded-md px-3 py-2 break-words" style={errorStyle}>{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
        <div className="flex flex-wrap items-center gap-2">
          {index > 0 && (
            <button className="btn-ghost" onClick={() => setStepId(steps[index - 1])} disabled={saving}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
            </button>
          )}
          <button className="btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        </div>
        {last ? (
          <button
            className="btn-primary"
            disabled={problem !== null || saving}
            onClick={onSaveClick}
          >
            {saving ? "Saving…" : error ? "Try again" : "Save and close the day"}
          </button>
        ) : (
          <button
            className="btn-primary"
            disabled={nextBlocked}
            onClick={() => setStepId(steps[index + 1])}
          >
            Continue <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step: Done today ────────────────────────────────────────────────────────

function DoneStep({ payload, tz, hasUnfinished }: { payload: TodayPayload; tz: string; hasUnfinished: boolean }) {
  const outcome = frogOutcome(payload, tz);
  const frogId = payload.plan?.frogTaskId ?? null;
  const done = sortDone(payload.completedToday, frogId);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
        <h2 className="text-base font-semibold">Done today</h2>
        <span className="text-xs font-medium text-muted-foreground tabular">{done.length} {done.length === 1 ? "task" : "tasks"}</span>
      </div>
      <p className="text-sm mb-4" style={{ color: outcome === "eaten" ? FROG : "var(--muted-foreground)" }}>{doneTodayLine(done.length, outcome)}</p>

      {done.length > 0 && (
        <ul className="flex flex-col gap-2">
          {done.map((t) => {
            const isFrog = t.id === frogId;
            return (
              <li
                key={t.id}
                className={`rounded-lg border bg-surface px-3 py-3 flex items-start gap-3 ${isFrog ? "border-success" : "border-border"}`}
              >
                <span className="w-5 h-5 mt-0.5 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                  {isFrog ? <FrogIcon className="w-4 h-4 text-success" /> : <Check className="w-4 h-4" style={{ color: FROG }} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words">
                    {isFrog && <span className="sr-only">Today&apos;s frog: </span>}
                    {t.title}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <AbcdeBadge abcde={t.abcde} abcdeRank={t.abcdeRank} />
                    <ProjectChip name={t.group.name} color={t.group.color} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!hasUnfinished && (
        <p className="text-xs mt-4 text-subtle">
          Nothing is left unfinished, so there is nothing to move to tomorrow.
        </p>
      )}
    </section>
  );
}

// ── Step: Unfinished ────────────────────────────────────────────────────────

function UnfinishedStep({
  tasks,
  moves,
  counts,
  onMove,
}: {
  tasks: TodayTask[];
  moves: MoveChoices;
  counts: Record<MoveAction, number>;
  onMove: (id: string, action: MoveAction) => void;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-1">What happens to the unfinished?</h2>
      <p className="text-sm mb-4 text-muted-foreground">
        Tomorrow plans it for tomorrow. Backlog takes it off the day. Archive hides it from the board.
      </p>

      <ul className="flex flex-col gap-2">
        {tasks.map((t) => (
          <li key={t.id} className="rounded-lg p-3 flex flex-col gap-2.5" style={cardStyle}>
            <div className="min-w-0">
              <p className="text-sm font-medium break-words">{t.title}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <AbcdeBadge abcde={t.abcde} abcdeRank={t.abcdeRank} />
                <ProjectChip name={t.group.name} color={t.group.color} />
              </div>
            </div>
            <RadioGroup label={`What to do with ${t.title}`} values={MOVE_VALUES} value={moveFor(moves, t.id)} onChange={(a) => onMove(t.id, a)} className="grid grid-cols-3 gap-1.5">
              {(value, on, radio) => {
                const opt = MOVE_OPTIONS.find((o) => o.value === value)!;
                return (
                  <button
                    {...radio}
                    className="rounded-md h-9 px-2 text-xs font-semibold transition-colors hover:bg-border"
                    style={{
                      color: on ? (value === "archive" ? "var(--danger)" : "var(--foreground)") : "var(--muted-foreground)",
                      background: on ? (value === "archive" ? "var(--surface)" : "var(--primary-soft)") : "var(--raised)",
                      border: `1px solid ${on ? opt.color : "var(--border)"}`,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              }}
            </RadioGroup>
          </li>
        ))}
      </ul>

      <p className="text-xs mt-3 text-subtle tabular" aria-live="polite">
        {counts.tomorrow} to tomorrow, {counts.backlog} to backlog, {counts.archive} to archive
      </p>
    </section>
  );
}

// ── Step: Reflect ───────────────────────────────────────────────────────────

function ReflectStep({ draft, onChange, problem }: { draft: ReflectionDraft; onChange: (d: ReflectionDraft) => void; problem: string | null }) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">Reflect</h2>

      <div className="mb-5">
        <p className="text-sm font-medium mb-2">How did today go?</p>
        <RadioGroup
          label="How did today go?"
          values={RATINGS.map((r) => r.value)}
          value={draft.rating}
          onChange={(rating) => onChange({ ...draft, rating })}
          className="grid grid-cols-5 gap-1.5"
        >
          {(value, on, radio) => {
            const word = RATINGS[value - 1].word;
            return (
              <button
                {...radio}
                aria-label={`${value} of 5, ${word}`}
                className={`rounded-lg py-2 flex flex-col items-center gap-0.5 transition-colors min-w-0 border ${
                  on ? "bg-primary-soft border-primary text-foreground" : "bg-raised border-border text-muted-foreground hover:bg-border"
                }`}
              >
                <span className="text-base font-semibold leading-none tabular">{value}</span>
                <span className="text-[11px] leading-none truncate max-w-full px-0.5">{word}</span>
              </button>
            );
          }}
        </RadioGroup>
        {draft.rating !== null && (
          <button type="button" className="text-xs underline mt-2 text-subtle hover:text-foreground rounded-sm" onClick={() => onChange({ ...draft, rating: null })}>
            Clear rating
          </button>
        )}
      </div>

      <Reflection id="went-well" label="What went well?" value={draft.wentWell} onChange={(wentWell) => onChange({ ...draft, wentWell })} />
      <Reflection id="improve" label="What would you do differently tomorrow?" value={draft.improve} onChange={(improve) => onChange({ ...draft, improve })} />

      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
    </section>
  );
}

function Reflection({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium mb-2">{label}</label>
      <textarea
        id={id}
        value={value}
        maxLength={MAX_REVIEW_TEXT}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className="forma-input resize-y"
        style={{ minHeight: "5rem" }}
      />
      <p className="text-xs mt-1 text-right text-subtle tabular">{value.length} / {MAX_REVIEW_TEXT}</p>
    </div>
  );
}

// ── Step: Tomorrow's frog ───────────────────────────────────────────────────

const SKIP = "__skip__";

function FrogStep({
  candidates,
  frogId,
  onPick,
}: {
  candidates: TodayTask[];
  frogId: string | null;
  onPick: (id: string | null) => void;
}) {
  const values = [...candidates.map((c) => c.id), SKIP];

  return (
    <section>
      <h2 className="text-base font-semibold mb-1 flex items-center gap-2"><FrogIcon /> Tomorrow&apos;s frog</h2>
      <p className="text-sm mb-4 text-muted-foreground">
        Choose tonight what you will eat first tomorrow. It will be waiting, preselected, when you plan your day.
      </p>

      <RadioGroup
        label="Tomorrow's frog"
        values={values}
        value={frogId ?? SKIP}
        onChange={(v) => onPick(v === SKIP ? null : v)}
        className="flex flex-col gap-2"
      >
        {(value, on, radio) => {
          if (value === SKIP) {
            return (
              <button
                {...radio}
                className={`w-full text-left rounded-lg p-3 flex items-center gap-3 transition-colors border ${on ? "bg-raised border-input" : "bg-surface border-border hover:bg-raised"}`}
              >
                <Dot on={on} />
                <span className="text-sm font-medium">Skip: I&apos;ll choose tomorrow</span>
              </button>
            );
          }
          const t = candidates.find((c) => c.id === value)!;
          return (
            <button
              {...radio}
              className={`w-full text-left rounded-lg p-3 flex items-start gap-3 transition-colors border ${on ? "bg-primary-soft border-primary" : "bg-surface border-border hover:bg-raised"}`}
            >
              <Dot on={on} frog />
              <span className="min-w-0 flex-1 flex flex-col gap-1.5">
                <span className="text-sm font-medium break-words">{t.title}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <AbcdeBadge abcde={t.abcde} abcdeRank={t.abcdeRank} />
                  <ProjectChip name={t.group.name} color={t.group.color} />
                </span>
              </span>
            </button>
          );
        }}
      </RadioGroup>
    </section>
  );
}

function Dot({ on, frog = false }: { on: boolean; frog?: boolean }) {
  return (
    <span className="w-6 h-6 flex items-center justify-center flex-shrink-0" aria-hidden="true">
      {on && frog ? <FrogIcon className="w-5 h-5" /> : <span className="w-4 h-4 rounded-full flex items-center justify-center border border-input">{on && <span className="w-2 h-2 rounded-full bg-muted-foreground" />}</span>}
    </span>
  );
}
