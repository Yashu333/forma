"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp } from "lucide-react";
import type { Abcde, TodayCandidate, TodayPayload } from "@/types";
import { ABCDE_LETTERS, ABCDE_META } from "@/lib/frog/abcde";
import {
  buildPlanItems,
  buildPutBody,
  countProblem,
  groupByProject,
  initialLabels,
  initialSelection,
  moveRank,
  planProblem,
  planSizeHint,
  rankPosition,
  resolveFrog,
  sortedSelected,
  suggestFrog,
  toggleLetter,
  toggleSelected,
  type PlanItem,
  type PlanLabels,
} from "@/lib/frog/plan";
import { formatDateKeyLong } from "@/lib/frog/dayview";
import { savePlan } from "./api";
import { ACCENT, AbcdeBadge, FROG, ProjectChip, Tag } from "./bits";

interface Props {
  payload: TodayPayload;
  candidates: TodayCandidate[];
  tz: string;
  /** True when reached through "Edit plan" from the Today view (adds a Cancel button). */
  editing: boolean;
  onSaved: (payload: TodayPayload) => void;
  onCancel: () => void;
}

const STEPS = ["Pick", "Label", "Frog"] as const;

const cardStyle = { background: "var(--card)", border: "1px solid var(--border-strong)" } as const;

