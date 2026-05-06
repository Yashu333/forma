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
          <span className="text-sm font-medium text-foreground">{status.name}</span>
          <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-md">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="text-muted-foreground hover:text-accent transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 rounded-xl p-2 space-y-2 min-h-[120px] transition-colors",
          isOver ? "bg-accent/5 border border-accent/20" : "bg-card/40 border border-transparent"
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
              placeholder="Task title"
              className="w-full px-3 py-2 rounded-lg bg-background border border-accent/50 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </form>
        )}

        {tasks.length === 0 && !adding && (
          <div className="text-center py-6">
            <p className="text-xs text-muted-foreground/50">No tasks</p>
          </div>
        )}
      </div>
    </div>
  );
}
