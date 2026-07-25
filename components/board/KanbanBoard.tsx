"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors,
  DragStartEvent, DragEndEvent, DragOverEvent, closestCorners,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Group, Status, Task } from "@/types";
import Column from "./Column";
import TaskCard from "./TaskCard";
import TaskDetail from "@/components/task/TaskDetail";
import { Plus, Trash2, Settings } from "lucide-react";
import ConfettiCelebration, { ConfettiHandle } from "./ConfettiCelebration";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ProjectSettingsModal from "./ProjectSettingsModal";

interface Props {
  group: Group & { statuses: Status[] };
  initialTasks: Task[];
  userId: string;
}

export default function KanbanBoard({ group, initialTasks, userId }: Props) {
  const [tasks, setTasks]           = useState<Task[]>(initialTasks);
  const [statuses, setStatuses]     = useState<Status[]>(group.statuses);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [addingStatus, setAddingStatus] = useState(false);
  const [newStatusName, setNewStatusName] = useState("");
  const [glowingStatusId, setGlowingStatusId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const dragStartStatusRef = useRef<string | null>(null);
  const confettiRef = useRef<ConfettiHandle>(null);
  const router = useRouter();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function tasksByStatus(statusId: string) {
    return tasks.filter(t => t.statusId === statusId).sort((a, b) => a.order - b.order);
  }

  function onDragStart({ active }: DragStartEvent) {
    const task = tasks.find(t => t.id === active.id) ?? null;
    setActiveTask(task);
    dragStartStatusRef.current = task?.statusId ?? null;
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId = active.id as string;
    const overId   = over.id as string;
    const activeTask = tasks.find(t => t.id === activeId);
    if (!activeTask) return;
    const overTask   = tasks.find(t => t.id === overId);
    const overStatus = statuses.find(s => s.id === overId);
    const targetStatusId = overTask ? overTask.statusId : overStatus ? overStatus.id : null;
    if (!targetStatusId || activeTask.statusId === targetStatusId) return;
    setTasks(prev => prev.map(t => t.id === activeId ? { ...t, statusId: targetStatusId } : t));
  }

  function isDoneStatus(statusId: string) {
    const status = statuses.find(s => s.id === statusId);
    return !!status && status.celebrate;
  }

  async function toggleCelebrate(statusId: string, celebrate: boolean) {
    setStatuses(prev => prev.map(s => s.id === statusId ? { ...s, celebrate } : s));
    const res = await fetch(`/api/groups/${group.id}/statuses/${statusId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ celebrate }),
    });
    if (!res.ok) {
      // Roll back optimistic update if save failed
      setStatuses(prev => prev.map(s => s.id === statusId ? { ...s, celebrate: !celebrate } : s));
    }
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null);
    if (!over) return;
    const activeId = active.id as string;
    const overId   = over.id as string;
    const previousStatusId = dragStartStatusRef.current;
    const moved = tasks.find(t => t.id === activeId);
    if (!moved) return;
    const columnTasks = tasksByStatus(moved.statusId);
    const oldIdx = columnTasks.findIndex(t => t.id === activeId);
    const newIdx = columnTasks.findIndex(t => t.id === overId);
    if (oldIdx === -1) return;
    const reordered = newIdx === -1 ? columnTasks : arrayMove(columnTasks, oldIdx, newIdx);
    const updates   = reordered.map((t, i) => ({ id: t.id, order: i, statusId: moved.statusId }));
    setTasks(prev => {
      const rest = prev.filter(t => t.statusId !== moved.statusId);
      return [...rest, ...reordered.map((t, i) => ({ ...t, order: i }))];
    });

    if (previousStatusId && moved.statusId !== previousStatusId && isDoneStatus(moved.statusId)) {
      confettiRef.current?.fire();
      setGlowingStatusId(moved.statusId);
      setTimeout(() => setGlowingStatusId(null), 1200);
    }

    await fetch("/api/tasks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
  }

  async function deleteStatus(statusId: string) {
    setStatuses(prev => prev.filter(s => s.id !== statusId));
    setTasks(prev => prev.filter(t => t.statusId !== statusId));
    await fetch(`/api/groups/${group.id}/statuses/${statusId}`, { method: "DELETE" });
  }

  async function addStatus(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!newStatusName.trim()) return;
    const res = await fetch(`/api/groups/${group.id}/statuses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newStatusName.trim(), order: statuses.length }),
    });
    if (res.ok) {
      const s: Status = await res.json();
      setStatuses(prev => [...prev, s]);
      setNewStatusName(""); setAddingStatus(false);
    }
  }

  async function createTask(statusId: string, title: string, priority: string) {
    const tempId = `temp-${Date.now()}`;
    const optimistic: Task = {
      id: tempId,
      title,
      statusId,
      priority: priority as Task["priority"],
      order: tasksByStatus(statusId).length,
      groupId: group.id,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description: null,
      dueDate: null,
    };
    setTasks(prev => [...prev, optimistic]);

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, groupId: group.id, statusId, priority, order: optimistic.order }),
    });
    if (res.ok) {
      const task: Task = await res.json();
      setTasks(prev => prev.map(t => t.id === tempId ? task : t));
    } else {
      setTasks(prev => prev.filter(t => t.id !== tempId));
    }
  }

  async function openTask(task: Task) {
    const res = await fetch(`/api/tasks/${task.id}`);
    setSelectedTask(res.ok ? await res.json() : task);
  }

  function onTaskUpdated(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? { ...updated } : t));
    setSelectedTask(updated);
  }

  function onTaskDeleted(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    setSelectedTask(null);
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete project?"
          message={`"${group.name}" and all its columns and tasks will be permanently deleted.`}
          confirmLabel="Delete project"
          onConfirm={async () => {
            setConfirmDelete(false);
            await fetch(`/api/groups/${group.id}`, { method: "DELETE" });
            window.dispatchEvent(new CustomEvent("group-deleted", { detail: { id: group.id } }));
            router.push("/dashboard");
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {/* ── Header ── */}
      <div className="h-14 px-4 md:px-6 flex items-center gap-2 md:gap-3 flex-shrink-0 overflow-hidden"
           style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
        {/* Left: project dot + name — never shrink */}
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
             style={{ background: group.color, boxShadow: `0 0 8px 2px ${group.color}55` }} />
        <h1 className="text-sm font-semibold flex-shrink-0" style={{ color: "var(--text-primary)" }}>{group.name}</h1>

        {/* Middle: status badges — scrollable on tablet, visible on desktop */}
        <div className="flex items-center gap-1.5 overflow-x-auto flex-shrink min-w-0" style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}>
          {statuses.map(s => (
            <span key={s.id} className="text-[11px] font-medium px-2.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                  style={{ background: "var(--card)", border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}>
              {tasksByStatus(s.id).length} {s.name}
            </span>
          ))}
        </div>

        {/* Right: add column + delete — always at the end */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {addingStatus ? (
            <form onSubmit={addStatus} className="animate-in-up">
              <input
                autoFocus value={newStatusName}
                onChange={e => setNewStatusName(e.target.value)}
                onBlur={() => { if (!newStatusName.trim()) setAddingStatus(false); }}
                onKeyDown={e => e.key === "Escape" && setAddingStatus(false)}
                placeholder="Column name…"
                className="px-3 py-1.5 rounded-lg text-sm outline-none w-36"
                style={{ background: "var(--elevated)", border: "1px solid var(--border-accent)", color: "var(--text-primary)" }}
              />
            </form>
          ) : (
            <button
              onClick={() => setAddingStatus(true)}
              className="h-8 flex items-center gap-2 px-3 rounded-lg text-xs transition-all duration-200"
              style={{ border: "1px dashed var(--border-strong)", color: "var(--text-secondary)" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "";
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)";
                (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
              }}
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline">Add column</span>
            </button>
          )}

          <button
            onClick={() => setShowSettings(true)}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-xs transition-all duration-150 flex-shrink-0"
            style={{ color: "var(--text-secondary)", border: "1px solid transparent" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
              (e.currentTarget as HTMLElement).style.background = "";
            }}
            title="Project settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setConfirmDelete(true)}
            className="h-8 flex items-center gap-2 px-3 rounded-lg text-xs transition-all duration-150"
            style={{ color: "var(--text-secondary)", border: "1px solid transparent" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.color = "#EF4444";
              (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)";
              (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.25)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
              (e.currentTarget as HTMLElement).style.background = "";
              (e.currentTarget as HTMLElement).style.borderColor = "transparent";
            }}
          >
            <Trash2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">Delete project</span>
          </button>
        </div>
      </div>

      {showSettings && (
        <ProjectSettingsModal
          groupId={group.id}
          groupName={group.name}
          excludeFromReports={group.excludeFromReports}
          onClose={() => setShowSettings(false)}
          onDeleted={async () => {
            setShowSettings(false);
            window.dispatchEvent(new CustomEvent("group-deleted", { detail: { id: group.id } }));
            router.push("/dashboard");
          }}
        />
      )}

      {/* ── Board canvas ── */}
      <div className="kanban-canvas flex-1 overflow-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {!mounted ? null : <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          <div className="flex gap-3 md:gap-4 px-3 md:px-5 pt-4 pb-8 items-start" style={{ width: "max-content", minWidth: "100%" }}>
            {statuses.map(status => (
              <Column key={status.id} status={status} tasks={tasksByStatus(status.id)}
                onCreateTask={createTask} onOpenTask={openTask}
                onDeleteStatus={deleteStatus}
                onToggleCelebrate={toggleCelebrate}
                glowing={glowingStatusId === status.id} />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(0.18,0.67,0.6,1.22)" }}>
            {activeTask && <TaskCard task={activeTask} onOpen={() => {}} isDragging />}
          </DragOverlay>
        </DndContext>}
      </div>

      {/* ── Task detail panel ── */}
      {selectedTask && (
        <TaskDetail task={selectedTask} statuses={statuses} userId={userId}
          onClose={() => setSelectedTask(null)} onUpdated={onTaskUpdated} onDeleted={onTaskDeleted} />
      )}

      <ConfettiCelebration ref={confettiRef} />
    </div>
  );
}
