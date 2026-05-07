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
  const [title, setTitle]   = useState("");

  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateTask(status.id, title.trim());
    setTitle("");
    setAdding(false);
  }

  function startAdding() {
    setAdding(true);
    setTitle("");
  }

  return (
    <div className="w-64 flex-shrink-0 flex flex-col gap-2.5">
      {/* Column header */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#A8ADCB] tracking-wide uppercase">
            {status.name}
          </span>
          <span className="text-[10px] font-semibold text-[#5C6180] tabular-nums bg-[#1C1E28] border border-[#2A2D3A] px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        <button
          onClick={startAdding}
          className="btn-icon w-6 h-6"
          title={`Add task to ${status.name}`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Drop zone + cards */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-2 rounded-xl p-2 min-h-[80px] transition-all duration-200",
          isOver
            ? "bg-violet-500/6 ring-1 ring-violet-500/25"
            : "bg-[#13151C]"
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </SortableContext>

        {/* Inline add form */}
        {adding ? (
          <form onSubmit={handleCreate} className="animate-in-up">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (!title.trim()) setAdding(false); }}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
              placeholder="Task title…"
              className="w-full px-3 py-2 rounded-lg bg-[#1C1E28] border border-violet-500/40 text-sm text-[#F0F2FF] placeholder:text-[#3A3D52] focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
            />
          </form>
        ) : (
          <button
            onClick={startAdding}
            className="flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-[#3A3D52] hover:text-[#A8ADCB] hover:bg-[#1C1E28] transition-all duration-150 group w-full"
          >
            <Plus className="w-3.5 h-3.5 group-hover:text-violet-400 transition-colors flex-shrink-0" />
            <span>Add task</span>
          </button>
        )}
      </div>
    </div>
  );
}
