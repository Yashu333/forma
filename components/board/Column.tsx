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
          <span className="text-xs font-semibold text-[#B8A898] tracking-wide uppercase">
            {status.name}
          </span>
          <span className="text-[10px] font-semibold text-[#4A3F35] tabular-nums bg-[#1A1714] border border-[#2C2820] px-1.5 py-0.5 rounded-full">
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
            ? "bg-orange-500/5 ring-1 ring-orange-500/20"
            : "bg-[#111009]"
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
              className="w-full px-3 py-2 rounded-lg bg-[#1A1714] border border-orange-500/35 text-sm text-[#EDE0D0] placeholder:text-[#4A3F35] focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all"
            />
          </form>
        ) : (
          /* Ghost add button — always visible at bottom */
          <button
            onClick={startAdding}
            className="flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-[#4A3F35] hover:text-[#7A6A5A] hover:bg-[#1A1714] transition-all duration-150 group w-full"
          >
            <Plus className="w-3.5 h-3.5 group-hover:text-orange-500/50 transition-colors flex-shrink-0" />
            <span>Add task</span>
          </button>
        )}
      </div>
    </div>
  );
}
