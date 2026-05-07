"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Task, Priority } from "@/types";
import { MessageSquare, CheckSquare, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const priorityConfig: Record<Priority, { label: string; dot: string; badge: string }> = {
  URGENT: { label: "Urgent", dot: "#F87171", badge: "text-red-400 bg-red-400/8 border-red-400/15" },
  HIGH:   { label: "High",   dot: "#F97316", badge: "text-orange-400 bg-orange-400/8 border-orange-400/15" },
  MEDIUM: { label: "Medium", dot: "#FBBF24", badge: "text-yellow-400 bg-yellow-400/8 border-yellow-400/15" },
  LOW:    { label: "Low",    dot: "#4ADE80", badge: "text-green-400 bg-green-400/8 border-green-400/15" },
};

interface Props {
  task: Task;
  onOpen: (task: Task) => void;
  isDragging?: boolean;
}

export default function TaskCard({ task, onOpen, isDragging }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortDragging ? 0 : 1,
  };

  const p = priorityConfig[task.priority];
  const subtaskCount  = task._count?.subtasks ?? task.subtasks?.length ?? 0;
  const commentCount  = task._count?.comments ?? task.comments?.length ?? 0;
  const hasFooter     = subtaskCount > 0 || commentCount > 0 || !!task.dueDate;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => !isSortDragging && onOpen(task)}
      className={cn(
        "group relative bg-[#1A1714] border border-[#2C2820] rounded-xl p-3.5 cursor-pointer select-none",
        "hover:border-[#3C3828] hover:bg-[#1E1B17]",
        "hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
        "active:scale-[0.99] transition-all duration-150",
        isDragging && [
          "!opacity-100 !bg-[#221F1A] !border-orange-500/30",
          "shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_0_1px_rgba(249,115,22,0.15)]",
          "rotate-1 scale-[1.03]",
        ]
      )}
    >
      {/* Priority accent line */}
      <span
        className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full opacity-60"
        style={{ background: p.dot }}
      />

      {/* Title */}
      <p className="text-sm text-[#EDE0D0] font-medium leading-snug pl-3 mb-2.5 group-hover:text-white transition-colors">
        {task.title}
      </p>

      {/* Footer row */}
      {hasFooter && (
        <div className="flex items-center justify-between pl-3 gap-2">
          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", p.badge)}>
            {p.label}
          </span>

          <div className="flex items-center gap-2 text-[#4A3F35] group-hover:text-[#7A6A5A] transition-colors">
            {subtaskCount > 0 && (
              <span className="flex items-center gap-0.5 text-[10px]">
                <CheckSquare className="w-3 h-3" /> {subtaskCount}
              </span>
            )}
            {commentCount > 0 && (
              <span className="flex items-center gap-0.5 text-[10px]">
                <MessageSquare className="w-3 h-3" /> {commentCount}
              </span>
            )}
            {task.dueDate && (
              <span className="flex items-center gap-0.5 text-[10px]">
                <Calendar className="w-3 h-3" />
                {format(new Date(task.dueDate), "MMM d")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* No footer: just the priority badge */}
      {!hasFooter && (
        <div className="pl-3">
          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", p.badge)}>
            {p.label}
          </span>
        </div>
      )}
    </div>
  );
}
