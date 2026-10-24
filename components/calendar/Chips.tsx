"use client";

import { useDraggable } from "@dnd-kit/core";
import { Repeat } from "lucide-react";
import { formatRepeat, parseRepeatRule } from "@/lib/recurrence/rule";
import { timeText, type CalItem, type CalRecurring, type CalTask } from "./types";

// What an item looks like on the calendar: a small chip in the month grid, a
// full row in the week list. Tasks can be dragged to another day; faded
// "ghost" chips are future occurrences of a repeating task and can't.

export function RepeatMark({ rule }: { rule: unknown }) {
  const parsed = parseRepeatRule(rule);
  if (!parsed) return null;
  return (
    <span className="inline-flex flex-shrink-0 text-subtle" title={formatRepeat(parsed)}>
      <Repeat className="w-3 h-3" aria-hidden="true" />
      <span className="sr-only">{formatRepeat(parsed)}</span>
    </span>
  );
}

interface TaskProps {
  task: CalTask;
  overdue: boolean;
  variant: "chip" | "row";
  onOpen: (id: string) => void;
}

export function TaskChip({ task, overdue, variant, onOpen }: TaskProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}` });
  const row = variant === "row";
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      onClick={() => onOpen(task.id)}
      className={`w-full text-left flex items-center gap-1.5 rounded-md bg-raised hover:bg-border transition-colors ${row ? "px-3 py-2.5 text-sm" : "px-1.5 py-1 text-xs"} ${task.done ? "text-faint" : "text-foreground"}`}
      style={{ borderLeft: `3px solid ${task.group.color}`, opacity: isDragging ? 0.4 : 1 }}
    >
      {task.dueDate && (
        <span className={`font-mono flex-shrink-0 ${overdue && !task.done ? "text-danger" : "text-subtle"}`}>
          {timeText(task.dueDate)}
          {overdue && !task.done && <span className="sr-only"> (overdue)</span>}
        </span>
      )}
      <span className={`truncate flex-1 ${task.done ? "line-through" : ""}`}>{task.title}</span>
      {row && <span className="text-xs text-subtle truncate max-w-[30%] hidden sm:inline">{task.group.name}</span>}
      <RepeatMark rule={task.repeat} />
    </button>
  );
}

interface GhostProps {
  rec: CalRecurring;
  variant: "chip" | "row";
  onOpen: (id: string) => void;
}

export function GhostChip({ rec, variant, onOpen }: GhostProps) {
  const row = variant === "row";
  return (
    <button
      type="button"
      onClick={() => onOpen(rec.id)}
      className={`w-full text-left flex items-center gap-1.5 rounded-md border border-dashed border-border-strong text-subtle hover:text-muted-foreground transition-colors ${row ? "px-3 py-2.5 text-sm" : "px-1.5 py-1 text-xs"}`}
      title="Next occurrence of a repeating task"
    >
      <span className="truncate flex-1">{rec.title}</span>
      <RepeatMark rule={rec.repeat} />
    </button>
  );
}

export function ItemView({ item, nowMs, variant, onOpen }: { item: CalItem; nowMs: number; variant: "chip" | "row"; onOpen: (id: string) => void }) {
  if (item.kind === "ghost") return <GhostChip rec={item.rec} variant={variant} onOpen={onOpen} />;
  const overdue = !!item.task.dueDate && new Date(item.task.dueDate).getTime() < nowMs;
  return <TaskChip task={item.task} overdue={overdue} variant={variant} onOpen={onOpen} />;
}
