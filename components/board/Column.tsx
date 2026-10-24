"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Status, Task } from "@/types";
import { Priority } from "@/types";
import TaskCard from "./TaskCard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { PartyPopper, Plus, Trash2 } from "lucide-react";

interface Props {
  status: Status;
  tasks: Task[];
  onCreateTask: (statusId: string, title: string, priority: Priority) => void;
  onOpenTask: (task: Task) => void;
  onDeleteStatus: (statusId: string) => void;
  onToggleCelebrate: (statusId: string, celebrate: boolean) => void;
  glowing?: boolean;
}

// Priority and status colours are data: they stay as-is so columns and tasks remain easy to tell apart.
const PRIORITY_DOTS: { value: Priority; color: string; label: string }[] = [
  { value: "URGENT", color: "#A867C0", label: "Urgent" },
  { value: "HIGH",   color: "#DC4E55", label: "High"   },
  { value: "MEDIUM", color: "#4A8FA8", label: "Medium" },
  { value: "LOW",    color: "#74869F", label: "Low"    },
];

// Status colour shows on the header dot only; the title and count stay neutral.
const COLUMN_DOTS: Record<string, string> = {
  "to do":       "#B8AFA7",
  "todo":        "#B8AFA7",
  "in progress": "#EAB308",
  "doing":       "#EAB308",
  "done":        "#34D399",
  "review":      "#C084FC",
};
// Custom columns get the warm neutral instead of a cool grey.
const FALLBACK_DOT = "#B8AFA7";

export default function Column({ status, tasks, onCreateTask, onOpenTask, onDeleteStatus, onToggleCelebrate, glowing = false }: Props) {
  const [adding, setAdding]         = useState(false);
  const [title, setTitle]           = useState("");
  const [priority, setPriority]     = useState<Priority>("MEDIUM");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { setNodeRef, isOver }      = useDroppable({ id: status.id });

  const dot = COLUMN_DOTS[status.name.toLowerCase()] ?? FALLBACK_DOT;

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateTask(status.id, title.trim(), priority);
    setTitle(""); setPriority("MEDIUM"); setAdding(false);
  }

  return (
    <div className="w-[280px] md:w-72 flex-shrink-0 flex flex-col">

      {confirmDelete && (
        <ConfirmDialog
          title="Delete column?"
          message={`"${status.name}" and all ${tasks.length} task${tasks.length === 1 ? "" : "s"} inside will be permanently deleted.`}
          confirmLabel="Delete column"
          onConfirm={() => { setConfirmDelete(false); onDeleteStatus(status.id); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {/* Column header — sticky so it stays visible while the board scrolls */}
      <div className="flex items-center justify-between px-1 py-3 sticky top-0 z-10 group/col bg-background">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} aria-hidden="true" />
          <span className="text-[13px] font-semibold truncate text-foreground">
            {status.name}
          </span>
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md font-mono tabular-nums bg-raised text-muted-foreground"
                aria-label={`${tasks.length} tasks`}>
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* col-action: hidden on desktop until column hover or focus, always visible on touch */}
          <button
            className={`btn-icon col-action w-7 h-7 md:w-6 md:h-6 ${status.celebrate ? "!text-foreground" : ""}`}
            title={status.celebrate ? "Disable celebration" : "Celebrate when tasks land here"}
            aria-label={status.celebrate ? "Disable celebration" : "Celebrate when tasks land here"}
            aria-pressed={status.celebrate}
            onClick={() => onToggleCelebrate(status.id, !status.celebrate)}
          >
            <PartyPopper className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            className="btn-icon col-action w-7 h-7 md:w-6 md:h-6 hover:!text-danger"
            title="Delete column"
            aria-label="Delete column"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button className="btn-icon w-7 h-7 md:w-6 md:h-6" aria-label="Add task" title="Add task"
                  onClick={() => { setAdding(true); setTitle(""); }}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 rounded-lg p-2 min-h-[120px] transition-colors duration-200 border ${
          isOver ? "bg-primary-soft border-primary" : "bg-surface border-transparent"
        }`}
        style={glowing ? { background: `${dot}14`, borderColor: `${dot}88` } : undefined}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => <TaskCard key={task.id} task={task} onOpen={onOpenTask} isNew={task.id.startsWith("temp-")} />)}
        </SortableContext>

        {adding ? (
          <form
            onSubmit={handleCreate}
            className="animate-in-up flex flex-col gap-2 mt-1"
          >
            <input
              autoFocus value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === "Escape" && (setAdding(false), setTitle(""))}
              placeholder="Task title…"
              aria-label="Task title"
              className="forma-input !py-2.5 !text-sm"
            />
            <div className="flex items-center gap-1 px-1 flex-wrap" role="group" aria-label="Priority">
              {PRIORITY_DOTS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  title={p.label}
                  aria-pressed={priority === p.value}
                  onClick={() => setPriority(p.value)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${priority === p.value ? "" : "text-subtle hover:bg-raised"}`}
                  style={priority === p.value ? {
                    background: `${p.color}22`,
                    border: `1px solid ${p.color}`,
                    color: "var(--foreground)",
                  } : { border: "1px solid transparent" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} aria-hidden="true" />
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setAdding(false); setTitle(""); }}
                className="flex-1 h-8 rounded-md text-xs font-semibold border border-border bg-raised text-foreground transition-colors hover:bg-border"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim()}
                className="btn-primary flex-1 h-8 !text-xs"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
                Create
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => { setAdding(true); setTitle(""); }}
            className="w-full flex items-center gap-2 px-3 py-3 rounded-md text-sm text-subtle transition-colors hover:bg-raised hover:text-muted-foreground"
          >
            <Plus className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
            Add task
          </button>
        )}
      </div>
    </div>
  );
}
