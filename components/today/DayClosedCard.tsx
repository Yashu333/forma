"use client";

import { useEffect, useState } from "react";
import { Check, Flame, Pencil } from "lucide-react";
import type { TodayPayload } from "@/types";
import { activeFrog } from "@/lib/frog/dayview";
import { addDays } from "@/lib/frog/dates";
import { summarizeReview } from "@/lib/frog/review";
import { fetchToday } from "./api";

interface Props {
  payload: TodayPayload;
  tz: string;
  onEdit: () => void;
}

/**
 * Tomorrow's frog is not in today's payload, so it's read from tomorrow's own
 * (the same GET the page uses). Quiet on failure: the card just omits the line.
 * An answer for any other date is ignored.
 */
function useTomorrowFrogTitle(date: string, tz: string, version: string | null | undefined): string | null {
  const [title, setTitle] = useState<{ key: string; value: string | null } | null>(null);
  const key = `${date}|${tz}|${version ?? ""}`;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tomorrow = addDays(date, 1);
        const p = await fetchToday(tomorrow, tz);
        if (cancelled || p.date !== tomorrow) return;
        setTitle({ key, value: activeFrog(p.frog)?.title ?? null });
      } catch {
        // no line
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, tz, key]);
  return title && title.key === key ? title.value : null;
}

/** The "Day closed" summary: frog eaten or not, tasks done, tomorrow's frog, the streak. */
export default function DayClosedCard({ payload, tz, onEdit }: Props) {
  const s = summarizeReview(payload, tz);
  // A re-save changes `reviewedAt`, so it also refreshes tomorrow's frog.
  const tomorrowFrog = useTomorrowFrogTitle(payload.date, tz, payload.plan?.reviewedAt);
  const rows: { label: string; value: string }[] = [
    {
      label: "Today's frog",
      value: s.outcome === "eaten" ? "Eaten" : s.outcome === "not-eaten" ? "Not eaten" : "No frog today",
    },
    { label: "Tasks done", value: String(s.doneCount) },
  ];
  if (tomorrowFrog) rows.push({ label: "Tomorrow's frog", value: tomorrowFrog });

  return (
    <section aria-label="Day closed" className="rounded-lg border border-border bg-surface p-5 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 bg-success text-primary-foreground">
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
          <h2 className="text-base font-semibold text-foreground">Day closed</h2>
        </div>
        <button className="btn-outline" onClick={onEdit}>
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Edit review
        </button>
      </div>

      <dl className="flex flex-col gap-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt className="text-subtle">{r.label}</dt>
            <dd className="font-medium break-words min-w-0 text-foreground tabular">{r.value}</dd>
          </div>
        ))}
      </dl>

      <p className={`flex items-center gap-1.5 text-sm mt-3 font-medium ${s.streakCurrent > 0 ? "text-foreground" : "text-muted-foreground"}`}>
        {s.streakCurrent > 0 && <Flame className="w-4 h-4" aria-hidden="true" />}
        {s.streakText}
      </p>
    </section>
  );
}
