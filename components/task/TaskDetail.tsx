"use client";

import { useState } from "react";
import { Task, Status, Comment, Priority } from "@/types";
import { X, Trash2, Calendar, ChevronDown, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const PRIORITY_OPTIONS: { value: Priority; label: string; bar: string; color: string }[] = [
  { value: "URGENT", label: "Urgent", bar: "#F87171", color: "#FCA5A5" },
  { value: "HIGH",   label: "High",   bar: "#F97316", color: "#FDB877" },
  { value: "MEDIUM", label: "Medium", bar: "#7C6EF8", color: "#B8B0F8" },
  { value: "LOW",    label: "Low",    bar: "#34D399", color: "#6EE7B7" },
];

interface Props {
  task: Task; statuses: Status[]; userId: string;
  onClose: () => void; onUpdated: (t: Task) => void; onDeleted: (id: string) => void;
}

export default function TaskDetail({ task, statuses, userId, onClose, onUpdated, onDeleted }: Props) {
  const [title, setTitle]           = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority]     = useState<Priority>(task.priority);
  const [statusId, setStatusId]     = useState(task.statusId);
  const [dueDate, setDueDate]       = useState(task.dueDate ? task.dueDate.split("T")[0] : "");
  const [saving, setSaving]         = useState(false);
  const [newSubtask, setNewSubtask] = useState("");
  const [subtasks, setSubtasks]     = useState(task.subtasks ?? []);
  const [comments, setComments]     = useState<Comment[]>(task.comments ?? []);
  const [newComment, setNewComment] = useState("");
  const [showPriority, setShowPriority] = useState(false);
  const [showStatus, setShowStatus]     = useState(false);

  const isDirty = title !== task.title || description !== (task.description ?? "") ||
    priority !== task.priority || statusId !== task.statusId ||
    dueDate !== (task.dueDate ? task.dueDate.split("T")[0] : "");

  const currentPriority = PRIORITY_OPTIONS.find(p => p.value === priority)!;
  const currentStatus   = statuses.find(s => s.id === statusId);
  const doneStatus      = statuses.find(s => s.name.toLowerCase() === "done");
  const doneCount       = subtasks.filter(s => doneStatus && s.statusId === doneStatus.id).length;

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || null, priority, statusId, dueDate: dueDate || null }),
    });
    if (res.ok) { const updated: Task = await res.json(); onUpdated({ ...updated, subtasks, comments }); }
    setSaving(false);
  }

  async function deleteTask() {
    if (!confirm("Delete this task?")) return;
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    onDeleted(task.id);
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubtask.trim()) return;
    const res = await fetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newSubtask.trim(), groupId: task.groupId, statusId: task.statusId, parentTaskId: task.id, order: subtasks.length }),
    });
    if (res.ok) { const sub: Task = await res.json(); setSubtasks(p => [...p, sub]); setNewSubtask(""); }
  }

  async function toggleSubtask(sub: Task) {
    const toDoStatus   = statuses.find(s => s.name.toLowerCase() === "to do") ?? statuses[0];
    const isDone       = doneStatus && sub.statusId === doneStatus.id;
    const nextStatusId = isDone ? toDoStatus.id : (doneStatus?.id ?? sub.statusId);
    const res = await fetch(`/api/tasks/${sub.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusId: nextStatusId }),
    });
    if (res.ok) { const u: Task = await res.json(); setSubtasks(p => p.map(s => s.id === sub.id ? u : s)); }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    const res = await fetch(`/api/tasks/${task.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newComment.trim() }),
    });
    if (res.ok) { const comment: Comment = await res.json(); setComments(p => [...p, comment]); setNewComment(""); }
  }

  async function deleteComment(id: string) {
    await fetch(`/api/comments/${id}`, { method: "DELETE" });
    setComments(p => p.filter(c => c.id !== id));
  }

  const inputStyle = {
    background: "var(--elevated)",
    border: "1px solid var(--border-strong)",
    color: "var(--text-primary)",
    borderRadius: "0.5rem",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    outline: "none",
    width: "100%",
    transition: "border-color 0.15s",
  } as React.CSSProperties;

  const pillStyle = {
    display: "flex", alignItems: "center", gap: "0.375rem",
    height: "1.75rem", padding: "0 0.625rem", borderRadius: "0.5rem",
    background: "var(--card)", border: "1px solid var(--border-strong)",
    fontSize: "0.75rem", color: "var(--text-secondary)",
    cursor: "pointer", transition: "all 0.15s",
  } as React.CSSProperties;

  return (
    <div className="panel-overlay animate-fade-in">
      <div className="panel-backdrop" onClick={onClose} />

      <div className="w-[500px] flex flex-col h-full overflow-hidden animate-in-right"
           style={{ background: "var(--surface)", borderLeft: "1px solid var(--border-strong)", boxShadow: "-20px 0 60px rgba(0,0,0,0.4)" }}>

        {/* Toolbar */}
        <div className="h-14 px-4 flex items-center justify-between flex-shrink-0"
             style={{ borderBottom: "1px solid var(--border-strong)" }}>
          <div>{isDirty && (
            <button onClick={save} disabled={saving} className="btn-primary h-7 px-3 text-xs">
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}</div>
          <div className="flex items-center gap-1">
            <button onClick={deleteTask} className="btn-icon" style={{ color: "var(--text-muted)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#F87171"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"}>
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="btn-icon"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Title + meta */}
          <div className="px-5 pt-6 pb-4" style={{ borderBottom: "1px solid var(--border-strong)" }}>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full text-xl font-semibold bg-transparent border-none outline-none leading-tight"
              style={{ color: "var(--text-primary)" }} placeholder="Task title" />

            <div className="flex flex-wrap gap-2 mt-4">
              {/* Status pill */}
              <div className="relative">
                <button style={pillStyle}
                  onClick={() => { setShowStatus(v => !v); setShowPriority(false); }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                  {currentStatus?.name ?? "Status"}
                  <ChevronDown className="w-3 h-3 ml-0.5" style={{ color: "var(--text-disabled)" }} />
                </button>
                {showStatus && (
                  <div className="dropdown-menu absolute top-full mt-1 left-0 min-w-[160px] animate-in-up">
                    {statuses.map(s => (
                      <button key={s.id} onClick={() => { setStatusId(s.id); setShowStatus(false); }} className="dropdown-item first:pt-2 last:pb-2">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--accent)" }} />
                        {s.name}
                        {s.id === statusId && <Check className="w-3 h-3 ml-auto" style={{ color: "var(--accent)" }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Priority pill */}
              <div className="relative">
                <button style={pillStyle}
                  onClick={() => { setShowPriority(v => !v); setShowStatus(false); }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: currentPriority.bar }} />
                  <span style={{ color: currentPriority.color }}>{currentPriority.label}</span>
                  <ChevronDown className="w-3 h-3 ml-0.5" style={{ color: "var(--text-disabled)" }} />
                </button>
                {showPriority && (
                  <div className="dropdown-menu absolute top-full mt-1 left-0 min-w-[140px] animate-in-up">
                    {PRIORITY_OPTIONS.map(p => (
                      <button key={p.value} onClick={() => { setPriority(p.value); setShowPriority(false); }} className="dropdown-item first:pt-2 last:pb-2">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.bar }} />
                        <span style={{ color: p.color }}>{p.label}</span>
                        {p.value === priority && <Check className="w-3 h-3 ml-auto" style={{ color: "var(--accent)" }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Due date */}
              <label style={pillStyle}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}>
                <Calendar className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
                {dueDate ? format(new Date(dueDate + "T00:00:00"), "MMM d, yyyy") : "Due date"}
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="sr-only" />
              </label>
            </div>
          </div>

          <div className="px-5 py-5 space-y-6">
            {/* Description */}
            <div>
              <p className="section-label mb-2">Description</p>
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Add notes, links, details…" rows={4}
                style={{ ...inputStyle, resize: "none" } as React.CSSProperties}
                onFocus={e => e.currentTarget.style.borderColor = "var(--border-accent)"}
                onBlur={e => e.currentTarget.style.borderColor = "var(--border-strong)"} />
            </div>

            {/* Subtasks */}
            <div>
              <p className="section-label mb-3">
                Subtasks
                {subtasks.length > 0 && <span className="ml-2 normal-case" style={{ color: "var(--text-muted)" }}>{doneCount}/{subtasks.length}</span>}
              </p>

              {subtasks.length > 0 && (
                <div className="h-1 rounded-full mb-3 overflow-hidden" style={{ background: "var(--card)" }}>
                  <div className="h-full rounded-full transition-all duration-500"
                       style={{ width: `${(doneCount / subtasks.length) * 100}%`, background: "var(--accent)" }} />
                </div>
              )}

              <div className="space-y-1.5 mb-3">
                {subtasks.map(sub => {
                  const isDone = doneStatus && sub.statusId === doneStatus.id;
                  return (
                    <div key={sub.id} className="flex items-center gap-2.5 py-0.5">
                      <button onClick={() => toggleSubtask(sub)}
                        className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all duration-150"
                        style={isDone
                          ? { background: "var(--accent)", border: "1px solid var(--accent)" }
                          : { background: "transparent", border: "1px solid var(--border-strong)" }}>
                        {isDone && <Check className="w-2.5 h-2.5 text-white" />}
                      </button>
                      <span className={cn("text-sm flex-1 transition-colors", isDone && "line-through")}
                            style={{ color: isDone ? "var(--text-disabled)" : "var(--text-secondary)" }}>
                        {sub.title}
                      </span>
                    </div>
                  );
                })}
              </div>

              <form onSubmit={addSubtask} className="flex gap-2">
                <input value={newSubtask} onChange={e => setNewSubtask(e.target.value)}
                  placeholder="Add subtask…" style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = "var(--border-accent)"}
                  onBlur={e => e.currentTarget.style.borderColor = "var(--border-strong)"} />
                <button type="submit" className="btn-ghost px-3"><Plus className="w-4 h-4" /></button>
              </form>
            </div>

            {/* Comments */}
            <div>
              <p className="section-label mb-3">
                Comments
                {comments.length > 0 && <span className="ml-2 normal-case" style={{ color: "var(--text-muted)" }}>{comments.length}</span>}
              </p>

              {comments.length > 0 && (
                <div className="space-y-4 mb-4">
                  {comments.map(c => (
                    <div key={c.id} className="flex gap-3 group">
                      <div className="w-7 h-7 rounded-lg text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
                           style={{ background: "var(--accent-subtle)", border: "1px solid var(--border-accent)", color: "var(--accent)" }}>
                        {c.authorId.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px]" style={{ color: "var(--text-disabled)" }}>
                            {format(new Date(c.createdAt), "MMM d, h:mm a")}
                          </span>
                          {c.authorId === userId && (
                            <button onClick={() => deleteComment(c.id)}
                              className="text-[11px] opacity-0 group-hover:opacity-100 transition-all ml-auto"
                              style={{ color: "var(--text-disabled)" }}
                              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#F87171"}
                              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-disabled)"}>
                              Delete
                            </button>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{c.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={addComment} className="flex gap-2">
                <input value={newComment} onChange={e => setNewComment(e.target.value)}
                  placeholder="Write a comment…" style={inputStyle}
                  onFocus={e => e.currentTarget.style.borderColor = "var(--border-accent)"}
                  onBlur={e => e.currentTarget.style.borderColor = "var(--border-strong)"} />
                <button type="submit" className="btn-primary px-3 py-2 text-xs">Post</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
