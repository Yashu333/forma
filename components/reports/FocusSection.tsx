"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { RefreshCw, Timer } from "lucide-react";
import { useLocalClock } from "@/lib/frog/clock";
import { formatDuration } from "@/lib/focus/stats";

// The "Focus time" section of the Reports page: where Pomodoro time went.
// Cross-project like the frog section, so the page's project filter doesn't
// apply. The range follows the page's selector (All time shows 90 days).

interface FocusReport {
  totalSec: number;
  sessions: number;
  daily: { date: string; sec: number }[];
  byProject: { id: string; name: string; color: string; sec: number }[];
  topTasks: { id: string; title: string; group: { id: string; name: string; color: string }; sec: number; sessions: number }[];
  untrackedSec: number;
}

type View = { key: string; report: FocusReport } | { key: string; error: string };

async function fetchFocusReport(days: number, date: string, tz: string): Promise<FocusReport> {
  const qs = new URLSearchParams({ days: String(days), today: date, tz });
  const res = await fetch(`/api/reports/focus?${qs.toString()}`);
  if (!res.ok) {
    let message = "Couldn't load focus time";
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // not JSON: keep the fallback
    }
    throw new Error(message);
  }
  return res.json();
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs text-subtle">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular text-foreground">{value}</div>
    </div>
  );
}

export default function FocusSection({ days }: { days: number | "all" }) {
  const clock = useLocalClock();
  const [nonce, setNonce] = useState(0); // bumped by Retry
  const [view, setView] = useState<View | null>(null);

  const range = days === "all" ? 90 : days;
  const date = clock?.date ?? null;
  const tz = clock?.tz ?? null;
  const key = clock ? `${clock.key}|${range}|${nonce}` : null;

  useEffect(() => {
    if (!key || !date || !tz) return;
    let cancelled = false;
    (async () => {
      try {
        const report = await fetchFocusReport(range, date, tz);
        if (!cancelled) setView({ key, report });
      } catch (e) {
        if (!cancelled) setView({ key, error: e instanceof Error ? e.message : "Something went wrong" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, range, date, tz]);

  const current = view && view.key === key ? view : null;
  const shown = view && "report" in view ? view.report : null;
  const loading = !current;
  const maxDay = Math.max(1, ...(shown?.daily.map((d) => d.sec) ?? [1]));
  const maxProject = Math.max(1, ...(shown?.byProject.map((p) => p.sec) ?? [1]));

  return (
    <section className="mt-8" aria-labelledby="focus-report-title">
      <div className="mb-3">
        <h2 id="focus-report-title" className="text-base font-semibold flex items-center gap-2 text-foreground">
          <Timer className="w-4 h-4 text-subtle" aria-hidden="true" /> Focus time
        </h2>
        <p className="text-xs mt-0.5 text-subtle">
          From the Pomodoro timer, over the last {range} days{days === "all" ? " (the longest range)" : ""}. Covers all projects.
        </p>
      </div>

      {current && "error" in current && (
        <div className="rounded-lg border border-border bg-surface p-4 flex items-center gap-3" role="alert">
          <p className="text-sm text-danger flex-1">{current.error}</p>
          <button className="btn-secondary" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {!shown && !current && <p className="text-sm text-subtle">Loading…</p>}

      {shown && (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
          {shown.sessions === 0 ? (
            <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted-foreground">
              No focus time logged yet. Pick a task on the{" "}
              <Link href="/pomodoro" target="_blank" className="underline text-foreground">Pomodoro timer</Link>{" "}
              and every focus session is counted here.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Tile label="Total focus" value={formatDuration(shown.totalSec)} />
                <Tile label="Sessions" value={String(shown.sessions)} />
                <Tile label="Average per day" value={formatDuration(shown.totalSec / range)} />
              </div>

              <div className="mt-3 rounded-lg border border-border bg-surface p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3">Per day</h3>
                <div
                  className="flex items-end gap-px h-32"
                  role="img"
                  aria-label={`Focus time per day, ${formatDuration(shown.totalSec)} in total over ${range} days`}
                >
                  {shown.daily.map((d) => (
                    <div
                      key={d.date}
                      className="flex-1 min-w-0 h-full flex items-end"
                      title={`${format(parseISO(d.date), "EEE, MMM d")}: ${formatDuration(d.sec)}`}
                    >
                      <div className="w-full rounded-t-sm bg-primary" style={{ height: d.sec ? `${Math.max(4, (d.sec / maxDay) * 100)}%` : 0 }} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-subtle tabular">
                  <span>{format(parseISO(shown.daily[0].date), "MMM d")}</span>
                  <span>{format(parseISO(shown.daily[shown.daily.length - 1].date), "MMM d")}</span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-surface p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-3">By project</h3>
                  {shown.byProject.length === 0 ? (
                    <p className="text-sm text-subtle">No time on a task yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {shown.byProject.map((p) => (
                        <li key={p.id} className="flex items-center gap-3">
                          <span className="w-24 sm:w-32 flex-shrink-0 flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} aria-hidden="true" />
                            <span className="text-sm text-muted-foreground truncate">{p.name}</span>
                          </span>
                          <span className="flex-1 min-w-0 h-4 relative">
                            <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(p.sec / maxProject) * 100}%`, minWidth: 4, background: p.color }} />
                          </span>
                          <span className="text-xs tabular text-muted-foreground w-14 text-right">{formatDuration(p.sec)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {shown.untrackedSec > 0 && (
                    <p className="text-xs text-subtle mt-3">Not linked to a task: {formatDuration(shown.untrackedSec)}</p>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-surface p-4">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Top tasks</h3>
                  {shown.topTasks.length === 0 ? (
                    <p className="text-sm text-subtle">No time on a task yet.</p>
                  ) : (
                    <ol className="flex flex-col gap-2">
                      {shown.topTasks.map((t) => (
                        <li key={t.id} className="flex items-center gap-3 rounded-md border border-border bg-raised/70 px-3 py-2" style={{ borderLeft: `3px solid ${t.group.color}` }}>
                          <Link href={`/group/${t.group.id}?task=${t.id}`} className="text-sm text-foreground truncate flex-1 hover:underline max-lg:py-3 max-lg:-my-3">
                            {t.title}
                          </Link>
                          <span className="text-xs text-subtle tabular flex-shrink-0">{t.sessions} {t.sessions === 1 ? "session" : "sessions"}</span>
                          <span className="text-xs tabular text-muted-foreground w-14 text-right flex-shrink-0">{formatDuration(t.sec)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
