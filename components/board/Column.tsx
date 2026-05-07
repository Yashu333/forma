"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Status, Task } from "@/types";
import TaskCard from "./TaskCard";
import { Plus } from "lucide-react";

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

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateTask(status.id, title.trim());
    setTitle(""); setAdding(false);
  }

  return (
    <div className="w-80 flex-shrink-0 flex flex-col gap-2.5">

      {/* Column header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-widest uppercase"
                style={{ color: "var(--text-secondary)" }}>
            {status.name}
          </span>
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums"
                style={{ background: "var(--card)", border: "1px solid var(--border-strong)", color: "var(--text-muted)" }}>
            {tasks.length}
          </span>
        </div>
        <button className="btn-icon w-6 h-6" onClick={() => { setAdding(true); setTitle(""); }}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className="flex flex-col gap-2 rounded-xl p-2 min-h-[120px] transition-all duration-200"
        style={{
          background: isOver ? "rgba(124,110,248,0.07)" : "var(--surface)",
          border: isOver ? "1px solid var(--border-accent)" : "1px solid var(--border)",
        }}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => <TaskCard key={task.id} task={task} onOpen={onOpenTask} />)}
        </SortableContext>

        {adding ? (
          <form onSubmit={handleCreate} className="animate-in-up">
            <input
              autoFocus value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => { if (!title.trim()) setAdding(false); }}
              onKeyDown={e => e.key === "Escape" && setAdding(false)}
              placeholder="Task title…"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ background: "var(--elevated)", border: "1px solid var(--border-accent)", color: "var(--text-primary)" }}
            />
          </form>
        ) : (
          <button
            onClick={() => { setAdding(true); setTitle(""); }}
            className="w-full flex items-center gap-2 px-3 py-3 rounded-lg text-sm transition-all duration-150 group"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
          >
            <Plus className="w-3.5 h-3.5 flex-shrink-0" />
            Add task
          </button>
        )}
      </div>
    </div>
  );
}
