"use client";

import { useState, useEffect, useRef } from "react";
import { Task, Status, Comment, Priority, Abcde } from "@/types";
import { X, Trash2, Archive, Timer, ChevronDown, Plus, Minus, Check, GripVertical, Sun, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ABCDE_LETTERS, ABCDE_META } from "@/lib/frog/abcde";
import { localDateKey } from "@/lib/frog/dates";
import DatePicker from "@/components/ui/DatePicker";
import RepeatPicker from "@/components/task/RepeatPicker";
import type { RepeatRule } from "@/lib/recurrence/rule";
import { useFitInViewport } from "@/lib/fit-in-viewport";
import Link from "next/link";
import { formatDuration } from "@/lib/focus/stats";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const STATUS_COLORS: Record<string, string> = {
  "to do":       "#B8AFA7",
  "todo":        "#B8AFA7",
  "doing":       "#EAB308",
  "in progress": "#EAB308",
  "done":        "#34D399",
  "review":      "#C084FC",
};
const statusColor = (name: string) => STATUS_COLORS[name.toLowerCase()] ?? "#B8AFA7";

const PRIORITY_OPTIONS: { value: Priority; label: string; bar: string; color: string }[] = [
  { value: "URGENT", label: "Urgent", bar: "#A867C0", color: "#C39BD3" },
  { value: "HIGH",   label: "High",   bar: "#DC4E55", color: "#F4959A" },
  { value: "MEDIUM", label: "Medium", bar: "#4A8FA8", color: "#7EB8CC" },
  { value: "LOW",    label: "Low",    bar: "#74869F", color: "#94A3B8" },
];

const MAX_RANK_STEP = 99;

// The meta pills are 28px tall (inline style); under lg they grow to 36px so a
// thumb can hit them. `!` because the height is set inline.
const PILL_TAP = "max-lg:!h-9";

