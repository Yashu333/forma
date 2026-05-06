"use client";

import { useState } from "react";
import { Task, Status, Comment, Priority } from "@/types";
import { X, Trash2, Calendar, Flag, ChevronDown, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";

const priorityOptions: { value: Priority; label: string; class: string }[] = [
  { value: "URGENT", label: "Urgent", class: "text-red-400" },
  { value: "HIGH",   label: "High",   class: "text-orange-400" },
  { value: "MEDIUM", label: "Medium", class: "text-yellow-400" },
  { value: "LOW",    label: "Low",    class: "text-green-400" },
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
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [statusId, setStatusId] = useState(task.statusId);
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.split("T")[0] : "");
  const [saving, setSaving] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");
  const [subtasks, setSubtasks] = useState(task.subtasks ?? []);
  const [comments, setComments] = useState<Comment[]>(task.comments ?? []);
  const [newComment, setNewComment] = useState("");
  const [showPriority, setShowPriority] = useState(false);
  const [showStatus, setShowStatus] = useState(false);

  const isDirty =
    title !== task.title ||
    description !== (task.description ?? "") ||
    priority !== task.priority ||
    statusId !== task.statusId ||
    dueDate !== (task.dueDate ? task.dueDate.split("T")[0] : "");

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description || null,
        priority,
        statusId,
        dueDate: dueDate || null,
      }),
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
      body: JSON.stringify({
        title: newSubtask.trim(),
        groupId: task.groupId,
        statusId: task.statusId,
        parentTaskId: task.id,
        order: subtasks.length,
      }),
    });
    if (res.ok) {
      const sub: Task = await res.json();
      setSubtasks((prev) => [...prev, sub]);
      setNewSubtask("");
    }
  }

  async function toggleSubtask(sub: Task) {
    const doneStatus = statuses.find((s) => s.name.toLowerCase() === "done");
    const toDoStatus = statuses.find((s) => s.name.toLowerCase() === "to do") ?? statuses[0];
    const isDone = doneStatus && sub.statusId === doneStatus.id;
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

  const doneStatus = statuses.find((s) => s.name.toLowerCase() === "done");
  const doneCount = subtasks.filter((s) => doneStatus && s.statusId === doneStatus.id).length;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-background/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-[480px] bg-card border-l border-border flex flex-col h-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            {isDirty && (
              <Button
                size="sm"
                onClick={save}
                disabled={saving}
                className="h-7 text-xs bg-accent hover:bg-accent/90 text-white btn-glow"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={deleteTask} className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Title */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-lg font-semibold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground resize-none"
            placeholder="Task title"
          />

          {/* Meta row */}
          <div className="flex flex-wrap gap-2">
            {/* Status */}
            <div className="relative">
              <button
                onClick={() => { setShowStatus((v) => !v); setShowPriority(false); }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-sm text-foreground hover:bg-secondary/80 transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-accent" />
                {statuses.find((s) => s.id === statusId)?.name ?? "Status"}
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
              {showStatus && (
                <div className="absolute top-full mt-1 left-0 bg-card border border-border rounded-lg shadow-xl z-10 min-w-[140px]">
                  {statuses.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setStatusId(s.id); setShowStatus(false); }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-2",
                        s.id === statusId && "text-accent"
                      )}
                    >
                      {s.id === statusId && <Check className="w-3 h-3" />}
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Priority */}
            <div className="relative">
              <button
                onClick={() => { setShowPriority((v) => !v); setShowStatus(false); }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-sm hover:bg-secondary/80 transition-colors"
              >
                <Flag className="w-3 h-3" />
                <span className={priorityOptions.find((p) => p.value === priority)?.class}>
                  {priorityOptions.find((p) => p.value === priority)?.label}
                </span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
              {showPriority && (
                <div className="absolute top-full mt-1 left-0 bg-card border border-border rounded-lg shadow-xl z-10 min-w-[120px]">
                  {priorityOptions.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => { setPriority(p.value); setShowPriority(false); }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-2",
                        p.class
                      )}
                    >
                      {p.value === priority && <Check className="w-3 h-3" />}
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Due date */}
            <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary text-sm text-muted-foreground hover:bg-secondary/80 transition-colors cursor-pointer">
              <Calendar className="w-3 h-3" />
              {dueDate ? format(new Date(dueDate + "T00:00:00"), "MMM d, yyyy") : "Due date"}
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="sr-only"
              />
            </label>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description…"
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
          </div>

          {/* Subtasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Subtasks {subtasks.length > 0 && `(${doneCount}/${subtasks.length})`}
              </label>
            </div>
            {subtasks.length > 0 && (
              <div className="space-y-1 mb-2">
                {subtasks.map((sub) => {
                  const isDone = doneStatus && sub.statusId === doneStatus.id;
                  return (
                    <div key={sub.id} className="flex items-center gap-2 group">
                      <button
                        onClick={() => toggleSubtask(sub)}
                        className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors",
                          isDone ? "bg-accent border-accent" : "border-border hover:border-accent/50"
                        )}
                      >
                        {isDone && <Check className="w-2.5 h-2.5 text-white" />}
                      </button>
                      <span className={cn("text-sm", isDone ? "line-through text-muted-foreground" : "text-foreground")}>
                        {sub.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <form onSubmit={addSubtask} className="flex gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="Add subtask…"
                className="flex-1 px-3 py-1.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground hover:text-accent">
                <Plus className="w-4 h-4" />
              </Button>
            </form>
          </div>

          {/* Comments */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
              Comments {comments.length > 0 && `(${comments.length})`}
            </label>
            {comments.length > 0 && (
              <div className="space-y-3 mb-3">
                {comments.map((c) => (
                  <div key={c.id} className="group flex gap-2.5">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {c.authorId.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(c.createdAt), "MMM d, h:mm a")}
                        </span>
                        {c.authorId === userId && (
                          <button
                            onClick={() => deleteComment(c.id)}
                            className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all text-xs"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-foreground">{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={addComment} className="flex gap-2">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment…"
                className="flex-1 px-3 py-1.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <Button type="submit" size="sm" className="bg-accent hover:bg-accent/90 text-white">
                Post
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
