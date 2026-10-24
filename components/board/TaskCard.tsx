"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Task, Priority } from "@/types";
import { MessageSquare, CheckSquare, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ABCDE_META, formatAbcde } from "@/lib/frog/abcde";

const PRIORITY: Record<Priority, { label: string; bar: string; bg: string; border: string; text: string }> = {
  URGENT: { label: "Urgent", bar: "#9B59B6", bg: "rgba(155,89,182,0.10)", border: "rgba(155,89,182,0.25)", text: "#C39BD3" },
  HIGH:   { label: "High",   bar: "#C0531A", bg: "rgba(192,83,26,0.10)",  border: "rgba(192,83,26,0.25)",  text: "#E07840" },
  MEDIUM: { label: "Medium", bar: "#4A8FA8", bg: "rgba(74,143,168,0.10)", border: "rgba(74,143,168,0.25)", text: "#7EB8CC" },
  LOW:    { label: "Low",    bar: "#475569", bg: "rgba(71,85,105,0.10)",   border: "rgba(71,85,105,0.25)",   text: "#94A3B8" },
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
        // Use dnd-kit's transition only while sorting (animates snap-back); for hover
        // effects use targeted CSS transitions so they don't fight the drag transform.
        transition: isSorting
          ? transition
          : "background 0.15s, border-color 0.15s, box-shadow 0.15s",
        opacity: isSorting ? 0 : 1,
        background: isDragging ? "var(--elevated)" : "var(--card)",
        borderTop:    isDragging ? "1px solid var(--border-accent)" : "1px solid var(--border-strong)",
        borderRight:  isDragging ? "1px solid var(--border-accent)" : "1px solid var(--border-strong)",
        borderBottom: isDragging ? "1px solid var(--border-accent)" : "1px solid var(--border-strong)",
        borderLeft: `4px solid ${p.bar}`,
        boxShadow: isDragging ? "0 20px 60px rgba(0,0,0,0.5)" : undefined,
      }}
      {...attributes}
      {...listeners}
      onClick={() => !isSorting && onOpen(task)}
      className={cn(
        "kanban-card group relative rounded-lg p-3.5 cursor-grab active:cursor-grabbing select-none",
        isDragging && "rotate-1 scale-[1.03]",
        isNew && "animate-in-up"
      )}
      onMouseEnter={e => {
        if (!isDragging) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = "var(--hover)";
          el.style.borderTopColor = "var(--border-accent)";
          el.style.borderRightColor = "var(--border-accent)";
          el.style.borderBottomColor = "var(--border-accent)";
          el.style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
        }
      }}
      onMouseLeave={e => {
        if (!isDragging) {
          const el = e.currentTarget as HTMLElement;
          el.style.background = "var(--card)";
          el.style.borderTopColor = "var(--border-strong)";
          el.style.borderRightColor = "var(--border-strong)";
          el.style.borderBottomColor = "var(--border-strong)";
          el.style.boxShadow = "";
        }
      }}
    >


      {/* Title */}
      <p className="text-sm font-medium leading-snug pl-4 mb-2.5 transition-colors"
         style={{ color: "var(--text-primary)" }}>
        {task.title}
      </p>

      {/* Priority badge + meta */}
      <div className={cn("pl-4", hasFooter && "flex items-center justify-between gap-2")}>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                style={{ background: p.bg, border: `1px solid ${p.border}`, color: p.text }}>
            {p.label}
          </span>
          {task.abcde && abcdeColor && (
            // ABCDE_META colours are 6-digit hex, so an alpha suffix gives the tint.
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
                  title={`${ABCDE_META[task.abcde].label}: ${ABCDE_META[task.abcde].description}`}
                  style={{ background: `${abcdeColor}1A`, border: `1px solid ${abcdeColor}40`, color: abcdeColor }}>
              {formatAbcde(task)}
            </span>
          )}
        </div>

        {hasFooter && (
          <div className="flex items-center gap-2 text-[11px] transition-colors"
               style={{ color: "var(--text-secondary)" }}>
            {subtaskCount > 0 && (
              <span className="flex items-center gap-0.5">
                <CheckSquare className="w-3 h-3" /> {subtaskCount}
              </span>
            )}
            {commentCount > 0 && (
              <span className="flex items-center gap-0.5">
                <MessageSquare className="w-3 h-3" /> {commentCount}
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
              const color = isOverdue ? "#F87171" : isToday ? "#EAB308" : "#34D399";
              const hasTime = due.getHours() !== 0 || due.getMinutes() !== 0;
              const label = isToday
                ? (hasTime ? format(due, "h:mm a") : null)
                : (hasTime ? format(due, "MMM d, h:mm a") : format(due, "MMM d"));
              return label ? (
                <span className="flex items-center gap-0.5" style={{ color }}>
                  <Calendar className="w-3 h-3" />
                  {label}
                </span>
              ) : (
                <Calendar className="w-3 h-3" style={{ color }} />
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
