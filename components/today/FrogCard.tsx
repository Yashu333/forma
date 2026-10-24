"use client";

import Link from "next/link";
import { Check, Timer } from "lucide-react";
import type { TodayFrog } from "@/types";
import { formatEatenAt, isFrogEaten, nextBite, subtaskProgress } from "@/lib/frog/dayview";
import { AbcdeBadge, FrogIcon, ProjectChip } from "./bits";

interface Props {
  frog: TodayFrog | null;
  date: string;
  tz: string;
  busy: boolean;
  /** The day has been reviewed: an uneaten frog was moved on, so it can't be eaten for this day any more. */
  closed?: boolean;
  onEat: () => void;
}

export default function FrogCard({ frog, date, tz, busy, closed = false, onEat }: Props) {
  if (!frog) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-surface p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><FrogIcon /> No frog chosen for today</p>
        <p className="text-xs mt-1 text-muted-foreground">
          Your frog is the one task you&apos;d most regret leaving undone.{" "}
          <Link href="/today/label" className="underline text-foreground">Label your tasks</Link> and your A1 becomes the frog.
        </p>
      </div>
    );
  }

  const eaten = isFrogEaten(frog, date, tz);
  const doneStatusId = frog.group.doneStatusId;
  const { done, total } = subtaskProgress(frog.subtasks, doneStatusId);
  const bite = nextBite(frog.subtasks, doneStatusId);
  const canEat = doneStatusId !== null;

  return (
    <div
      className="rounded-lg border border-border bg-surface p-5 pl-7"
      style={{ borderLeft: `3px solid ${eaten ? "var(--success)" : "var(--primary)"}` }}
      aria-label="Today's frog"
    >
      <div className="flex items-center gap-2 mb-3">
        <FrogIcon />
        <span className="section-label">{eaten ? "Frog eaten" : "Today's frog"}</span>
        {eaten && <Check className="w-4 h-4 text-success" aria-hidden="true" />}
      </div>

      <Link
        href={`/group/${frog.group.id}`}
        className={`block text-xl font-semibold tracking-[-0.02em] leading-snug break-words hover:underline ${eaten ? "line-through text-muted-foreground" : "text-foreground"}`}
      >
        {frog.title}
      </Link>

      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        <AbcdeBadge abcde={frog.abcde} abcdeRank={frog.abcdeRank} />
        <ProjectChip name={frog.group.name} color={frog.group.color} />
      </div>

      {total > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs mb-1.5 text-muted-foreground">
            <span className="tabular">{done} of {total} {total === 1 ? "bite" : "bites"} done</span>
            {!eaten && bite && <span className="min-w-0 break-words text-subtle">Next bite: <strong className="font-semibold text-foreground">{bite.title}</strong></span>}
          </div>
          <div className="h-1 rounded-full overflow-hidden bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Bites done">
            <div className={`h-full rounded-full transition-all ${eaten ? "bg-success" : "bg-primary"}`} style={{ width: `${(done / total) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="mt-5">
        {eaten ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-success">
            {frog.completedAt ? formatEatenAt(frog.completedAt, tz, date) : "Eaten"}
          </div>
        ) : closed ? (
          <p className="text-sm text-subtle">Not eaten today.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {/* The span carries the tooltip: browsers don't show one on a disabled button. */}
              <span title={canEat ? undefined : "This project has no Done column"} className="block flex-1 sm:flex-none">
                <button
                  className="btn-primary w-full sm:w-auto h-11 px-8 text-[15px]"
                  disabled={!canEat || busy}
                  onClick={onEat}
                >
                  {busy ? "Eating…" : "Ate it"}
                </button>
              </span>
              <a
                href={`/pomodoro?task=${frog.id}`}
                target="_blank"
                rel="noopener"
                className="btn-outline h-11 px-4"
                aria-label={`Focus on ${frog.title}`}
              >
                <Timer className="w-4 h-4" aria-hidden="true" /> Focus
              </a>
            </div>
            {!canEat && (
              <p className="text-xs mt-2 text-subtle">
                This project has no Done column.{" "}
                <Link href={`/group/${frog.group.id}`} className="underline text-muted-foreground">Open the board</Link> to add one.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
