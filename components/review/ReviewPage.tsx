"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertCircle, ChevronLeft, ChevronRight, Check, RefreshCw } from "lucide-react";
import RadioGroup from "@/components/today/RadioGroup";
import { FrogIcon, ProjectChip } from "@/components/today/bits";
import { useLocalClock } from "@/lib/frog/clock";
import { addDays } from "@/lib/frog/dates";
import { formatDuration } from "@/lib/focus/stats";
import { defaultReviewWeek, weekStartOf } from "@/lib/review/week";
import { fetchReview, saveReview, type MoveAction, type ReviewData } from "./api";

const RATINGS = [
  { value: 1, word: "Rough" },
  { value: 2, word: "Meh" },
  { value: 3, word: "Okay" },
  { value: 4, word: "Good" },
  { value: 5, word: "Great" },
] as const;

const MOVE_LABEL: Record<MoveAction, string> = { keep: "Keep", nextWeek: "Next week", backlog: "Backlog", archive: "Archive" };
const MOVE_VALUES: readonly MoveAction[] = ["keep", "nextWeek", "backlog", "archive"];
const COLLAPSED_DONE = 10;
const MISSED = "color-mix(in srgb, var(--danger) 45%, transparent)";

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

type View = { key: string; data: ReviewData } | { key: string; error: string };

export default function ReviewPage() {
  const clock = useLocalClock();
  if (!clock) return <div className="p-5 md:p-7 text-sm text-subtle" aria-busy="true">Loading review…</div>;
  return <ReviewInner today={clock.date} tz={clock.tz} />;
}

