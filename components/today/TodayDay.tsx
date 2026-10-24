"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Archive, Check, Flame, Info, ListPlus, Lock, Tags, X } from "lucide-react";
import type { TodayPayload, TodayTask } from "@/types";
import { activeFrog, aFirstNotice, applyTaskUpdate, formatDateKeyLong, isFrogLockActive, isRowLocked, isTaskDone, removeTask, showAFirstHint, streakLabel } from "@/lib/frog/dayview";
import ConfettiCelebration, { type ConfettiHandle } from "@/components/board/ConfettiCelebration";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { isReviewed } from "@/lib/frog/review";
import { ABCDE_META } from "@/lib/frog/abcde";
import { archiveTask, markTaskDone, saveFrogFirstMode } from "./api";
import CloseDayFlow from "./CloseDayFlow";
import DayClosedCard from "./DayClosedCard";
import FrogCard from "./FrogCard";
import FrogFirstToggle from "./FrogFirstToggle";
import { AbcdeBadge, FROG, FrogIcon, ProjectChip, Tag } from "./bits";

interface Props {
  payload: TodayPayload;
  tz: string;
  /** Apply a change to the loaded payload (optimistic updates and server results). */
  onChange: (fn: (p: TodayPayload) => TodayPayload) => void;
  /** Quietly re-fetch the payload (streak, completedToday) after a change. */
  onRefresh: () => void;
  /** The review was saved: the server's payload with the day closed. */
  onReviewed: (payload: TodayPayload) => void;
}

const errorStyle = { color: "var(--danger)", background: "var(--surface)", border: "1px solid var(--danger)" } as const;

