"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Task, Priority } from "@/types";
import { MessageSquare, CheckSquare, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const PRIORITY: Record<Priority, { label: string; bar: string; bg: string; border: string; text: string }> = {
  URGENT: { label: "Urgent", bar: "#F87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.30)", text: "#FCA5A5" },
  HIGH:   { label: "High",   bar: "#F97316", bg: "rgba(249,115,22,0.12)",  border: "rgba(249,115,22,0.30)",  text: "#FDB877" },
  MEDIUM: { label: "Medium", bar: "#7C6EF8", bg: "rgba(124,110,248,0.12)", border: "rgba(124,110,248,0.30)", text: "#B8B0F8" },
  LOW:    { label: "Low",    bar: "#34D399", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.30)",  text: "#6EE7B7" },
};

interface Props { task: Task; onOpen: (task: Task) => void; isDragging?: boolean; }

export default function TaskCard({ task, onOpen, isDragging }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSorting } =
    useSortable({ id: task.id });

  const p = PRIORITY[task.priority];
  const subtaskCount = task._count?.subtasks ?? task.subtasks?.length ?? 0;
  const commentCount = task._count?.comments ?? task.comments?.length ?? 0;
  const hasFooter    = subtaskCount > 0 || commentCount > 0 || !!task.dueDate;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isSorting ? 0 : 1,
        background: isDragging ? "var(--elevated)" : "var(--card)",
        border: isDragging ? "1px solid var(--border-accent)" : "1px solid var(--border-strong)",
        boxShadow: isDragging ? "0 20px 60px rgba(0,0,0,0.5)" : undefined,
      }}
      {...attributes}
      {...listeners}
      onClick={() => !isSorting && onOpen(task)}
      className={cn(
        "group relative rounded-lg p-3.5 cursor-pointer select-none transition-all duration-150 active:scale-[0.99]",
        isDragging && "rotate-1 scale-[1.03]"
      )}
      onMouseEnter={e => {
        if (!isDragging) {
          (e.currentTarget as HTMLElement).style.background = "var(--hover)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
        }
      }}
      onMouseLeave={e => {
        if (!isDragging) {
          (e.currentTarget as HTMLElement).style.background = "var(--card)";
          (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)";
          (e.currentTarget as HTMLElement).style.boxShadow = "";
        }
      }}
    >
      {/* Priority accent bar — full height */}
      <span className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ background: p.bar, borderRadius: "4px 0 0 4px", opacity: 0.9 }} />

      {/* Title */}
      <p className="text-sm font-medium leading-snug pl-4 mb-2.5 transition-colors"
         style={{ color: "var(--text-primary)" }}>
        {task.title}
      </p>

      {/* Priority badge + meta */}
      <div className={cn("pl-4", hasFooter && "flex items-center justify-between gap-2")}>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
              style={{ background: p.bg, border: `1px solid ${p.border}`, color: p.text }}>
          {p.label}
        </span>

        {hasFooter && (
          <div className="flex items-center gap-2 text-[11px] transition-colors"
               style={{ color: "var(--text-disabled)" }}>
            {subtaskCount > 0 && (
              <span className="flex items-center gap-0.5 group-hover:text-[--text-muted]">
                <CheckSquare className="w-3 h-3" /> {subtaskCount}
              </span>
            )}
            {commentCount > 0 && (
              <span className="flex items-center gap-0.5">
                <MessageSquare className="w-3 h-3" /> {commentCount}
              </span>
            )}
            {task.dueDate && (
              <span className="flex items-center gap-0.5">
                <Calendar className="w-3 h-3" />
                {format(new Date(task.dueDate), "MMM d")}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
