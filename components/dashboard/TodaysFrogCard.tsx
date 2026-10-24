"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Flame } from "lucide-react";
import type { TodayPayload } from "@/types";
import { useLocalClock } from "@/lib/frog/clock";
import { activeFrog, isFrogEaten, streakLabel } from "@/lib/frog/dayview";
import { fetchToday } from "@/components/today/api";
import { AbcdeBadge, FrogIcon, ProjectChip } from "@/components/today/bits";

// Compact "Today's Frog" card for the dashboard. The dashboard page renders on
// the server clock, so this fetches /api/today with the browser's date and time
// zone. It must never break the page: while loading it is a skeleton and on any
// error it falls back to a plain link to /today.

type View = { key: string; payload: TodayPayload } | { key: string; failed: true };

const shell = "rounded-lg border border-border bg-surface";

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
    return <div className={`${shell} h-[76px] animate-pulse bg-raised`} role="status" aria-busy="true" aria-label="Loading today's frog" />;
  }

  if ("failed" in current) {
    return (
      <Link href="/today" className={`${shell} flex items-center justify-between gap-3 px-5 py-4 hover:bg-raised hover:border-border-strong transition-colors`}>
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><FrogIcon />Today&apos;s frog</span>
        <span className="flex items-center gap-1.5 text-xs flex-shrink-0 text-subtle">
          Open Today <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
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
      className={`${shell} group relative block pl-7 pr-5 py-4 transition-colors hover:bg-raised hover:border-border-strong`}
      style={{ borderLeft: `3px solid ${eaten ? "var(--success)" : "var(--primary)"}` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 mb-1.5">
        <span className="section-label inline-flex items-center gap-1.5">
          <FrogIcon />
          {eaten ? "Frog eaten" : "Today's frog"}
          {eaten && <Check className="w-4 h-4 text-success" aria-hidden="true" />}
        </span>
        {streak && (
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted-foreground">
            <Flame className="w-3.5 h-3.5" aria-hidden="true" />
            {streak}
          </span>
        )}
      </div>

      {frog ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-sm font-semibold leading-snug break-words ${eaten ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {frog.title}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <AbcdeBadge abcde={frog.abcde} abcdeRank={frog.abcdeRank} />
              <ProjectChip name={frog.group.name} color={frog.group.color} />
            </div>
          </div>
          <ArrowRight className="w-4 h-4 flex-shrink-0 mt-0.5 text-subtle" aria-hidden="true" />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">No frog yet. Plan your day.</p>
          <ArrowRight className="w-4 h-4 flex-shrink-0 text-subtle" aria-hidden="true" />
        </div>
      )}
    </Link>
  );
}
