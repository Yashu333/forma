"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import type { TodayFrog } from "@/types";
import { formatEatenAt, isFrogEaten, nextBite, subtaskProgress } from "@/lib/frog/dayview";
import { AbcdeBadge, FROG, ProjectChip } from "./bits";

interface Props {
  frog: TodayFrog | null;
  date: string;
  tz: string;
  busy: boolean;
  onEat: () => void;
  onEditPlan: () => void;
}

export default function FrogCard({ frog, date, tz, busy, onEat, onEditPlan }: Props) {
  if (!frog) {
    return (
      <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px dashed var(--border-strong)" }}>
        <p className="text-sm font-semibold">🐸 No frog chosen for today</p>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          Your frog is the one task you&apos;d most regret leaving undone.{" "}
          <button className="underline" onClick={onEditPlan}>Edit your plan</button> to pick one.
        </p>
      </div>
    );
  }

  const eaten = isFrogEaten(frog, date, tz);
  const doneStatusId = frog.group.doneStatusId;
  const { done, total } = subtaskProgress(frog.subtasks, doneStatusId);
  const bite = nextBite(frog.subtasks, doneStatusId);
  const canEat = doneStatusId !== null;
  const accent = eaten ? FROG : "#F97316";

  return (
    <div
      className="rounded-2xl p-5 relative overflow-hidden"
      style={{
        background: eaten ? "linear-gradient(135deg, rgba(52,211,153,0.14), var(--card) 60%)" : "linear-gradient(135deg, rgba(249,115,22,0.12), var(--card) 60%)",
        border: `1px solid ${accent}55`,
      }}
      aria-label="Today's frog"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl leading-none" aria-hidden="true">🐸</span>
        <span className="section-label" style={{ color: accent }}>{eaten ? "Frog eaten" : "Today's frog"}</span>
      </div>

      <Link
        href={`/group/${frog.group.id}`}
        className="block text-lg font-semibold leading-snug break-words hover:underline"
        style={{ color: "var(--text-primary)", textDecorationLine: eaten ? "line-through" : undefined, textDecorationColor: "var(--text-muted)" }}
      >
        {frog.title}
      </Link>

      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        <AbcdeBadge abcde={frog.abcde} abcdeRank={frog.abcdeRank} />
        <ProjectChip name={frog.group.name} color={frog.group.color} />
      </div>

      {total > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>
            <span>{done} of {total} {total === 1 ? "bite" : "bites"} done</span>
            {!eaten && bite && <span className="min-w-0 break-words" style={{ color: "var(--text-muted)" }}>Next bite: <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{bite.title}</strong></span>}
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(done / total) * 100}%`, background: accent }} />
          </div>
        </div>
      )}

      <div className="mt-5">
        {eaten ? (
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: FROG }}>
            <span className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(52,211,153,0.18)" }}>
              <Check className="w-4 h-4" />
            </span>
            {frog.completedAt ? formatEatenAt(frog.completedAt, tz, date) : "Eaten"}
          </div>
        ) : (
          <>
            {/* The span carries the tooltip: browsers don't show one on a disabled button. */}
            <span title={canEat ? undefined : "This project has no Done column"} className="block sm:inline-block">
              <button
                className="btn-primary w-full sm:w-auto h-12 px-8 text-base"
                style={!canEat || busy ? { opacity: 0.5, cursor: "not-allowed" } : { background: "#F97316", borderColor: "rgba(249,115,22,0.6)", boxShadow: "0 4px 16px rgba(249,115,22,0.30)" }}
                disabled={!canEat || busy}
                onClick={onEat}
              >
                {busy ? "Eating…" : "Ate it"}
              </button>
            </span>
            {!canEat && (
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                This project has no Done column.{" "}
                <Link href={`/group/${frog.group.id}`} className="underline">Open the board</Link> to add one.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
