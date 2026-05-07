"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Task, Priority } from "@/types";
import { MessageSquare, CheckSquare, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const priorityConfig: Record<Priority, { label: string; class: string }> = {
  URGENT: { label: "Urgent", class: "text-red-400 bg-red-400/10 border-red-400/20" },
  HIGH:   { label: "High",   class: "text-orange-400 bg-orange-400/10 border-orange-400/20" },
  MEDIUM: { label: "Medium", class: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" },
  LOW:    { label: "Low",    class: "text-green-400 bg-green-400/10 border-green-400/20" },
};

interface Props {
  task: Task;
  onOpen: (task: Task) => void;
  isDragging?: boolean;
}

export default function TaskCard({ task, onOpen, isDragging }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortDragging ? 0.4 : 1,
  };

  const p = priorityConfig[task.priority];
  const subtaskCount = task._count?.subtasks ?? task.subtasks?.length ?? 0;
  const commentCount = task._count?.comments ?? task.comments?.length ?? 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => !isSortDragging && onOpen(task)}
      className={cn(
        "bg-card border border-border/80 rounded-xl p-3.5 cursor-pointer select-none",
        "hover:border-accent/30 hover:bg-card/90 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.4),0_0_0_1px_rgba(249,115,22,0.08)]",
        "transition-all duration-200",
        isDragging && "shadow-[0_16px_48px_-8px_rgba(0,0,0,0.6)] rotate-1 scale-105 border-accent/40"
      )}
    >
      <p className="text-sm text-foreground font-medium leading-snug mb-3">{task.title}</p>

      <div className="flex items-center justify-between">
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", p.class)}>
          {p.label}
        </span>

        <div className="flex items-center gap-2.5 text-muted-foreground/70">
          {subtaskCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] hover:text-muted-foreground transition-colors">
              <CheckSquare className="w-3 h-3" /> {subtaskCount}
            </span>
          )}
          {commentCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] hover:text-muted-foreground transition-colors">
              <MessageSquare className="w-3 h-3" /> {commentCount}
            </span>
          )}
          {task.dueDate && (
            <span className="flex items-center gap-1 text-[10px] hover:text-muted-foreground transition-colors">
              <Calendar className="w-3 h-3" />
              {format(new Date(task.dueDate), "MMM d")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