// "Today" for planning is the browser's local date, never the server's.
function browserToday(): string {
  return localDateKey(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

// "2026-10-25" -> "Oct 25", built from the parts so no time zone shifts the day.
function shortDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return format(new Date(y, m - 1, d), "MMM d");
}

interface Props {
  task: Task; statuses: Status[]; userId: string;
  onClose: () => void; onUpdated: (t: Task) => void; onDeleted: (id: string) => void;
}

function SortableSubtask({ sub, isDone, onToggle, onDelete }: { sub: Task; isDone: boolean; onToggle: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sub.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1 py-0.5 group/subtask">
      <button {...attributes} {...listeners}
        aria-label={`Reorder ${sub.title}`}
        className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground opacity-100 lg:opacity-0 lg:group-hover/subtask:opacity-100 focus-visible:opacity-100 transition-opacity rounded max-lg:w-8 max-lg:h-8 max-lg:flex max-lg:items-center max-lg:justify-center"
        style={{ touchAction: "none" }}>
        <GripVertical className="w-3 h-3" aria-hidden="true" />
      </button>
      {/* Under lg the button is a 32px hit area around the same 16px box. */}
      <button onClick={onToggle}
        role="checkbox"
        aria-checked={isDone}
        aria-label={`${isDone ? "Mark not done" : "Mark done"}: ${sub.title}`}
        className="group/check w-4 h-4 rounded flex items-center justify-center flex-shrink-0 max-lg:w-8 max-lg:h-8">
        <span className={cn(
          "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors border",
          isDone ? "bg-success border-success" : "bg-transparent border-input group-hover/check:border-foreground"
        )}>
          {isDone && <Check className="w-2.5 h-2.5 text-primary-foreground" aria-hidden="true" />}
        </span>
      </button>
      <span className={cn("text-sm flex-1 transition-colors", isDone ? "line-through text-subtle" : "text-muted-foreground")}>
        {sub.title}
      </span>
      <button onClick={onDelete}
        aria-label={`Delete subtask: ${sub.title}`}
        className="flex-shrink-0 text-muted-foreground opacity-100 lg:opacity-0 lg:group-hover/subtask:opacity-100 focus-visible:opacity-100 hover:text-danger transition-opacity rounded max-lg:w-8 max-lg:h-8 max-lg:flex max-lg:items-center max-lg:justify-center">
        <X className="w-3 h-3" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function TaskDetail({ task, statuses, userId, onClose, onUpdated, onDeleted }: Props) {
  const [title, setTitle]           = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority]     = useState<Priority>(task.priority);
  const [statusId, setStatusId]     = useState(task.statusId);
  const [dueDate, setDueDate]       = useState(() => {
    if (!task.dueDate) return "";
    const d = new Date(task.dueDate);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [abcde, setAbcde]           = useState<Abcde | null>(task.abcde ?? null);
  const [abcdeRank, setAbcdeRank]   = useState<number | null>(task.abcdeRank ?? null);
  const [plannedFor, setPlannedFor] = useState<string | null>(task.plannedFor ?? null);
  const [repeat, setRepeat]         = useState<RepeatRule | null>(task.repeat ?? null);
  const [saving, setSaving]         = useState(false);
  const [skipNote, setSkipNote]     = useState<string | null>(null);
  const [newSubtask, setNewSubtask] = useState("");
  const [subtasks, setSubtasks]     = useState(task.subtasks ?? []);
  const [comments, setComments]     = useState<Comment[]>(task.comments ?? []);
  const [newComment, setNewComment] = useState("");
  const [showPriority, setShowPriority]   = useState(false);
  const [showAbcde, setShowAbcde]         = useState(false);
  const [showStatus, setShowStatus]       = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const statusRef   = useRef<HTMLDivElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);
  const abcdeRef    = useRef<HTMLDivElement>(null);
  // Under lg, an open menu is nudged back inside the screen (a pill near the right edge).
  const statusMenuRef   = useRef<HTMLDivElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);
  const abcdeMenuRef    = useRef<HTMLDivElement>(null);
  useFitInViewport(statusMenuRef, showStatus);
  useFitInViewport(priorityMenuRef, showPriority);
  useFitInViewport(abcdeMenuRef, showAbcde);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (showStatus && statusRef.current && !statusRef.current.contains(e.target as Node)) setShowStatus(false);
      if (showPriority && priorityRef.current && !priorityRef.current.contains(e.target as Node)) setShowPriority(false);
      if (showAbcde && abcdeRef.current && !abcdeRef.current.contains(e.target as Node)) setShowAbcde(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showStatus, showPriority, showAbcde]);

  const taskDueDateLocal = (() => {
    if (!task.dueDate) return "";
    const d = new Date(task.dueDate);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const isDirty = title !== task.title || description !== (task.description ?? "") ||
    priority !== task.priority || statusId !== task.statusId ||
    dueDate !== taskDueDateLocal ||
    abcde !== (task.abcde ?? null) || abcdeRank !== (task.abcdeRank ?? null) ||
    plannedFor !== (task.plannedFor ?? null) ||
    JSON.stringify(repeat) !== JSON.stringify(task.repeat ?? null);

  const currentPriority = PRIORITY_OPTIONS.find(p => p.value === priority)!;
  const today           = browserToday();
  const plannedToday    = plannedFor === today;
  const currentStatus   = statuses.find(s => s.id === statusId);
  const doneStatus      = statuses.find(s => s.name.toLowerCase() === "done");
  const doneCount       = subtasks.filter(s => doneStatus && s.statusId === doneStatus.id).length;

  async function save() {
    setSaving(true);
    // Convert local "YYYY-MM-DDTHH:MM" to UTC ISO string so the server stores it correctly
    let dueDatePayload: string | null = null;
    if (dueDate) {
      const [dp, tp] = dueDate.split("T");
      const [yr, mo, dy] = dp.split("-").map(Number);
      const [hr, mn] = tp ? tp.split(":").map(Number) : [0, 0];
      dueDatePayload = new Date(yr, mo - 1, dy, hr, mn, 0, 0).toISOString();
    }
    // Only send the planning fields that were edited, so saving a title doesn't
    // overwrite a letter or plan changed elsewhere (e.g. on /today) meanwhile.
    const planning: { abcde?: Abcde | null; abcdeRank?: number | null; plannedFor?: string | null } = {};
    if (abcde !== (task.abcde ?? null)) planning.abcde = abcde;
    if (abcdeRank !== (task.abcdeRank ?? null)) planning.abcdeRank = abcdeRank;
    if (plannedFor !== (task.plannedFor ?? null)) planning.plannedFor = plannedFor;
    // Only send the repeat rule when it was edited. The zone lets the server
    // work out the next due date if finishing this task creates the next copy.
    const repeatPatch = JSON.stringify(repeat) !== JSON.stringify(task.repeat ?? null) ? { repeat } : {};
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description: description || null, priority, statusId, dueDate: dueDatePayload, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...planning, ...repeatPatch }),
    });
    if (res.ok) {
      const updated: Task = await res.json();
      // Normalize returned UTC date back to local "YYYY-MM-DDTHH:MM" so isDirty resets
      if (updated.dueDate) {
        const d = new Date(updated.dueDate);
        const pad = (n: number) => String(n).padStart(2, "0");
        updated.dueDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
      onUpdated({ ...updated, subtasks, comments });
    }
    setSaving(false);
  }

  // Repeating task: move it to its next date without finishing it.
  async function skipOccurrence() {
    setSaving(true);
    setSkipNote(null);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skip: true, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    if (res.ok) {
      const updated: Task = await res.json();
      if (updated.dueDate) {
        const d = new Date(updated.dueDate);
        const pad = (n: number) => String(n).padStart(2, "0");
        updated.dueDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        setDueDate(updated.dueDate);
        setSkipNote(`Skipped. Next one is ${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}.`);
      }
      setPlannedFor(updated.plannedFor ?? null);
      onUpdated({ ...updated, subtasks, comments });
    } else {
      let message = "Couldn't skip it";
      try { const b = await res.json(); if (typeof b?.error === "string") message = b.error; } catch { /* keep the fallback */ }
      setSkipNote(message);
    }
    setSaving(false);
  }

  async function deleteTask() {
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    onDeleted(task.id);
  }

  async function archiveTask() {
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
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

  async function deleteSubtask(sub: Task) {
    const res = await fetch(`/api/tasks/${sub.id}`, { method: "DELETE" });
    if (res.ok) setSubtasks(p => p.filter(s => s.id !== sub.id));
  }

  const subtaskSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  function handleSubtaskDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = subtasks.findIndex(s => s.id === active.id);
    const newIndex = subtasks.findIndex(s => s.id === over.id);
    const reordered = arrayMove(subtasks, oldIndex, newIndex);
    setSubtasks(reordered);
    const updates = reordered.map((s, i) => ({ id: s.id, order: i, statusId: s.statusId }));
    fetch("/api/tasks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
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

  const inputStyle = { resize: "none" } as React.CSSProperties;

  const pillStyle = {
    display: "flex", alignItems: "center", gap: "0.375rem",
    height: "1.75rem", padding: "0 0.625rem", borderRadius: "0.375rem",
    background: "var(--surface)", border: "1px solid var(--border)",
    fontSize: "0.75rem", color: "var(--muted-foreground)",
    cursor: "pointer", transition: "border-color 0.15s, color 0.15s",
  } as React.CSSProperties;

  return (
    <div className="panel-overlay animate-fade-in">
      <div className="panel-backdrop" onClick={onClose} />

      {/* Under md: a full-screen sheet (dynamic viewport height, clear of the notch
          and home indicator, no side edge). The toolbar stays put above the scrolling body. */}
      <div role="dialog" aria-modal="true" aria-label="Task details"
           className="w-full max-w-[500px] md:w-[500px] flex flex-col h-full overflow-hidden animate-in-right bg-surface border-l border-border-strong max-md:max-w-none max-md:h-dvh max-md:border-l-0 max-md:rounded-none max-md:pt-safe max-md:pb-safe max-md:px-safe">

        {/* Toolbar */}
        <div className="h-14 px-4 flex items-center justify-between flex-shrink-0 border-b border-border">
          <div>{isDirty && (
            <button onClick={save} disabled={saving} className="btn-primary h-7 px-3 text-xs max-lg:h-9">
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}</div>
          <div className="flex items-center gap-1">
            <button onClick={archiveTask} className="btn-icon" title="Archive: hide from board, keep for reports" aria-label="Archive task">
              <Archive className="w-4 h-4" aria-hidden="true" />
            </button>
            <button onClick={() => setShowDeleteConfirm(true)} className="btn-icon hover:!text-danger" title="Delete: move to trash" aria-label="Delete task">
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
            <button onClick={onClose} className="btn-icon" aria-label="Close"><X className="w-4 h-4" aria-hidden="true" /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* Title + meta */}
          <div className="px-5 pt-6 pb-4 border-b border-border">
            <input value={title} onChange={e => setTitle(e.target.value)} aria-label="Task title"
              className="w-full text-xl font-semibold tracking-[-0.02em] bg-transparent border-none outline-none leading-tight text-foreground placeholder:text-subtle rounded-sm focus-visible:ring-2 focus-visible:ring-ring max-lg:py-1"
              placeholder="Task title" />

            <div className="flex flex-wrap gap-2 mt-4">
              {/* Status pill */}
              <div className="relative" ref={statusRef}>
                <button style={pillStyle} className={PILL_TAP}
                  onClick={() => { setShowStatus(v => !v); setShowPriority(false); setShowAbcde(false); }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--foreground)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--muted-foreground)"; }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(currentStatus?.name ?? "") }} />
                  {currentStatus?.name ?? "Status"}
                  <ChevronDown className="w-3 h-3 ml-0.5 text-subtle" aria-hidden="true" />
                </button>
                {showStatus && (
                  <div ref={statusMenuRef} className="dropdown-menu absolute top-full mt-1 left-0 min-w-[160px] animate-in-up">
                    {statuses.filter(s => s.id !== statusId).map(s => (
                      <button key={s.id} onClick={() => { setStatusId(s.id); setShowStatus(false); }} className="dropdown-item first:pt-2 last:pb-2">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor(s.name) }} />
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Priority pill */}
              <div className="relative" ref={priorityRef}>
                <button style={pillStyle} className={PILL_TAP}
                  onClick={() => { setShowPriority(v => !v); setShowStatus(false); setShowAbcde(false); }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--foreground)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--muted-foreground)"; }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: currentPriority.bar }} />
                  {currentPriority.label}
                  <ChevronDown className="w-3 h-3 ml-0.5 text-subtle" aria-hidden="true" />
                </button>
                {showPriority && (
                  <div ref={priorityMenuRef} className="dropdown-menu absolute top-full mt-1 left-0 min-w-[140px] animate-in-up">
                    {PRIORITY_OPTIONS.filter(p => p.value !== priority).map(p => (
                      <button key={p.value} onClick={() => { setPriority(p.value); setShowPriority(false); }} className="dropdown-item first:pt-2 last:pb-2">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.bar }} />
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ABCDE pill */}
              <div className="relative" ref={abcdeRef}>
                <button style={pillStyle} className={PILL_TAP}
                  onClick={() => { setShowAbcde(v => !v); setShowStatus(false); setShowPriority(false); }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--foreground)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--muted-foreground)"; }}>
                  {abcde ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: ABCDE_META[abcde].color }} />
                      <span>{abcde} · {ABCDE_META[abcde].label}</span>
                    </>
                  ) : (
                    <span>ABCDE</span>
                  )}
                  <ChevronDown className="w-3 h-3 ml-0.5 text-subtle" aria-hidden="true" />
                </button>
                {showAbcde && (
                  <div ref={abcdeMenuRef} className="dropdown-menu absolute top-full mt-1 left-0 w-[260px] max-w-[calc(100vw-2rem)] animate-in-up">
                    {ABCDE_LETTERS.filter(l => l !== abcde).map(l => (
                      <button key={l} onClick={() => { setAbcde(l); setAbcdeRank(null); setShowAbcde(false); }} className="dropdown-item first:pt-2 last:pb-2">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: ABCDE_META[l].color }} />
                        <span className="text-left">
                          <span className="text-foreground">{l} · {ABCDE_META[l].label}</span>
                          <span className="block text-xs text-subtle">{ABCDE_META[l].description}</span>
                        </span>
                      </button>
                    ))}
                    {abcde && (
                      <button onClick={() => { setAbcde(null); setAbcdeRank(null); setShowAbcde(false); }} className="dropdown-item first:pt-2 last:pb-2">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--faint)" }} />
                        None
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Rank within the letter (A-1, A-2…) */}
              {abcde && (
                <div style={{ ...pillStyle, cursor: "default", padding: "0 0.25rem 0 0.625rem" }} className={PILL_TAP} title="Order within this letter, 1 first">
                  <span>Rank</span>
                  <button type="button" aria-label="Lower rank number" className="flex items-center justify-center w-5 h-5 rounded disabled:opacity-30 max-lg:w-8 max-lg:h-8"
                    style={{ color: "var(--subtle)" }}
                    disabled={abcdeRank === null}
                    onClick={() => setAbcdeRank(abcdeRank === null || abcdeRank <= 1 ? null : abcdeRank - 1)}>
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="min-w-[1ch] text-center" style={{ color: abcdeRank === null ? "var(--subtle)" : "var(--foreground)" }}>
                    {abcdeRank ?? "–"}
                  </span>
                  <button type="button" aria-label="Raise rank number" className="flex items-center justify-center w-5 h-5 rounded disabled:opacity-30 max-lg:w-8 max-lg:h-8"
                    style={{ color: "var(--subtle)" }}
                    disabled={abcdeRank !== null && abcdeRank >= MAX_RANK_STEP}
                    onClick={() => setAbcdeRank(Math.min((abcdeRank ?? 0) + 1, MAX_RANK_STEP))}>
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Due date */}
              <div className="relative">
                <DatePicker value={dueDate} onChange={setDueDate} pillStyle={pillStyle} pillClassName={PILL_TAP} />
              </div>

              {/* Repeat: needs a due date to anchor on, so choosing one sets today's if there is none */}
              <RepeatPicker
                value={repeat}
                anchorKey={dueDate ? dueDate.slice(0, 10) : today}
                pillStyle={pillStyle}
                pillClassName={PILL_TAP}
                onChange={(rule) => {
                  setRepeat(rule);
                  if (rule && !dueDate) {
                    const t = new Date();
                    t.setHours(t.getHours() + 1, 0, 0, 0);
                    const pad = (n: number) => String(n).padStart(2, "0");
                    setDueDate(`${today}T${pad(t.getHours())}:${pad(t.getMinutes())}`);
                  }
                }}
              />

              {/* Plan for today: toggles plannedFor between today's local date and null */}
              <button type="button" className={PILL_TAP} style={{
                  ...pillStyle,
                  ...(plannedToday && { background: "var(--primary-soft)", borderColor: "var(--primary)", color: "var(--foreground)" }),
                }}
                aria-pressed={plannedToday}
                onMouseEnter={e => { if (!plannedToday) { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = "var(--foreground)"; } }}
                onMouseLeave={e => { if (!plannedToday) { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--muted-foreground)"; } }}
                title={plannedFor && !plannedToday ? "Planned for another day. Click to plan for today instead." : undefined}
                onClick={() => setPlannedFor(plannedToday ? null : today)}>
                {plannedToday ? <Check className="w-3 h-3" aria-hidden="true" /> : <Sun className="w-3 h-3" aria-hidden="true" />}
                {plannedToday ? "Planned for today" : plannedFor ? `Planned ${shortDateKey(plannedFor)}` : "Plan for today"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href={`/pomodoro?task=${task.id}`}
                target="_blank"
                rel="noopener"
                className="btn-outline !px-2.5 !py-1 !text-xs max-lg:!py-2"
              >
                <Timer className="w-3.5 h-3.5" aria-hidden="true" /> Focus on this
              </a>
              {task.repeat && task.dueDate && !task.nextInstanceId && !currentStatus?.celebrate && (
                <button
                  type="button"
                  onClick={skipOccurrence}
                  disabled={saving || isDirty}
                  title={isDirty ? "Save your changes first" : "Move it to its next date without marking it done"}
                  className="btn-outline !px-2.5 !py-1 !text-xs max-lg:!py-2"
                >
                  <SkipForward className="w-3.5 h-3.5" aria-hidden="true" /> Skip this one
                </button>
              )}
              {task.focus && task.focus.sessions > 0 && (
                <span className="text-xs text-subtle">
                  Focus: <span className="font-mono">{formatDuration(task.focus.totalSec)}</span> · {task.focus.sessions} {task.focus.sessions === 1 ? "session" : "sessions"}
                </span>
              )}
            </div>
            {skipNote && <p className="mt-2 text-xs text-muted-foreground" role="status">{skipNote}</p>}
            {task.nextInstanceId && (
              <p className="mt-3 text-xs text-subtle">
                Finished. The next copy was created.{" "}
                <Link href={`/group/${task.groupId}?task=${task.nextInstanceId}`} onClick={onClose} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                  Open it
                </Link>
              </p>
            )}
          </div>

          <div className="px-5 py-5 space-y-6">
            {/* Description */}
            <div>
              <p className="section-label mb-2">Description</p>
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Add notes, links, details…" rows={4} aria-label="Description"
                className="forma-input" style={inputStyle} />
            </div>

            {/* Subtasks */}
            <div>
              <p className="section-label mb-3">
                Subtasks
                {subtasks.length > 0 && <span className="ml-2 font-normal text-subtle tabular">{doneCount}/{subtasks.length}</span>}
              </p>

              {subtasks.length > 0 && (
                <div className="h-1 rounded-full mb-3 overflow-hidden bg-border" role="progressbar"
                     aria-valuemin={0} aria-valuemax={subtasks.length} aria-valuenow={doneCount} aria-label="Subtasks done">
                  <div className="h-full rounded-full transition-all duration-500 bg-primary"
                       style={{ width: `${(doneCount / subtasks.length) * 100}%` }} />
                </div>
              )}

              <DndContext sensors={subtaskSensors} collisionDetection={closestCenter} onDragEnd={handleSubtaskDragEnd}>
                <SortableContext items={subtasks.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5 mb-3">
                    {subtasks.map(sub => {
                      const isDone = !!(doneStatus && sub.statusId === doneStatus.id);
                      return (
                        <SortableSubtask key={sub.id} sub={sub} isDone={isDone} onToggle={() => toggleSubtask(sub)} onDelete={() => deleteSubtask(sub)} />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>

              <form onSubmit={addSubtask} className="flex gap-2">
                <input value={newSubtask} onChange={e => setNewSubtask(e.target.value)}
                  placeholder="Add subtask…" aria-label="Add subtask" className="forma-input" />
                <button type="submit" className="btn-secondary !rounded-lg px-3" aria-label="Add subtask"><Plus className="w-4 h-4" aria-hidden="true" /></button>
              </form>
            </div>

            {/* Comments */}
            <div>
              <p className="section-label mb-3">
                Comments
                {comments.length > 0 && <span className="ml-2 font-normal text-subtle tabular">{comments.length}</span>}
              </p>

              {comments.length > 0 && (
                <div className="space-y-4 mb-4">
                  {comments.map(c => (
                    <div key={c.id} className="flex gap-3 group">
                      <div className="w-7 h-7 rounded-md text-[11px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5 bg-raised border border-border text-foreground">
                        {c.authorId.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-subtle tabular">
                            {format(new Date(c.createdAt), "MMM d, h:mm a")}
                          </span>
                          {c.authorId === userId && (
                            <button onClick={() => deleteComment(c.id)}
                              className="text-xs text-subtle opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger transition-colors ml-auto rounded-sm max-lg:px-2 max-lg:py-2 max-lg:-my-2 max-lg:-mr-2">
                              Delete
                            </button>
                          )}
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={addComment} className="flex gap-2">
                <input value={newComment} onChange={e => setNewComment(e.target.value)}
                  placeholder="Write a comment…" aria-label="Write a comment" className="forma-input" />
                <button type="submit" className="btn-secondary !rounded-lg px-3 text-xs">Post</button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div
          onClick={() => setShowDeleteConfirm(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80"
        >
          <div
            onClick={e => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete task"
            className="animate-in-up w-[460px] max-w-full rounded-lg border border-border-strong bg-surface p-6 flex flex-col gap-4"
          >
            <div>
              <p className="text-[15px] font-semibold text-foreground mb-1.5">Delete task?</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">&ldquo;{task.title}&rdquo;</span>
                {" "}and all its subtasks will be moved to trash and removed from your reports.
                To keep this task&rsquo;s history for reporting, use <span className="font-medium text-foreground">Archive</span> instead.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="h-8 px-4 rounded-md text-[13px] font-semibold border border-border bg-raised text-foreground transition-colors hover:bg-border hover:border-border-strong max-lg:h-10"
              >
                Cancel
              </button>
              <button
                onClick={deleteTask}
                className="h-8 px-4 rounded-md text-[13px] font-semibold border border-border text-danger bg-surface transition-colors hover:bg-raised hover:border-border-strong max-lg:h-10"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