export default function TodayDay({ payload, tz, onChange, onRefresh, onReviewed }: Props) {
  const [busy, setBusy] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toEliminate, setToEliminate] = useState<TodayTask | null>(null);
  const [closing, setClosing] = useState(false);
  const [settingError, setSettingError] = useState<string | null>(null);
  const savingSetting = useRef(false);
  const confettiRef = useRef<ConfettiHandle>(null);

  // An archived, uneaten frog was eliminated: the server still returns it, we don't show it.
  const frog = activeFrog(payload.frog);
  const streak = streakLabel(payload.streak.current);
  const doneCount = payload.tasks.filter(isTaskDone).length;

  // Optimistic, with rollback. Goes through onChange like every other edit, so a
  // refresh that started earlier can't overwrite it; the second onChange on success
  // does the same for a refresh that started while the save was in flight.
  async function toggleFrogFirst() {
    if (savingSetting.current) return;
    const previous = payload.frogFirstMode;
    const next = !previous;
    savingSetting.current = true;
    setSettingError(null);
    onChange((p) => ({ ...p, frogFirstMode: next }));
    try {
      await saveFrogFirstMode(next);
      onChange((p) => ({ ...p, frogFirstMode: next }));
    } catch (e) {
      onChange((p) => ({ ...p, frogFirstMode: previous }));
      setSettingError(e instanceof Error ? e.message : "Couldn't save that setting");
    } finally {
      savingSetting.current = false;
    }
  }

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
      if (frog?.id === task.id) confettiRef.current?.fire();
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

  // The close-the-day flow takes over the page, like the plan stepper does.
  if (closing) {
    return (
      <CloseDayFlow
        payload={payload}
        tz={tz}
        onSaved={(saved) => {
          setClosing(false);
          onReviewed(saved);
        }}
        onCancel={() => setClosing(false)}
      />
    );
  }

  const reviewed = isReviewed(payload);
  // Frog-first mode: while the frog is uneaten the other open rows are dimmed and can't be checked off.
  const lockActive = isFrogLockActive({ frogFirstMode: payload.frogFirstMode, reviewed, frog, planDate: payload.date, tz });

  return (
    <div className="p-5 md:p-7 max-w-3xl mx-auto text-foreground">
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
          <h1 className="text-[28px] sm:text-4xl font-semibold tracking-[-0.025em] leading-[1.1]">Today</h1>
          <p className="text-sm mt-2 text-muted-foreground">{formatDateKeyLong(payload.date)}</p>
          {streak && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 mt-3 text-xs text-muted-foreground">
              <Flame className="w-3.5 h-3.5" aria-hidden="true" />
              {streak}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/today/new" className="btn-ghost border border-border">
            <ListPlus className="w-3.5 h-3.5" aria-hidden="true" /> New tasks
          </Link>
          <Link href="/today/label" className="btn-ghost border border-border">
            <Tags className="w-3.5 h-3.5" aria-hidden="true" /> Label tasks
          </Link>
          {/* Once the day is closed, the Day closed card below carries "Edit review". */}
          {!reviewed && (
            <button className="btn-primary" onClick={() => setClosing(true)}>
              Close the day
            </button>
          )}
        </div>
      </div>

      <FrogFirstToggle checked={payload.frogFirstMode} onToggle={toggleFrogFirst} error={settingError} />

      {reviewed && <DayClosedCard payload={payload} tz={tz} onEdit={() => setClosing(true)} />}

      <FrogCard
        frog={frog}
        date={payload.date}
        tz={tz}
        busy={frog ? busy.includes(frog.id) : false}
        closed={reviewed}
        onEat={() => frog && complete(frog)}
      />

      {error && (
        <p role="alert" className="mt-4 text-xs rounded-md px-3 py-2 flex items-start justify-between gap-2" style={errorStyle}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button aria-label="Dismiss" onClick={() => setError(null)} className="flex-shrink-0"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 text-xs rounded-md px-3 py-2 flex items-start justify-between gap-2 border border-border bg-surface text-muted-foreground">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{notice}</span>
          <button aria-label="Dismiss" onClick={() => setNotice(null)} className="flex-shrink-0"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
        </p>
      )}

      {/* Today's list */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mt-6 mb-3">
        <h2 className="text-base font-semibold">Today&apos;s list</h2>
        <span className="text-xs text-subtle tabular">{doneCount} of {payload.tasks.length} done</span>
      </div>

      {lockActive && (
        <p className="flex items-start gap-2 text-xs rounded-md px-3 py-2 mb-3 border border-border bg-surface text-muted-foreground">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-px" aria-hidden="true" />
          <span className="min-w-0 break-words">Frog first mode is on. Eat your frog to unlock the rest of your list.</span>
        </p>
      )}

      {payload.tasks.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted-foreground">Nothing planned for today.</p>
          <Link href="/today/label" className="text-xs mt-2 inline-block underline text-muted-foreground hover:text-foreground">Label your tasks</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {payload.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isFrog={frog?.id === task.id}
              openA={payload.openA}
              busy={busy.includes(task.id)}
              locked={isRowLocked({ lockActive, task, frogId: frog?.id })}
              onComplete={() => complete(task)}
              onEliminate={() => setToEliminate(task)}
            />
          ))}
        </ul>
      )}
      <p className="text-xs mt-3 text-subtle">
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
  locked,
  onComplete,
  onEliminate,
}: {
  task: TodayTask;
  isFrog: boolean;
  openA: number;
  busy: boolean;
  /** Frog-first mode: the frog is uneaten and this isn't it. */
  locked: boolean;
  onComplete: () => void;
  onEliminate: () => void;
}) {
  const done = isTaskDone(task);
  const noDoneColumn = task.group.doneStatusId === null;
  const disabled = done || noDoneColumn || busy || locked;
  const checkTitle = done
    ? "Done. Reopen it from the project board."
    : locked
      ? "Eat your frog first"
      : noDoneColumn
        ? "This project has no Done column"
        : "Mark as done";

  return (
    <li
      className="rounded-lg border border-border bg-surface py-3 pl-5 pr-3 flex items-start gap-3"
      style={{
        opacity: done ? 0.7 : locked ? 0.6 : 1,
        // A to E label colour on the start edge, same as the board and dashboard cards.
        ...(task.abcde ? { borderLeft: `3px solid ${ABCDE_META[task.abcde].color}` } : {}),
      }}
    >
      {/* The span carries the tooltip: browsers don't show one on a disabled button. */}
      <span title={checkTitle} className="flex-shrink-0 mt-0.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-disabled={disabled}
          aria-label={`${checkTitle}: ${task.title}`}
          disabled={disabled}
          onClick={onComplete}
          className="w-5 h-5 rounded-md flex items-center justify-center transition-colors"
          style={
            done
              ? { background: FROG, border: `1px solid ${FROG}`, cursor: "default" }
              : { background: "transparent", border: "1px solid var(--input)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }
          }
        >
          {done && <Check className="w-3.5 h-3.5 text-primary-foreground" aria-hidden="true" />}
        </button>
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {isFrog && <span aria-label="Today's frog" title="Today's frog" className="mt-0.5 text-foreground"><FrogIcon /></span>}
          <Link
            href={`/group/${task.group.id}`}
            className={`text-sm font-medium break-words min-w-0 hover:underline ${done ? "line-through text-subtle" : "text-foreground"}`}
          >
            {task.title}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <AbcdeBadge abcde={task.abcde} abcdeRank={task.abcdeRank} />
          <ProjectChip name={task.group.name} color={task.group.color} />
          {task.abcde === "D" && <Tag color="#A78BFA">Delegate</Tag>}
          {showAFirstHint(task, openA) && <span className="text-xs text-muted-foreground">A tasks first</span>}
          {task.abcde === "E" && !done && (
            <button
              type="button"
              disabled={busy}
              onClick={onEliminate}
              className="inline-flex items-center gap-1 rounded-md px-1.5 h-5 text-[11px] font-semibold border border-danger text-danger bg-surface disabled:opacity-50"
            >
              <Archive className="w-3 h-3" aria-hidden="true" /> Eliminate
            </button>
          )}
          {done && (
            <Link href={`/group/${task.group.id}`} className="text-xs underline text-muted-foreground hover:text-foreground">
              Reopen on board
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
