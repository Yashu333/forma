"use client";

import { useEffect, useState } from "react";
import { Check, Pencil } from "lucide-react";
import type { TodayPayload } from "@/types";
import { activeFrog } from "@/lib/frog/dayview";
import { addDays } from "@/lib/frog/dates";
import { summarizeReview } from "@/lib/frog/review";
import { fetchToday } from "./api";
import { FROG } from "./bits";

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
      value: s.outcome === "eaten" ? "Eaten 🐸" : s.outcome === "not-eaten" ? "Not eaten" : "No frog today",
    },
    { label: "Tasks done", value: String(s.doneCount) },
  ];
  if (tomorrowFrog) rows.push({ label: "Tomorrow's frog", value: tomorrowFrog });

  return (
    <section
      aria-label="Day closed"
      className="rounded-2xl p-5 mb-5"
      style={{ background: "linear-gradient(135deg, rgba(52,211,153,0.12), var(--card) 60%)", border: "1px solid rgba(52,211,153,0.40)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(52,211,153,0.18)", color: FROG }}>
            <Check className="w-4 h-4" />
          </span>
          <h2 className="text-base font-semibold">Day closed</h2>
        </div>
        <button className="btn-ghost" style={{ border: "1px solid var(--border-strong)" }} onClick={onEdit}>
          <Pencil className="w-3.5 h-3.5" /> Edit review
        </button>
      </div>

      <dl className="flex flex-col gap-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt style={{ color: "var(--text-muted)" }}>{r.label}</dt>
            <dd className="font-medium break-words min-w-0">{r.value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-sm mt-3 font-medium" style={{ color: s.streakCurrent > 0 ? "#FBBF24" : "var(--text-secondary)" }}>{s.streakText}</p>
    </section>
  );
}
