"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { TodayPayload } from "@/types";
import { useLocalClock } from "@/lib/frog/clock";
import { activeFrog, isFrogEaten, streakLabel } from "@/lib/frog/dayview";
import { fetchToday } from "@/components/today/api";
import { AbcdeBadge, FROG, ProjectChip } from "@/components/today/bits";

// Compact "Today's Frog" card for the dashboard. The dashboard page renders on
// the server clock, so this fetches /api/today with the browser's date and time
// zone. It must never break the page: while loading it is a skeleton and on any
// error it falls back to a plain link to /today.

type View = { key: string; payload: TodayPayload } | { key: string; failed: true };

const shell = { background: "var(--card)", border: "1px solid var(--border-strong)" } as const;

export default function TodaysFrogCard() {
  const clock = useLocalClock();
  const [view, setView] = useState<View | null>(null);

  const date = clock?.date ?? null;
  const tz = clock?.tz ?? null;
  const key = clock?.key ?? null;

  useEffect(() => {
    if (!key || !date || !tz) return;
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchToday(date, tz);
        if (!cancelled) setView({ key, payload });
      } catch {
        if (!cancelled) setView({ key, failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, date, tz]);

  const current = view && view.key === key ? view : null;

  if (!current || !tz) {
    return <div className="rounded-2xl h-[76px] animate-pulse" style={shell} role="status" aria-busy="true" aria-label="Loading today's frog" />;
  }

  if ("failed" in current) {
    return (
      <Link href="/today" className="flex items-center justify-between gap-3 rounded-2xl px-5 py-4" style={shell}>
        <span className="text-sm font-semibold"><span aria-hidden="true">🐸 </span>Today&apos;s frog</span>
        <span className="flex items-center gap-1.5 text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
          Open Today <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </Link>
    );
  }

  const { payload } = current;
  // An archived, uneaten frog was eliminated: it counts as no frog.
  const frog = activeFrog(payload.frog);
  const eaten = frog ? isFrogEaten(frog, payload.date, tz) : false;
  const streak = streakLabel(payload.streak.current);

  return (
    <Link
      href="/today"
      className="group block rounded-2xl px-5 py-4 transition-colors"
      style={{ ...shell, borderLeft: `3px solid ${eaten ? FROG : "#F97316"}` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 mb-1.5">
        <span className="section-label" style={{ color: eaten ? FROG : "#F97316" }}>
          <span aria-hidden="true">🐸 </span>{eaten ? "Frog eaten" : "Today's frog"}
        </span>
        {streak && (
          <span
            className="inline-flex items-center rounded-full px-2.5 h-6 text-xs font-semibold"
            style={{ color: "#FBBF24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.32)" }}
          >
            {streak}
          </span>
        )}
      </div>

      {frog ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug break-words" style={{ color: "var(--text-primary)", textDecoration: eaten ? "line-through" : undefined }}>
              {frog.title}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <AbcdeBadge abcde={frog.abcde} abcdeRank={frog.abcdeRank} />
              <ProjectChip name={frog.group.name} color={frog.group.color} />
              {eaten && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: FROG }}>
                  <Check className="w-3.5 h-3.5" /> Eaten
                </span>
              )}
            </div>
          </div>
          <ArrowRight className="w-4 h-4 flex-shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5" style={{ color: "var(--text-disabled)" }} />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No frog yet — plan your day</p>
          <ArrowRight className="w-4 h-4 flex-shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: "var(--text-disabled)" }} />
        </div>
      )}
    </Link>
  );
}
