"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Task, Priority } from "@/types";
import { MessageSquare, CheckSquare, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ABCDE_META, formatAbcde } from "@/lib/frog/abcde";

// Priority colours are data (they tell tasks apart at a glance), so they stay as-is.
const PRIORITY: Record<Priority, { label: string; bg: string; border: string; text: string; dot: string }> = {
  URGENT: { label: "Urgent", dot: "#A867C0", bg: "rgba(168,103,192,0.10)", border: "rgba(168,103,192,0.25)", text: "#C39BD3" },
  HIGH:   { label: "High",   dot: "#DC4E55", bg: "rgba(220,78,85,0.10)",  border: "rgba(220,78,85,0.25)",  text: "#F4959A" },
  MEDIUM: { label: "Medium", dot: "#4A8FA8", bg: "rgba(74,143,168,0.10)", border: "rgba(74,143,168,0.25)", text: "#7EB8CC" },
  LOW:    { label: "Low",    dot: "#74869F", bg: "rgba(116,134,159,0.10)", border: "rgba(116,134,159,0.25)",   text: "#94A3B8" },
};

interface Props { task: Task; onOpen: (task: Task) => void; isDragging?: boolean; isNew?: boolean; }

export default function TaskCard({ task, onOpen, isDragging, isNew }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSorting } =
    useSortable({ id: task.id });

  const p = PRIORITY[task.priority];
  const subtaskCount = task._count?.subtasks ?? task.subtasks?.length ?? 0;
  const commentCount = task._count?.comments ?? task.comments?.length ?? 0;
  const abcdeColor   = task.abcde ? ABCDE_META[task.abcde].color : null;
  const hasFooter    = subtaskCount > 0 || commentCount > 0 || !!task.dueDate;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        // Use dnd-kit's transition only while sorting (animates snap-back); otherwise
        // targeted CSS transitions so they don't fight the drag transform.
        transition: isSorting ? transition : "background-color 0.15s, border-color 0.15s",
        opacity: isSorting ? 0 : 1,
        // Priority colour on the start edge of the card (priority colours are data).
        borderLeft: `3px solid ${p.dot}`,
      }}
      {...attributes}
      {...listeners}
      onClick={() => !isSorting && onOpen(task)}
      className={cn(
        "kanban-card group relative rounded-lg border p-3.5 cursor-grab active:cursor-grabbing select-none",
        isDragging
          ? "bg-raised border-primary"
          : "bg-raised/70 border-border hover:bg-raised hover:border-border-strong",
        isNew && "animate-in-up"
      )}
    >
      <p className="text-sm font-medium leading-snug mb-2.5 pl-3 text-foreground">
        {task.title}
      </p>

      {/* Priority badge + meta */}
      <div className={cn("pl-3", hasFooter && "flex items-center justify-between gap-2")}>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md"
                style={{ background: p.bg, border: `1px solid ${p.border}`, color: p.text }}>
            {p.label}
          </span>
          {task.abcde && abcdeColor && (
            // ABCDE_META colours are 6-digit hex, so an alpha suffix gives the tint.
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md font-mono"
                  title={`${ABCDE_META[task.abcde].label}: ${ABCDE_META[task.abcde].description}`}
                  style={{ background: `${abcdeColor}1A`, border: `1px solid ${abcdeColor}40`, color: `color-mix(in srgb, ${abcdeColor} 75%, white)` }}>
              {formatAbcde(task)}
            </span>
          )}
        </div>

        {hasFooter && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular">
            {subtaskCount > 0 && (
              <span className="flex items-center gap-0.5" aria-label={`${subtaskCount} subtasks`}>
                <CheckSquare className="w-3 h-3" aria-hidden="true" /> {subtaskCount}
              </span>
            )}
            {commentCount > 0 && (
              <span className="flex items-center gap-0.5" aria-label={`${commentCount} comments`}>
                <MessageSquare className="w-3 h-3" aria-hidden="true" /> {commentCount}
              </span>
            )}
            {task.dueDate && (() => {
              const [dp, tp] = task.dueDate.split("T");
              const [yr, mo, dy] = dp.split("-").map(Number);
              const [hr, mn] = tp ? tp.split(":").map(Number) : [0, 0];
              const due = new Date(yr, mo - 1, dy, hr, mn, 0, 0);
              const now = new Date();
              const todayStart = new Date(); todayStart.setHours(0,0,0,0);
              const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);
              const isOverdue  = due < now;
              const isToday    = due >= todayStart && due <= todayEnd;
              const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0;
              const label = isToday
                ? (hasTime ? format(due, "h:mm a") : null)
                : (hasTime ? format(due, "MMM d, h:mm a") : format(due, "MMM d"));
              const tone = isOverdue ? "text-danger" : isToday ? "text-foreground" : "text-muted-foreground";
              const status = isOverdue ? "Overdue" : isToday ? "Due today" : "Due";
              return (
                <span className={cn("flex items-center gap-0.5", tone)} title={status}>
                  <Calendar className="w-3 h-3" aria-hidden="true" />
                  <span className="sr-only">{status}</span>
                  {label}
                </span>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
