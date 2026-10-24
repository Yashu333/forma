"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Flame, RefreshCw, Trophy, Sunrise } from "lucide-react";
import { ABCDE_LETTERS, ABCDE_META } from "@/lib/frog/abcde";
import { useLocalClock } from "@/lib/frog/clock";
import { MAX_STRIP_DAYS, type AbcdeCounts, type FrogReflection, type FrogReport } from "@/lib/frog/reports";
import { FROG, FrogIcon } from "@/components/today/bits";

// The "Frog" section of the Reports page. Frog stats are cross-project, so the
// page's project filter doesn't apply here; the section says so. The range
// follows the page's range selector. The section is independent of the task
// report: the dashboard renders it even when that report is empty or failed.

const COLLAPSED_REFLECTIONS = 5;
const NONE_COLOR = "#B8AFA7";
const MISSED = "color-mix(in srgb, var(--danger) 45%, transparent)"; // planned but not eaten: muted red
const EMPTY_CELL = "var(--raised)";

type View = { key: string; report: FrogReport } | { key: string; error: string };

async function fetchFrogReport(days: number | "all", date: string, tz: string): Promise<FrogReport> {
  const qs = new URLSearchParams({ tz, today: date, days: String(days) });
  const res = await fetch(`/api/reports/frog?${qs.toString()}`);
  if (!res.ok) {
    let message = "Couldn't load frog stats";
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

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const longDate = (date: string) => format(parseISO(date), "EEE, MMM d");

export default function FrogSection({ days, projectFilterActive }: { days: number | "all"; projectFilterActive: boolean }) {
  const clock = useLocalClock();
  const [nonce, setNonce] = useState(0); // bumped by Retry
  const [view, setView] = useState<View | null>(null);

  const date = clock?.date ?? null;
  const tz = clock?.tz ?? null;
  // One key per (date, tz, range, retry): an answer for another key is stale.
  const key = clock ? `${clock.key}|${days}|${nonce}` : null;

  useEffect(() => {
    if (!key || !date || !tz) return;
    let cancelled = false;
    (async () => {
      try {
        const report = await fetchFrogReport(days, date, tz);
        if (!cancelled) setView({ key, report });
      } catch (e) {
        if (!cancelled) setView({ key, error: e instanceof Error ? e.message : "Something went wrong" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, days, date, tz]);

  const current = view && view.key === key ? view : null;
  // While a new range loads, keep showing the previous report (dimmed), like the rest of the page.
  const shown = view && "report" in view ? view.report : null;
  const loading = !current;

  return (
    <section className="mt-8" aria-labelledby="frog-report-title">
      <div className="mb-3">
        <h2 id="frog-report-title" className="text-base font-semibold flex items-center gap-2 text-foreground">
          <FrogIcon className="w-4 h-4 text-subtle" /> Eat that frog
        </h2>
        <p className="text-xs mt-0.5 text-subtle">
          Across all projects
          {projectFilterActive && " · the project filter above doesn't apply to frog stats"}
        </p>
      </div>

      {current && "error" in current ? (
        <div role="alert" className="rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm font-semibold text-foreground">Couldn&apos;t load frog stats</p>
          <p className="text-xs mt-1 break-words text-subtle">{current.error}</p>
          <button className="btn-secondary mt-4" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : shown ? (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }} aria-busy={loading}>
          <FrogReportView report={shown} days={days} />
        </div>
      ) : (
        <FrogSkeleton />
      )}
    </section>
  );
}

function FrogReportView({ report, days }: { report: FrogReport; days: number | "all" }) {
  const { stats, daily, abcdeCompleted, reflections } = report;
  const abcdeTotal = Object.values(abcdeCompleted).reduce((a, b) => a + b, 0);
  const noFrogs = stats.plannedDays === 0 && stats.longest === 0 && reflections.length === 0;

  if (noFrogs) {
    return (
      <>
        <div className="rounded-lg border border-border bg-surface p-6 text-center">
          <FrogIcon className="w-6 h-6 mx-auto mb-2 text-subtle" />
          <h3 className="text-sm font-semibold text-foreground">No frogs in this range yet</h3>
          <p className="text-xs mt-1 max-w-xs mx-auto leading-relaxed text-muted-foreground">
            Plan your day, pick the one task you&apos;d most regret leaving undone, and eat it first.
            Your streaks and reflections will build up here.
          </p>
          <Link href="/today" className="btn-primary mt-4 inline-flex">Plan today</Link>
        </div>
        {abcdeTotal > 0 && <div className="mt-4"><AbcdeCard counts={abcdeCompleted} total={abcdeTotal} /></div>}
      </>
    );
  }

  const rangeLabel = days === "all" ? "all time" : `last ${days} days`;
  // "All time" is capped at MAX_STRIP_DAYS cells; say so instead of claiming all of it.
  const stripLabel = days === "all" && daily.length >= MAX_STRIP_DAYS ? `last ${daily.length} days` : rangeLabel;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile icon={<Flame className="w-4 h-4" aria-hidden="true" />} label="Current streak" value={String(stats.current)} suffix={stats.current === 1 ? "day" : "days"} />
        <Tile icon={<Trophy className="w-4 h-4" aria-hidden="true" />} label="Longest streak" value={String(stats.longest)} suffix={stats.longest === 1 ? "day" : "days"} />
        <Tile
          icon={<FrogIcon />}
          label="Frogs eaten"
          value={String(stats.eatenDays)}
          suffix={stats.plannedDays > 0 ? `of ${stats.plannedDays} planned · ${pct(stats.eatenRate)}` : "of 0 planned"}
        />
        <Tile
          icon={<Sunrise className="w-4 h-4" aria-hidden="true" />}
          label="Before noon"
          value={stats.eatenDays ? pct(stats.beforeNoonRate) : "—"}
          suffix="of eaten frogs"
        />
      </div>

      <Card
        title="Frog calendar"
        subtitle={`One square per day, ${stripLabel}`}
        legend={[
          { color: FROG, label: "Eaten" },
          { color: MISSED, label: "Not eaten" },
          { color: EMPTY_CELL, label: "No plan", outline: true },
        ]}
      >
        <FrogCalendar daily={daily} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <AbcdeCard counts={abcdeCompleted} total={abcdeTotal} rangeLabel={rangeLabel} />
        <ReflectionsCard reflections={reflections} />
      </div>
    </>
  );
}

function FrogCalendar({ daily }: { daily: FrogReport["daily"] }) {
  if (daily.length === 0) return <p className="text-[13px] text-subtle">No days in this range.</p>;
  return (
    <>
      {/* Fixed-size squares that wrap: a 375px screen gets ~12 per row, no horizontal scroll. */}
      <ul className="flex flex-wrap" style={{ gap: 4, listStyle: "none", margin: 0, padding: 0 }}>
        {daily.map((d) => {
          const state = d.eaten ? (d.beforeNoon ? "eaten before noon" : "eaten") : d.planned ? "planned, not eaten" : "no plan";
          const label = `${longDate(d.date)}: ${state}`;
          return (
            <li key={d.date}>
              <span
                role="img"
                aria-label={label}
                title={label}
                className="flex items-center justify-center"
                style={{
                  width: 20, height: 20, borderRadius: 5,
                  background: d.eaten ? FROG : d.planned ? MISSED : EMPTY_CELL,
                  border: d.eaten || d.planned ? "none" : "1px solid var(--border)",
                }}
              >
                {/* A non-colour cue for eaten days; the cell's aria-label already says it. */}
                {d.eaten && <span aria-hidden="true" style={{ fontSize: 11, lineHeight: 1, fontWeight: 700, color: "var(--primary-foreground)" }}>✓</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between gap-3 mt-3 text-xs text-subtle tabular">
        <span>{format(parseISO(daily[0].date), "MMM d")}</span>
        <span>{format(parseISO(daily[daily.length - 1].date), "MMM d")}</span>
      </div>
    </>
  );
}

// Completed-task counts per ABCDE letter. BreakdownBars shows done/total, which
// has no meaning here (every counted task is done), so this is a plain count bar.
function AbcdeCard({ counts, total, rangeLabel }: { counts: AbcdeCounts; total: number; rangeLabel?: string }) {
  const rows = [
    ...ABCDE_LETTERS.map((l) => ({ key: l, label: `${l} · ${ABCDE_META[l].label}`, color: ABCDE_META[l].color, count: counts[l] })),
    { key: "none", label: "No letter", color: NONE_COLOR, count: counts.none },
  ];
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card title="Completed by ABCDE" subtitle={rangeLabel ? (rangeLabel === "all time" ? "Tasks completed, all time" : `Tasks completed in the ${rangeLabel}`) : "Tasks completed in this range"}>
      {total === 0 ? (
        <p className="text-[13px] text-subtle">No tasks completed in this range.</p>
      ) : (
        <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 112, flexShrink: 0, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, background: r.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
              </div>
              <div style={{ flex: 1, height: 16, position: "relative", minWidth: 0 }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(r.count / max) * 100}%`, minWidth: r.count ? 4 : 0, background: r.color, borderRadius: 4 }} />
              </div>
              <span style={{ width: 32, flexShrink: 0, textAlign: "right", fontSize: 12, color: "var(--foreground)", fontVariantNumeric: "tabular-nums" }}>{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReflectionsCard({ reflections }: { reflections: FrogReflection[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? reflections : reflections.slice(0, COLLAPSED_REFLECTIONS);
  const hidden = reflections.length - COLLAPSED_REFLECTIONS;
  return (
    <Card title="Reflections" subtitle="What you wrote when you closed the day">
      {reflections.length === 0 ? (
        <p className="text-[13px] text-subtle">
          No reflections yet. Close a day on <Link href="/today" className="underline text-muted-foreground">Today</Link> to start your journal.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-4" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {visible.map((r) => (
              <li key={r.date} className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-xs font-semibold text-foreground">{longDate(r.date)}</span>
                  {r.rating != null && <Stars rating={r.rating} />}
                  {r.frogTitle != null && (
                    <span className="inline-flex items-center gap-1 text-xs min-w-0 break-words" style={{ color: r.eaten ? FROG : "var(--subtle)" }}>
                      <FrogIcon className="w-3 h-3 flex-shrink-0" /> {r.frogTitle} · {r.eaten ? "eaten ✓" : "not eaten"}
                    </span>
                  )}
                </div>
                {r.wentWell && <Note label="Went well" text={r.wentWell} />}
                {r.improve && <Note label="Do differently" text={r.improve} />}
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              className="mt-4 text-xs underline text-muted-foreground hover:text-foreground rounded-sm"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show fewer" : `Show more (${hidden})`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function Note({ label, text }: { label: string; text: string }) {
  return (
    <p className="text-xs mt-1.5 leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
      <span className="text-subtle">{label}: </span>{text}
    </p>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span role="img" aria-label={`Rated ${rating} out of 5`} title={`${rating} / 5`} className="text-xs tracking-tight text-foreground">
      {"★".repeat(rating)}
      <span style={{ color: "var(--faint)" }}>{"★".repeat(Math.max(0, 5 - rating))}</span>
    </span>
  );
}

function Tile({ icon, label, value, suffix }: { icon: React.ReactNode; label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 min-w-0">
      <div className="flex items-center gap-2 mb-2.5 text-subtle">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-3xl font-semibold tracking-[-0.02em] text-foreground tabular">{value}</span>
        {suffix && <span className="text-xs text-subtle">{suffix}</span>}
      </div>
    </div>
  );
}

function Card({ title, subtitle, legend, children }: {
  title: string; subtitle?: string;
  legend?: { color: string; label: string; outline?: boolean }[];
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs mt-0.5 text-subtle">{subtitle}</p>}
        </div>
        {legend && (
          <div className="flex flex-wrap items-center gap-3">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: l.color, border: l.outline ? "1px solid var(--border)" : undefined }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function FrogSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading frog stats" role="status">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-raised h-[86px] animate-pulse" />
        ))}
      </div>
      <div className="rounded-lg border border-border bg-raised h-40 animate-pulse" />
    </div>
  );
}
