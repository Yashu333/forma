"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Status, Task } from "@/types";
import { Priority } from "@/types";
import TaskCard from "./TaskCard";
import { Plus } from "lucide-react";

interface Props {
  status: Status;
  tasks: Task[];
  onCreateTask: (statusId: string, title: string, priority: Priority) => void;
  onOpenTask: (task: Task) => void;
}

const PRIORITY_DOTS: { value: Priority; color: string; label: string }[] = [
  { value: "URGENT", color: "#9B59B6", label: "Urgent" },
  { value: "HIGH",   color: "#C0531A", label: "High"   },
  { value: "MEDIUM", color: "#4A8FA8", label: "Medium" },
  { value: "LOW",    color: "#475569", label: "Low"    },
];

const COLUMN_COLORS: Record<string, { text: string; dot: string; count: string; countBorder: string }> = {
  "to do":       { text: "#FF5555", dot: "#FF5555", count: "rgba(255,85,85,0.18)", countBorder: "rgba(255,85,85,0.40)" },
  "todo":        { text: "#FF5555", dot: "#FF5555", count: "rgba(255,85,85,0.18)", countBorder: "rgba(255,85,85,0.40)" },
  "in progress": { text: "#EAB308", dot: "#EAB308", count: "rgba(234,179,8,0.15)",   countBorder: "rgba(234,179,8,0.30)"   },
  "doing":       { text: "#EAB308", dot: "#EAB308", count: "rgba(234,179,8,0.15)",   countBorder: "rgba(234,179,8,0.30)"   },
  "done":        { text: "#34D399", dot: "#34D399", count: "rgba(52,211,153,0.15)",  countBorder: "rgba(52,211,153,0.30)"  },
  "review":      { text: "#C084FC", dot: "#C084FC", count: "rgba(192,132,252,0.15)", countBorder: "rgba(192,132,252,0.30)" },
};
const FALLBACK_COLOR = { text: "#94A3B8", dot: "#94A3B8", count: "rgba(148,163,184,0.12)", countBorder: "rgba(148,163,184,0.28)" };

export default function Column({ status, tasks, onCreateTask, onOpenTask }: Props) {
  const [adding, setAdding]     = useState(false);
  const [title, setTitle]       = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const { setNodeRef, isOver }  = useDroppable({ id: status.id });

  const col = COLUMN_COLORS[status.name.toLowerCase()] ?? FALLBACK_COLOR;

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateTask(status.id, title.trim(), priority);
    setTitle(""); setPriority("MEDIUM"); setAdding(false);
  }

  return (
    <div className="w-72 flex-shrink-0 flex flex-col">

      {/* Column header — sticky so it stays visible while the board scrolls */}
      <div className="flex items-center justify-between px-1 py-3 sticky top-0 z-10"
           style={{ background: "var(--bg)" }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: col.dot }} />
          <span className="text-xs font-bold tracking-widest uppercase"
                style={{ color: col.text }}>
            {status.name}
          </span>
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums"
                style={{ background: col.count, border: `1px solid ${col.countBorder}`, color: col.text }}>
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
          <form onSubmit={handleCreate} className="animate-in-up flex flex-col gap-2">
            <input
              autoFocus value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={e => { if (!title.trim() && !e.relatedTarget) setAdding(false); }}
              onKeyDown={e => e.key === "Escape" && setAdding(false)}
              placeholder="Task title…"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ background: "var(--elevated)", border: "1px solid var(--border-accent)", color: "var(--text-primary)" }}
            />
            <div className="flex items-center gap-1.5 px-1">
              {PRIORITY_DOTS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  title={p.label}
                  onClick={() => setPriority(p.value)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-all duration-100"
                  style={{
                    background: priority === p.value ? `${p.color}22` : "transparent",
                    border: `1px solid ${priority === p.value ? p.color : "transparent"}`,
                    color: priority === p.value ? p.color : "var(--text-disabled)",
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={!title.trim()}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-100"
              style={{
                background: title.trim() ? "var(--accent)" : "var(--elevated)",
                color: title.trim() ? "#fff" : "var(--text-disabled)",
                border: `1px solid ${title.trim() ? "var(--accent-border)" : "var(--border)"}`,
                cursor: title.trim() ? "pointer" : "default",
              }}
            >
              <Plus className="w-3 h-3" />
              Create
            </button>
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
