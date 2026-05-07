"use client";

import { useState } from "react";
import { Task, Status, Comment, Priority } from "@/types";
import { X, Trash2, Calendar, Flag, ChevronDown, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const priorityOptions: { value: Priority; label: string; dot: string; class: string }[] = [
  { value: "URGENT", label: "Urgent", dot: "#F87171", class: "text-red-400" },
  { value: "HIGH",   label: "High",   dot: "#F97316", class: "text-orange-400" },
  { value: "MEDIUM", label: "Medium", dot: "#FBBF24", class: "text-yellow-400" },
  { value: "LOW",    label: "Low",    dot: "#4ADE80", class: "text-green-400" },
];

interface Props {
  task: Task;
  statuses: Status[];
  userId: string;
  onClose: () => void;
  onUpdated: (task: Task) => void;
  onDeleted: (id: string) => void;
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
  const [showStatus, setShowStatus]   = useState(false);

  const isDirty =
    title !== task.title ||
    description !== (task.description ?? "") ||
    priority !== task.priority ||
    statusId !== task.statusId ||
    dueDate !== (task.dueDate ? task.dueDate.split("T")[0] : "");

  const currentPriority = priorityOptions.find((p) => p.value === priority)!;
  const currentStatus   = statuses.find((s) => s.id === statusId);
  const doneStatus      = statuses.find((s) => s.name.toLowerCase() === "done");
  const doneCount       = subtasks.filter((s) => doneStatus && s.statusId === doneStatus.id).length;

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || null, priority, statusId, dueDate: dueDate || null }),
    });
    if (res.ok) {
      const updated: Task = await res.json();
      onUpdated({ ...updated, subtasks, comments });
    }
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newSubtask.trim(), groupId: task.groupId, statusId: task.statusId, parentTaskId: task.id, order: subtasks.length }),
    });
    if (res.ok) {
      const sub: Task = await res.json();
      setSubtasks((prev) => [...prev, sub]);
      setNewSubtask("");
    }
  }

  async function toggleSubtask(sub: Task) {
    const toDoStatus = statuses.find((s) => s.name.toLowerCase() === "to do") ?? statuses[0];
    const isDone     = doneStatus && sub.statusId === doneStatus.id;
    const nextStatusId = isDone ? toDoStatus.id : (doneStatus?.id ?? sub.statusId);
    const res = await fetch(`/api/tasks/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusId: nextStatusId }),
    });
    if (res.ok) {
      const updated: Task = await res.json();
      setSubtasks((prev) => prev.map((s) => (s.id === sub.id ? updated : s)));
    }
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    const res = await fetch(`/api/tasks/${task.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newComment.trim() }),
    });
    if (res.ok) {
      const comment: Comment = await res.json();
      setComments((prev) => [...prev, comment]);
      setNewComment("");
    }
  }

  async function deleteComment(id: string) {
    await fetch(`/api/comments/${id}`, { method: "DELETE" });
    setComments((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="panel-overlay animate-fade-in">
      {/* Backdrop */}
      <div className="panel-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="w-[500px] bg-[#111009] border-l border-[#1E1B16] flex flex-col h-full overflow-hidden shadow-[−20px_0_60px_rgba(0,0,0,0.5)] animate-in-right">

        {/* Toolbar */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#1E1B16] flex-shrink-0">
          <div className="flex items-center gap-2">
            {isDirty && (
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary h-7 px-3 text-xs"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={deleteTask}
              className="btn-icon text-[#4A3F35] hover:text-red-400 hover:bg-red-400/8"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="btn-icon">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Title section */}
          <div className="px-5 pt-6 pb-4 border-b border-[#1E1B16]">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-xl font-semibold bg-transparent border-none outline-none text-[#EDE0D0] placeholder:text-[#4A3F35] resize-none leading-tight"
              placeholder="Task title"
            />

            {/* Meta pills */}
            <div className="flex flex-wrap gap-2 mt-4">
              {/* Status */}
              <div className="relative">
                <button
                  onClick={() => { setShowStatus((v) => !v); setShowPriority(false); }}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[#1A1714] border border-[#2C2820] text-xs text-[#B8A898] hover:border-[#3C3828] hover:text-[#EDE0D0] transition-all duration-150"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                  {currentStatus?.name ?? "Status"}
                  <ChevronDown className="w-3 h-3 text-[#4A3F35]" />
                </button>
                {showStatus && (
                  <div className="dropdown-menu absolute top-full mt-1 left-0 min-w-[160px] animate-in-up">
                    {statuses.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { setStatusId(s.id); setShowStatus(false); }}
                        className="dropdown-item first:pt-2 last:pb-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400/60 flex-shrink-0" />
                        {s.name}
                        {s.id === statusId && <Check className="w-3 h-3 ml-auto text-orange-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Priority */}
              <div className="relative">
                <button
                  onClick={() => { setShowPriority((v) => !v); setShowStatus(false); }}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[#1A1714] border border-[#2C2820] text-xs text-[#B8A898] hover:border-[#3C3828] hover:text-[#EDE0D0] transition-all duration-150"
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: currentPriority.dot }} />
                  <span className={currentPriority.class}>{currentPriority.label}</span>
                  <ChevronDown className="w-3 h-3 text-[#4A3F35]" />
                </button>
                {showPriority && (
                  <div className="dropdown-menu absolute top-full mt-1 left-0 min-w-[140px] animate-in-up">
                    {priorityOptions.map((p) => (
                      <button
                        key={p.value}
                        onClick={() => { setPriority(p.value); setShowPriority(false); }}
                        className="dropdown-item first:pt-2 last:pb-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.dot }} />
                        <span className={p.class}>{p.label}</span>
                        {p.value === priority && <Check className="w-3 h-3 ml-auto text-orange-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Due date */}
              <label className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[#1A1714] border border-[#2C2820] text-xs text-[#B8A898] hover:border-[#3C3828] hover:text-[#EDE0D0] transition-all duration-150 cursor-pointer">
                <Calendar className="w-3 h-3 text-[#4A3F35]" />
                {dueDate ? format(new Date(dueDate + "T00:00:00"), "MMM d, yyyy") : "Due date"}
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          <div className="px-5 py-5 space-y-6">
            {/* Description */}
            <div>
              <p className="section-label mb-2">Description</p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add notes, links, details…"
                rows={4}
                className="w-full px-3.5 py-3 rounded-xl bg-[#1A1714] border border-[#2C2820] text-sm text-[#EDE0D0] placeholder:text-[#4A3F35] focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500/30 resize-none transition-all"
              />
            </div>

            {/* Subtasks */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="section-label">
                  Subtasks
                  {subtasks.length > 0 && (
                    <span className="ml-2 text-[#4A3F35] normal-case not-italic">
                      {doneCount}/{subtasks.length}
                    </span>
                  )}
                </p>
              </div>

              {/* Progress bar */}
              {subtasks.length > 0 && (
                <div className="h-1 bg-[#1A1714] rounded-full mb-3 overflow-hidden">
                  <div
                    className="h-full bg-orange-500/60 rounded-full transition-all duration-500"
                    style={{ width: `${subtasks.length ? (doneCount / subtasks.length) * 100 : 0}%` }}
                  />
                </div>
              )}

              <div className="space-y-1.5 mb-3">
                {subtasks.map((sub) => {
                  const isDone = doneStatus && sub.statusId === doneStatus.id;
                  return (
                    <div key={sub.id} className="flex items-center gap-2.5 group py-0.5">
                      <button
                        onClick={() => toggleSubtask(sub)}
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all duration-150",
                          isDone
                            ? "bg-orange-500 border-orange-500"
                            : "border-[#3C3828] hover:border-orange-500/50 bg-transparent"
                        )}
                      >
                        {isDone && <Check className="w-2.5 h-2.5 text-white" />}
                      </button>
                      <span className={cn(
                        "text-sm flex-1 transition-colors",
                        isDone ? "line-through text-[#4A3F35]" : "text-[#B8A898]"
                      )}>
                        {sub.title}
                      </span>
                    </div>
                  );
                })}
              </div>

              <form onSubmit={addSubtask} className="flex gap-2">
                <input
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  placeholder="Add subtask…"
                  className="flex-1 px-3 py-2 rounded-lg bg-[#1A1714] border border-[#2C2820] text-sm text-[#EDE0D0] placeholder:text-[#4A3F35] focus:outline-none focus:ring-1 focus:ring-orange-500/25 focus:border-orange-500/30 transition-all"
                />
                <button type="submit" className="btn-ghost px-3">
                  <Plus className="w-4 h-4" />
                </button>
              </form>
            </div>

            {/* Comments */}
            <div>
              <p className="section-label mb-3">
                Comments
                {comments.length > 0 && <span className="ml-2 text-[#4A3F35] normal-case">{comments.length}</span>}
              </p>

              {comments.length > 0 && (
                <div className="space-y-4 mb-4">
                  {comments.map((c) => (
                    <div key={c.id} className="flex gap-3 group">
                      <div className="w-7 h-7 rounded-lg bg-orange-500/12 text-orange-400/80 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5 border border-orange-500/10">
                        {c.authorId.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] text-[#4A3F35]">
                            {format(new Date(c.createdAt), "MMM d, h:mm a")}
                          </span>
                          {c.authorId === userId && (
                            <button
                              onClick={() => deleteComment(c.id)}
                              className="text-[11px] text-[#4A3F35] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all ml-auto"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-[#B8A898] leading-relaxed">{c.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={addComment} className="flex gap-2">
                <input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment…"
                  className="flex-1 px-3 py-2 rounded-lg bg-[#1A1714] border border-[#2C2820] text-sm text-[#EDE0D0] placeholder:text-[#4A3F35] focus:outline-none focus:ring-1 focus:ring-orange-500/25 focus:border-orange-500/30 transition-all"
                />
                <button type="submit" className="btn-primary px-3 py-2 text-xs">
                  Post
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
