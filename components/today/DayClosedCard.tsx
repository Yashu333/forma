"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Flame, Pencil, Tags } from "lucide-react";
import type { TodayPayload } from "@/types";
import { ABCDE_META, compareTasks } from "@/lib/frog/abcde";
import { activeFrog, isPlanned } from "@/lib/frog/dayview";
import { addDays } from "@/lib/frog/dates";
import { labelCode } from "@/lib/frog/labels";
import { summarizeReview } from "@/lib/frog/review";
import { fetchToday } from "./api";

interface Props {
  payload: TodayPayload;
  tz: string;
  onEdit: () => void;
}

/**
 * Tomorrow's plan is not in today's payload, so it's read from tomorrow's own
 * (the same GET the page uses). Quiet on failure: the card just omits the
 * Tomorrow part. An answer for any other date is ignored.
 */
function useTomorrow(date: string, tz: string, version: string | null | undefined): TodayPayload | null {
  const [tomorrow, setTomorrow] = useState<{ key: string; value: TodayPayload } | null>(null);
  const key = `${date}|${tz}|${version ?? ""}`;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = addDays(date, 1);
        const p = await fetchToday(next, tz);
        if (cancelled || p.date !== next) return;
        setTomorrow({ key, value: p });
      } catch {
        // no Tomorrow part
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, tz, key]);
  return tomorrow && tomorrow.key === key ? tomorrow.value : null;
}

/** The "Day closed" summary: frog eaten or not, tasks done, the streak, and tomorrow's list. */
export default function DayClosedCard({ payload, tz, onEdit }: Props) {
  const s = summarizeReview(payload, tz);
  // A re-save changes `reviewedAt`, so it also refreshes tomorrow.
  const tomorrow = useTomorrow(payload.date, tz, payload.plan?.reviewedAt);
  const tomorrowFrog = tomorrow ? activeFrog(tomorrow.frog)?.title ?? null : null;
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

      {tomorrow && <TomorrowPart tomorrow={tomorrow} />}
    </section>
  );
}

// Tomorrow's list as it stands (tasks moved over at close, repeating copies,
// anything already planned), in label order, with a way to label and plan it now.
function TomorrowPart({ tomorrow }: { tomorrow: TodayPayload }) {
  const tasks = [...tomorrow.tasks].sort(compareTasks);
  const planned = isPlanned(tomorrow);
  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-foreground">Tomorrow</h3>
          <span className="text-xs text-subtle tabular">
            {tasks.length === 0 ? "Nothing yet" : `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
            {planned ? ", planned" : ""}
          </span>
        </div>
        <Link href="/today/label?day=tomorrow" className="btn-outline">
          <Tags className="w-3.5 h-3.5" aria-hidden="true" /> {planned ? "Edit tomorrow" : "Plan tomorrow"}
        </Link>
      </div>
      {tasks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-baseline gap-2 text-sm min-w-0">
              <span
                className="font-mono text-xs font-semibold tabular w-7 flex-shrink-0"
                style={t.abcde ? { color: ABCDE_META[t.abcde].color } : undefined}
              >
                {labelCode(t) || <span className="text-faint" aria-label="No label">–</span>}
              </span>
              <span className="text-muted-foreground break-words min-w-0">{t.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