function ReviewInner({ today, tz }: { today: string; tz: string }) {
  const [weekStart, setWeekStart] = useState(() => defaultReviewWeek(today));
  const [nonce, setNonce] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const key = `${weekStart}|${nonce}`;
  const currentWeek = weekStartOf(today);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchReview(weekStart, today, tz, ctrl.signal)
      .then((data) => setView({ key, data }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setView({ key, error: e instanceof Error ? e.message : "Something went wrong" });
      });
    return () => ctrl.abort();
  }, [weekStart, today, tz, key]);

  const current = view && view.key === key ? view : null;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-5 md:p-7 max-w-3xl mx-auto text-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-[28px] sm:text-4xl font-semibold tracking-[-0.025em] leading-[1.1]">Weekly review</h1>
            <p className="text-sm mt-2 text-muted-foreground" aria-live="polite">
              Week of {format(keyToDate(weekStart), "d MMM")}
              {weekStart === currentWeek ? " (this week)" : ""}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-icon" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button type="button" className="btn-icon" aria-label="Next week" disabled={weekStart >= currentWeek} onClick={() => setWeekStart(addDays(weekStart, 7))}>
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {!current && <p className="mt-8 text-sm text-subtle" aria-busy="true">Loading…</p>}
        {current && "error" in current && (
          <div className="mt-6 rounded-lg border border-border bg-surface p-5 text-center" role="alert">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-danger" aria-hidden="true" />
            <p className="text-sm font-semibold">Something went wrong</p>
            <p className="text-xs mt-1 break-words text-muted-foreground">{current.error}</p>
            <button className="btn-secondary mt-4" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
            </button>
          </div>
        )}
        {current && "data" in current && (
          <ReviewForm key={current.key} data={current.data} today={today} tz={tz} onSaved={() => setNonce((n) => n + 1)} />
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 min-w-0">
      <div className="text-xs text-subtle">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular text-foreground">{value}</div>
      {sub && <div className="text-xs text-subtle mt-0.5">{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold mb-3">{children}</h2>;
}

function ReviewForm({ data, today, tz, onSaved }: { data: ReviewData; today: string; tz: string; onSaved: () => void }) {
  const saved = data.review?.reviewedAt != null;
  const [editing, setEditing] = useState(false);
  const [moves, setMoves] = useState<Record<string, MoveAction>>({});
  const [rating, setRating] = useState<number | null>(data.review?.rating ?? null);
  const [win, setWin] = useState(data.review?.win ?? "");
  const [obstacle, setObstacle] = useState(data.review?.obstacle ?? "");
  const [focus, setFocus] = useState(data.review?.focus ?? "");
  const [frogs, setFrogs] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.nextWeek.dates.map((d) => [d, data.nextWeek.frogs[d]?.id ?? ""])),
  );
  const [showAllDone, setShowAllDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { stats } = data;
  const doneByProject = useMemo(() => {
    const shown = showAllDone ? data.done : data.done.slice(0, COLLAPSED_DONE);
    const map = new Map<string, { name: string; color: string; tasks: string[] }>();
    for (const t of shown) {
      const g = map.get(t.group.id) ?? { name: t.group.name, color: t.group.color, tasks: [] };
      g.tasks.push(t.title);
      map.set(t.group.id, g);
    }
    return [...map.values()];
  }, [data.done, showAllDone]);

  // Open tasks to pick a frog from: the candidates, plus any frog already set
  // for next week (so it is never missing from its own list).
  const options = useMemo(() => {
    const known = new Set(data.candidates.map((c) => c.id));
    const extra = data.nextWeek.dates.flatMap((d) => {
      const f = data.nextWeek.frogs[d];
      return f && !known.has(f.id) ? [{ id: f.id, title: f.title, group: { id: "", name: "Other", color: "" } }] : [];
    });
    return [...data.candidates, ...extra];
  }, [data]);

  const frogCount = data.nextWeek.dates.filter((d) => data.nextWeek.frogs[d]).length;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveReview({
        weekStart: data.weekStart,
        tz,
        today,
        moves: Object.entries(moves).filter(([, a]) => a !== "keep").map(([taskId, action]) => ({ taskId, action })),
        win,
        obstacle,
        focus,
        rating,
        frogs: data.nextWeek.dates.map((date) => ({ date, taskId: frogs[date] || null })),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the review");
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      {/* 1. The week in numbers */}
      <section aria-label="The week in numbers">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile label="Tasks done" value={String(stats.tasksDone)} />
          <Tile label="Frogs eaten" value={`${stats.frogs.eaten} of ${stats.frogs.planned}`} sub="planned days" />
          <Tile label="Focus time" value={formatDuration(stats.focusSec)} sub={stats.focusSessions ? `${stats.focusSessions} sessions` : undefined} />
          <Tile label="Habits" value={stats.habits ? `${Math.round((stats.habits.done / stats.habits.scheduled) * 100)}%` : "None"} sub={stats.habits ? `${stats.habits.done} of ${stats.habits.scheduled} ticks` : undefined} />
          <Tile label="Average day" value={stats.avgRating !== null ? `${stats.avgRating.toFixed(1)} of 5` : "None"} sub={stats.ratedDays ? `${stats.ratedDays} rated ${stats.ratedDays === 1 ? "day" : "days"}` : undefined} />
        </div>

        <div className="mt-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center gap-2 mb-3">
            <FrogIcon />
            <h2 className="text-sm font-semibold">Frog by day</h2>
          </div>
          <ul className="grid grid-cols-7 gap-1.5">
            {stats.frogs.days.map((d) => (
              <li key={d.date} className="min-w-0 text-center" title={d.title ? `${d.title}${d.eaten ? ": eaten" : ": not eaten"}` : "No frog"}>
                <div
                  className="h-7 rounded-md border border-border flex items-center justify-center"
                  style={{ background: d.eaten ? "var(--success)" : d.planned ? MISSED : "var(--raised)" }}
                >
                  {d.eaten && <Check className="w-4 h-4 text-primary-foreground" aria-hidden="true" />}
                  <span className="sr-only">{d.eaten ? "Eaten" : d.planned ? "Not eaten" : "No frog"}</span>
                </div>
                <div className="text-[11px] text-subtle mt-1">{format(keyToDate(d.date), "EEE")}</div>
              </li>
            ))}
          </ul>
        </div>

        {data.done.length > 0 && (
          <div className="mt-3 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold mb-3">Done this week</h2>
            <div className="flex flex-col gap-3">
              {doneByProject.map((g) => (
                <div key={g.name}>
                  <ProjectChip name={g.name} color={g.color} />
                  <ul className="mt-1.5 flex flex-col gap-1 text-sm text-muted-foreground list-disc pl-5">
                    {g.tasks.map((t, i) => <li key={i} className="break-words">{t}</li>)}
                  </ul>
                </div>
              ))}
            </div>
            {data.done.length > COLLAPSED_DONE && (
              <button type="button" className="btn-ghost mt-3" onClick={() => setShowAllDone((v) => !v)}>
                {showAllDone ? "Show fewer" : `Show all ${data.done.length}`}
              </button>
            )}
          </div>
        )}
      </section>

      {/* 2. What you wrote each day */}
      {data.dailyNotes.length > 0 && (
        <section aria-label="Daily notes">
          <SectionTitle>What you wrote each day</SectionTitle>
          <ul className="flex flex-col gap-2">
            {data.dailyNotes.map((n) => (
              <li key={n.date} className="rounded-lg border border-border bg-surface p-3 text-sm">
                <div className="text-xs text-subtle mb-1">{format(keyToDate(n.date), "EEEE d MMM")}{n.rating ? ` · ${n.rating} of 5` : ""}</div>
                {n.wentWell && <p className="break-words"><span className="text-subtle">Went well: </span>{n.wentWell}</p>}
                {n.improve && <p className="break-words mt-1"><span className="text-subtle">Do differently: </span>{n.improve}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {saved && !editing ? (
        <section className="rounded-lg border border-border bg-surface p-5" aria-label="Review saved">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 text-success" aria-hidden="true" />
            Review saved · {frogCount} {frogCount === 1 ? "frog" : "frogs"} set for next week
          </p>
          {data.review?.rating && <p className="text-sm text-muted-foreground mt-2">The week: {data.review.rating} of 5, {RATINGS[data.review.rating - 1].word.toLowerCase()}.</p>}
          {data.review?.focus && <p className="text-sm mt-1">Focus for next week: <span className="font-medium">{data.review.focus}</span></p>}
          <button type="button" className="btn-secondary mt-4" onClick={() => setEditing(true)}>Edit review</button>
        </section>
      ) : (
        <>
          {/* 3. Slipped */}
          <section aria-label="Slipped tasks">
            <SectionTitle>Slipped</SectionTitle>
            {data.slipped.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing slipped. Every task due or planned this week is done.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-3">Due or planned this week and still open. Choose what happens to each.</p>
                <ul className="flex flex-col gap-2">
                  {data.slipped.map((t) => (
                    <li key={t.id} className="rounded-lg border border-border bg-surface p-3" style={{ borderLeft: `3px solid ${t.group.color}` }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium break-words min-w-0 flex-1">{t.title}</span>
                        <ProjectChip name={t.group.name} color={t.group.color} />
                      </div>
                      <RadioGroup
                        label={`What to do with ${t.title}`}
                        values={MOVE_VALUES}
                        value={moves[t.id] ?? "keep"}
                        onChange={(a) => setMoves((m) => ({ ...m, [t.id]: a }))}
                        className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5"
                      >
                        {(value, on, radio) => (
                          <button
                            {...radio}
                            className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                              on ? "bg-primary-soft border-primary text-foreground" : "bg-raised border-border text-muted-foreground hover:border-border-strong"
                            }`}
                          >
                            {MOVE_LABEL[value]}
                          </button>
                        )}
                      </RadioGroup>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* 4. Reflect */}
          <section aria-label="Reflect">
            <SectionTitle>Reflect</SectionTitle>
            <p className="text-sm font-medium mb-2">How did the week go?</p>
            <RadioGroup label="How did the week go?" values={RATINGS.map((r) => r.value)} value={rating} onChange={setRating} className="grid grid-cols-5 gap-1.5">
              {(value, on, radio) => (
                <button
                  {...radio}
                  aria-label={`${value} of 5, ${RATINGS[value - 1].word}`}
                  className={`rounded-lg py-2 flex flex-col items-center gap-0.5 transition-colors min-w-0 border ${
                    on ? "bg-primary-soft border-primary text-foreground" : "bg-raised border-border text-muted-foreground hover:bg-border hover:border-border-strong"
                  }`}
                >
                  <span className="text-base font-semibold leading-none tabular">{value}</span>
                  <span className="text-[11px] leading-none truncate max-w-full px-0.5">{RATINGS[value - 1].word}</span>
                </button>
              )}
            </RadioGroup>
            {rating !== null && (
              <button type="button" className="text-xs underline mt-2 text-subtle hover:text-foreground rounded-sm" onClick={() => setRating(null)}>
                Clear rating
              </button>
            )}
            <div className="mt-5 flex flex-col gap-4">
              {([
                ["review-win", "Biggest win", win, setWin],
                ["review-obstacle", "What got in the way", obstacle, setObstacle],
                ["review-focus", "One focus for next week", focus, setFocus],
              ] as const).map(([id, label, value, set]) => (
                <div key={id}>
                  <label htmlFor={id} className="text-sm font-medium block mb-1.5">{label}</label>
                  <textarea
                    id={id}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    maxLength={2000}
                    rows={2}
                    className="forma-input resize-y"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* 5. Next week's frogs */}
          <section aria-label="Next week's frogs">
            <SectionTitle>Next week&apos;s frogs</SectionTitle>
            <p className="text-sm text-muted-foreground mb-3">The one task to do first each day. Leave a day empty to pick it that morning.</p>
            <ul className="flex flex-col gap-2">
              {data.nextWeek.dates.map((d) => {
                const taken = new Set(Object.entries(frogs).filter(([k, v]) => k !== d && v).map(([, v]) => v));
                const groups = new Map<string, { name: string; items: typeof options }>();
                for (const o of options) {
                  if (taken.has(o.id)) continue;
                  const g = groups.get(o.group.id) ?? { name: o.group.name, items: [] };
                  g.items.push(o);
                  groups.set(o.group.id, g);
                }
                const already = data.nextWeek.frogs[d]?.planned;
                return (
                  <li key={d} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <label htmlFor={`frog-${d}`} className="w-20 text-sm text-muted-foreground flex-shrink-0">{format(keyToDate(d), "EEE d MMM")}</label>
                    <select
                      id={`frog-${d}`}
                      value={frogs[d] ?? ""}
                      onChange={(e) => setFrogs((f) => ({ ...f, [d]: e.target.value }))}
                      className="forma-input flex-1 min-w-[12rem] !py-1.5 !text-sm"
                    >
                      <option value="">No frog</option>
                      {[...groups.entries()].map(([gid, g]) => (
                        <optgroup key={gid} label={g.name}>
                          {g.items.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {already && <span className="text-xs text-subtle">Day already planned</span>}
                  </li>
                );
              })}
            </ul>
          </section>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2 pb-8">
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save review"}
            </button>
            {saved && <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>}
          </div>
        </>
      )}
    </div>
  );
}
