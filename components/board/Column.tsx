"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Status, Task } from "@/types";
import TaskCard from "./TaskCard";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  status: Status;
  tasks: Task[];
  onCreateTask: (statusId: string, title: string) => void;
  onOpenTask: (task: Task) => void;
}

export default function Column({ status, tasks, onCreateTask, onOpenTask }: Props) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateTask(status.id, title.trim());
    setTitle("");
    setAdding(false);
  }

  return (
    <div className="w-72 flex-shrink-0 flex flex-col">
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground tracking-wide">{status.name}</span>
          <span className="text-[11px] font-medium text-muted-foreground bg-secondary/80 px-2 py-0.5 rounded-full tabular-nums">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-accent hover:bg-accent/10 active:bg-accent/20 transition-all duration-150"
          title="Add task"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 rounded-xl p-2 space-y-2 min-h-[120px] transition-all duration-200",
          isOver
            ? "bg-accent/8 border border-accent/30 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.15)]"
            : "bg-card/60 border border-border/60"
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </SortableContext>

        {adding && (
          <form onSubmit={handleCreate} className="mt-1">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (!title.trim()) setAdding(false); }}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
              placeholder="Task title…"
              className="w-full px-3 py-2 rounded-lg bg-background border border-accent/60 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-accent/40 shadow-[0_0_0_3px_rgba(249,115,22,0.08)]"
            />
          </form>
        )}

        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary/40 transition-all duration-150 group"
          >
            <Plus className="w-3.5 h-3.5 group-hover:text-accent transition-colors" />
            Add task
          </button>
        )}
      </div>
    </div>
  );
}
