"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Archive, Check, Pencil, X } from "lucide-react";
import type { TodayPayload, TodayTask } from "@/types";
import { aFirstNotice, applyTaskUpdate, formatDateKeyLong, isTaskDone, removeTask, showAFirstHint, streakLabel } from "@/lib/frog/dayview";
import ConfettiCelebration, { type ConfettiHandle } from "@/components/board/ConfettiCelebration";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { archiveTask, markTaskDone } from "./api";
import FrogCard from "./FrogCard";
import { AbcdeBadge, FROG, ProjectChip, Tag } from "./bits";

interface Props {
  payload: TodayPayload;
  tz: string;
  /** Apply a change to the loaded payload (optimistic updates and server results). */
  onChange: (fn: (p: TodayPayload) => TodayPayload) => void;
  /** Quietly re-fetch the payload (streak, completedToday) after a change. */
  onRefresh: () => void;
  onEditPlan: () => void;
}

const errorStyle = { color: "#F87171", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.30)" } as const;

export default function TodayDay({ payload, tz, onChange, onRefresh, onEditPlan }: Props) {
  const [busy, setBusy] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toEliminate, setToEliminate] = useState<TodayTask | null>(null);
  const confettiRef = useRef<ConfettiHandle>(null);

  const streak = streakLabel(payload.streak.current);
  const doneCount = payload.tasks.filter(isTaskDone).length;

  // Done is one-way from this page: the checkbox moves the task into its
  // project's Done column and locks. Reopening is a board action.
  async function complete(task: { id: string; abcde?: TodayTask["abcde"]; group: { doneStatusId: string | null } }) {
    const doneStatusId = task.group.doneStatusId;
    if (!doneStatusId || busy.includes(task.id)) return;
    const warning = aFirstNotice(task, payload.openA);
    setBusy((b) => [...b, task.id]);
    setError(null);
    try {
      const updated = await markTaskDone(task.id, doneStatusId);
      onChange((p) => applyTaskUpdate(p, updated));
      setNotice(warning);
      if (payload.frog?.id === task.id) confettiRef.current?.fire();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't mark that done");
    } finally {
      setBusy((b) => b.filter((id) => id !== task.id));
    }
  }

  async function eliminate(task: TodayTask) {
    setToEliminate(null);
    setBusy((b) => [...b, task.id]);
    setError(null);
    try {
      await archiveTask(task.id);
      onChange((p) => removeTask(p, task.id));
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't archive that task");
    } finally {
      setBusy((b) => b.filter((id) => id !== task.id));
    }
  }

  return (
    <div className="p-5 md:p-7 max-w-3xl mx-auto" style={{ color: "var(--text-primary)" }}>
      {toEliminate && (
        <ConfirmDialog
          title="Eliminate this task?"
          message={`"${toEliminate.title}" will be archived: hidden from the board, kept for reports.`}
          confirmLabel="Eliminate"
          onConfirm={() => eliminate(toEliminate)}
          onCancel={() => setToEliminate(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Today</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{formatDateKeyLong(payload.date)}</p>
          {streak && (
            <span
              className="inline-flex items-center rounded-full px-2.5 h-6 mt-2 text-xs font-semibold"
              style={{ color: "#FBBF24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.32)" }}
            >
              {streak}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" style={{ border: "1px solid var(--border-strong)" }} onClick={onEditPlan}>
            <Pencil className="w-3.5 h-3.5" /> Edit plan
          </button>
          {/* Stub: the review flow arrives in the next milestone. */}
          <button
            className="btn-primary"
            style={{ opacity: 0.5, cursor: "not-allowed" }}
            disabled
            title="The end-of-day review is coming next"
          >
            Close the day · coming next
          </button>
        </div>
      </div>

      <FrogCard
        frog={payload.frog}
        date={payload.date}
        tz={tz}
        busy={payload.frog ? busy.includes(payload.frog.id) : false}
        onEat={() => payload.frog && complete(payload.frog)}
        onEditPlan={onEditPlan}
      />

      {error && (
        <p role="alert" className="mt-4 text-xs rounded-lg px-3 py-2 flex items-start justify-between gap-2" style={errorStyle}>
          <span className="min-w-0 break-words">{error}</span>
          <button aria-label="Dismiss" onClick={() => setError(null)} className="flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-xs rounded-lg px-3 py-2 flex items-start justify-between gap-2"
           style={{ color: "#FBBF24", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.28)" }}>
          <span className="min-w-0 break-words">{notice}</span>
          <button aria-label="Dismiss" onClick={() => setNotice(null)} className="flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
        </p>
      )}

      {/* Today's list */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mt-6 mb-3">
        <h2 className="text-base font-semibold">Today&apos;s list</h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{doneCount} of {payload.tasks.length} done</span>
      </div>

      {payload.tasks.length === 0 ? (
        <div className="rounded-2xl p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--border-strong)" }}>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Nothing planned for today.</p>
          <button className="text-xs mt-2 underline" style={{ color: "var(--text-muted)" }} onClick={onEditPlan}>Edit your plan</button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {payload.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isFrog={payload.frog?.id === task.id}
              openA={payload.openA}
              busy={busy.includes(task.id)}
              onComplete={() => complete(task)}
              onEliminate={() => setToEliminate(task)}
            />
          ))}
        </ul>
      )}
      <p className="text-[11px] mt-3" style={{ color: "var(--text-muted)" }}>
        Checked tasks stay done here. To reopen one, move it out of Done on its project board.
      </p>

      <ConfettiCelebration ref={confettiRef} />
    </div>
  );
}

function TaskRow({
  task,
  isFrog,
  openA,
  busy,
  onComplete,
  onEliminate,
}: {
  task: TodayTask;
  isFrog: boolean;
  openA: number;
  busy: boolean;
  onComplete: () => void;
  onEliminate: () => void;
}) {
  const done = isTaskDone(task);
  const noDoneColumn = task.group.doneStatusId === null;
  const disabled = done || noDoneColumn || busy;
  const checkTitle = done ? "Done. Reopen it from the project board." : noDoneColumn ? "This project has no Done column" : "Mark as done";

  return (
    <li
      className="rounded-2xl px-3 py-3 flex items-start gap-3"
      style={{ background: "var(--card)", border: `1px solid ${isFrog && !done ? "rgba(249,115,22,0.40)" : "var(--border-strong)"}`, opacity: done ? 0.7 : 1 }}
    >
      {/* The span carries the tooltip: browsers don't show one on a disabled button. */}
      <span title={checkTitle} className="flex-shrink-0 mt-0.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`${checkTitle}: ${task.title}`}
          disabled={disabled}
          onClick={onComplete}
          className="w-5 h-5 rounded-md flex items-center justify-center transition-all duration-150"
          style={
            done
              ? { background: FROG, border: `1px solid ${FROG}`, cursor: "default" }
              : { background: "transparent", border: "1.5px solid var(--border-strong)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }
          }
        >
          {done && <Check className="w-3.5 h-3.5" style={{ color: "#10231B" }} />}
        </button>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {isFrog && <span aria-label="Today's frog" title="Today's frog">🐸</span>}
          <Link
            href={`/group/${task.group.id}`}
            className="text-sm font-medium break-words min-w-0 hover:underline"
            style={{ color: done ? "var(--text-muted)" : "var(--text-primary)", textDecorationLine: done ? "line-through" : undefined }}
          >
            {task.title}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <AbcdeBadge abcde={task.abcde} abcdeRank={task.abcdeRank} />
          <ProjectChip name={task.group.name} color={task.group.color} />
          {task.abcde === "D" && <Tag color="#A78BFA">Delegate</Tag>}
          {showAFirstHint(task, openA) && <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>A tasks first</span>}
          {task.abcde === "E" && !done && (
            <button
              type="button"
              disabled={busy}
              onClick={onEliminate}
              className="inline-flex items-center gap-1 rounded-md px-1.5 h-5 text-[10px] font-semibold"
              style={{ color: "#F87171", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.30)", opacity: busy ? 0.5 : 1 }}
            >
              <Archive className="w-3 h-3" /> Eliminate
            </button>
          )}
          {done && (
            <Link href={`/group/${task.group.id}`} className="text-[10px] underline" style={{ color: "var(--text-muted)" }}>
              Reopen on board
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