export default function PlanStepper({ payload, candidates, tz, editing, onSaved, onCancel }: Props) {
  // The editor's whole state is three small values; everything else is derived.
  // Items are built once: planned tasks (done ones too) first-class, merged with
  // the candidates, so a save can never silently un-plan a done task.
  const items = useMemo(() => buildPlanItems(payload.tasks, candidates), [payload.tasks, candidates]);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>(() => initialSelection(payload.tasks));
  const [labels, setLabels] = useState<PlanLabels>(() => initialLabels(items));
  const [pickedFrog, setPickedFrog] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = sortedSelected(items, selected, labels);
  const frogId = resolveFrog(sorted, pickedFrog, payload.plan?.frogTaskId ?? null);
  const problem = planProblem(selected.length, frogId);
  // Moving on from Pick only needs a sane count; the frog is checked on Save.
  const pickProblem = countProblem(selected.length);

  async function save() {
    if (problem || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = buildPutBody({ date: payload.date, tz, items, selected, labels, frogTaskId: frogId, finalize: true });
      onSaved(await savePlan(body));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the plan");
      setSaving(false);
    }
  }

  return (
    <div className="p-5 md:p-7 max-w-3xl mx-auto" style={{ color: "var(--text-primary)" }}>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">{editing ? "Edit your plan" : "Plan my day"}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{formatDateKeyLong(payload.date)}</p>
      </div>

      <ol className="flex items-center gap-2 mb-5" aria-label="Steps">
        {STEPS.map((label, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <li key={label} className="flex items-center gap-2 min-w-0" aria-current={active ? "step" : undefined}>
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                style={
                  active || done
                    ? { background: ACCENT, color: "#fff" }
                    : { background: "var(--elevated)", color: "var(--text-muted)", border: "1px solid var(--border-strong)" }
                }
              >
                {done ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <span className="text-xs font-medium" style={{ color: active ? "var(--text-primary)" : "var(--text-muted)" }}>{label}</span>
              {i < STEPS.length - 1 && <span className="w-4 sm:w-8 h-px" style={{ background: "var(--border-strong)" }} />}
            </li>
          );
        })}
      </ol>

      {step === 0 && (
        <PickStep items={items} selected={selected} onToggle={(id) => setSelected((s) => toggleSelected(s, id))} />
      )}
      {step === 1 && (
        <LabelStep
          items={items}
          selected={selected}
          labels={labels}
          sorted={sorted}
          onLetter={(id, letter) => setLabels((l) => toggleLetter(l, id, letter))}
          onMove={(id, dir) => setLabels((l) => moveRank(items, selected, l, id, dir))}
        />
      )}
      {step === 2 && (
        <FrogStep sorted={sorted} frogId={frogId} suggestedId={suggestFrog(sorted)} onPick={setPickedFrog} />
      )}

      {error && (
        <p role="alert" className="mt-4 text-xs rounded-lg px-3 py-2" style={{ color: "#F87171", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.30)" }}>
          {error}
        </p>
      )}
      {step === 0 && pickProblem && (
        // Nothing picked yet is a nudge, not an error; too many is an error.
        <p className="mt-4 text-xs" style={{ color: selected.length === 0 ? "var(--text-secondary)" : "#F87171" }}>{pickProblem}</p>
      )}
      {step === 2 && problem && (
        <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>{problem}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
        <div className="flex flex-wrap items-center gap-2">
          {step > 0 && (
            <button className="btn-ghost" onClick={() => setStep(step - 1)} disabled={saving}>
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
          {editing && (
            <button className="btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          )}
        </div>
        {step < 2 ? (
          <button
            className="btn-primary"
            style={pickProblem && step === 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            disabled={step === 0 && pickProblem !== null}
            onClick={() => setStep(step + 1)}
          >
            {step === 0 ? "Label them" : "Choose your frog"} <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            className="btn-primary"
            style={problem || saving ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
            disabled={problem !== null || saving}
            onClick={save}
          >
            {saving ? "Saving…" : editing ? "Save plan" : "Save my plan"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 1: Pick ────────────────────────────────────────────────────────────

function PickStep({ items, selected, onToggle }: { items: PlanItem[]; selected: string[]; onToggle: (id: string) => void }) {
  const groups = useMemo(() => groupByProject(items), [items]);
  const hint = planSizeHint(selected.length);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <h2 className="text-base font-semibold">What will you work on today?</h2>
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }} aria-live="polite">
          {selected.length} {selected.length === 1 ? "task" : "tasks"} picked
        </span>
      </div>
      {hint && (
        <p className="text-xs rounded-lg px-3 py-2 mb-3" style={{ color: "#FBBF24", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.28)" }}>
          {hint}
        </p>
      )}

      {groups.length === 0 ? (
        <div className="rounded-2xl p-6 text-center" style={cardStyle}>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>You have no open tasks to plan.</p>
          <Link href="/dashboard" className="text-xs mt-2 inline-block underline" style={{ color: "var(--text-muted)" }}>
            Add some on a project board
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(({ group, items: groupItems }) => (
            <div key={group.id} className="rounded-2xl p-3 sm:p-4" style={{ ...cardStyle, borderLeft: `3px solid ${group.color}` }}>
              <div className="flex items-center gap-2 mb-2 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: group.color }} />
                <h3 className="text-sm font-semibold truncate">{group.name}</h3>
                <span className="text-[11px] flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  {groupItems.filter((i) => selected.includes(i.id)).length}/{groupItems.length}
                </span>
              </div>
              <ul className="flex flex-col">
                {groupItems.map((item) => {
                  const checked = selected.includes(item.id);
                  return (
                    <li key={item.id}>
                      <label
                        className="flex items-start gap-3 rounded-lg px-2 py-2 cursor-pointer transition-colors"
                        style={{ background: checked ? "var(--accent-subtle)" : undefined }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggle(item.id)}
                          className="mt-0.5 w-4 h-4 flex-shrink-0"
                          style={{ accentColor: ACCENT }}
                        />
                        <span className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className="text-sm break-words min-w-0"
                            style={{ color: item.done ? "var(--text-muted)" : "var(--text-primary)", textDecoration: item.done ? "line-through" : undefined }}
                          >
                            {item.title}
                          </span>
                          <AbcdeBadge abcde={item.abcde} abcdeRank={item.abcdeRank} />
                          {item.done && <Tag color={FROG}>Done</Tag>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Step 2: Label ───────────────────────────────────────────────────────────

function LabelStep({
  items,
  selected,
  labels,
  sorted,
  onLetter,
  onMove,
}: {
  items: PlanItem[];
  selected: string[];
  labels: PlanLabels;
  sorted: PlanItem[];
  onLetter: (id: string, letter: Abcde) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-1">Label by consequence</h2>
      <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        Never do a B while an A is open. Tap a letter again to clear it; use the arrows to rank tasks within a letter.
      </p>

      <ul className="rounded-2xl p-3 mb-4 flex flex-col gap-2" style={cardStyle} aria-label="What the letters mean">
        {ABCDE_LETTERS.map((letter) => (
          <li key={letter} className="flex items-start gap-2.5">
            <AbcdeBadge abcde={letter} />
            <span className="text-xs min-w-0" style={{ color: "var(--text-secondary)" }}>
              <strong style={{ color: ABCDE_META[letter].color }}>{ABCDE_META[letter].label}</strong> — {ABCDE_META[letter].description}
            </span>
          </li>
        ))}
      </ul>

      <ul className="flex flex-col gap-2">
        {sorted.map((item) => {
          const pos = rankPosition(items, selected, labels, item.id);
          return (
            <li key={item.id} className="rounded-2xl p-3" style={cardStyle}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2.5">
                <span
                  className="text-sm font-medium break-words min-w-0"
                  style={{ textDecoration: item.done ? "line-through" : undefined, color: item.done ? "var(--text-muted)" : undefined }}
                >
                  {item.title}
                </span>
                {item.done && <Tag color={FROG}>Done</Tag>}
                <ProjectChip name={item.group.name} color={item.group.color} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {ABCDE_LETTERS.map((letter) => {
                  const on = item.abcde === letter;
                  const color = ABCDE_META[letter].color;
                  return (
                    <button
                      key={letter}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${letter}: ${ABCDE_META[letter].label}`}
                      title={`${ABCDE_META[letter].label} — ${ABCDE_META[letter].description}`}
                      onClick={() => onLetter(item.id, letter)}
                      className="w-9 h-9 rounded-lg text-sm font-bold transition-colors"
                      style={
                        on
                          ? { color: "#fff", background: color, border: `1px solid ${color}` }
                          : { color, background: "transparent", border: `1px solid ${color}55` }
                      }
                    >
                      {letter}
                    </button>
                  );
                })}
                {pos && (
                  <div className="flex items-center gap-1 ml-1">
                    <AbcdeBadge abcde={item.abcde} abcdeRank={item.abcdeRank} />
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label="Rank higher"
                      title="Rank higher"
                      disabled={pos.index === 0}
                      style={pos.index === 0 ? { opacity: 0.3, cursor: "not-allowed" } : undefined}
                      onClick={() => onMove(item.id, -1)}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label="Rank lower"
                      title="Rank lower"
                      disabled={pos.index === pos.count - 1}
                      style={pos.index === pos.count - 1 ? { opacity: 0.3, cursor: "not-allowed" } : undefined}
                      onClick={() => onMove(item.id, 1)}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Step 3: Choose your frog ────────────────────────────────────────────────

function FrogStep({ sorted, frogId, suggestedId, onPick }: { sorted: PlanItem[]; frogId: string | null; suggestedId: string | null; onPick: (id: string) => void }) {
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  // Roving tabindex: one tab stop (the chosen frog, or the first when none is),
  // arrow keys move the choice and focus together, wrapping at the ends.
  const stop = Math.max(0, sorted.findIndex((i) => i.id === frogId));

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 || sorted.length === 0) return;
    e.preventDefault();
    const next = (index + step + sorted.length) % sorted.length;
    onPick(sorted[next].id);
    radios.current[next]?.focus();
  }

  return (
    <section>
      <h2 className="text-base font-semibold mb-1">Choose your frog 🐸</h2>
      <p className="text-sm italic mb-4" style={{ color: "var(--text-secondary)" }}>
        &ldquo;If you have to eat a frog, eat it first thing in the morning.&rdquo;
      </p>

      <div role="radiogroup" aria-label="Today's frog" className="flex flex-col gap-2">
        {sorted.map((item, index) => {
          const on = item.id === frogId;
          return (
            <button
              key={item.id}
              ref={(el) => {
                radios.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={index === stop ? 0 : -1}
              onKeyDown={(e) => onKeyDown(e, index)}
              onClick={() => onPick(item.id)}
              className="w-full text-left rounded-2xl p-3 flex items-start gap-3 transition-colors"
              style={{
                background: on ? "rgba(52,211,153,0.10)" : "var(--card)",
                border: `1px solid ${on ? "rgba(52,211,153,0.55)" : "var(--border-strong)"}`,
              }}
            >
              <span className="w-6 h-6 flex items-center justify-center text-xl leading-none flex-shrink-0" aria-hidden="true">
                {on ? "🐸" : <span className="w-4 h-4 rounded-full" style={{ border: "1.5px solid var(--border-strong)" }} />}
              </span>
              <span className="min-w-0 flex-1 flex flex-col gap-1.5">
                <span className="text-sm font-medium break-words">{item.title}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <AbcdeBadge abcde={item.abcde} abcdeRank={item.abcdeRank} />
                  <ProjectChip name={item.group.name} color={item.group.color} />
                  {item.id === suggestedId && <Tag color="#A79BFF">Suggested</Tag>}
                  {item.done && <Tag color={FROG}>Done</Tag>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
