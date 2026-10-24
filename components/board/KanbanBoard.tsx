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
  /** A task to open on arrival, from a search result (?task=<id>). */
  openTaskId?: string;
}

export default function KanbanBoard({ group, initialTasks, userId, openTaskId }: Props) {
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

  // A task created by quick capture while this project is open appears right away.
  useEffect(() => {
    function onCreated(e: Event) {
      const task = (e as CustomEvent<Task>).detail;
      if (!task || task.groupId !== group.id) return;
      setTasks(prev => prev.some(t => t.id === task.id) ? prev : [...prev, task]);
    }
    window.addEventListener("task-created", onCreated);
    return () => window.removeEventListener("task-created", onCreated);
  }, [group.id]);

  // Open the task a search result pointed at, then drop the param so a refresh doesn't reopen it.
  useEffect(() => {
    if (!openTaskId) return;
    let cancelled = false;
    fetch(`/api/tasks/${openTaskId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((t: Task | null) => { if (!cancelled && t && t.groupId === group.id) setSelectedTask(t); });
    router.replace(`/group/${group.id}`);
    return () => { cancelled = true; };
  }, [openTaskId, group.id, router]);

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

    const res = await fetch("/api/tasks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    if (res.ok) {
      const { spawned } = await res.json() as { spawned?: Task[] };
      if (spawned?.length) setTasks(prev => [...prev, ...spawned.filter(s => !prev.some(t => t.id === s.id))]);
    }
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

  function onTaskUpdated(updated: Task & { nextInstance?: Task }) {
    // Finishing a repeating task creates its next copy; show it without a reload.
    const { nextInstance, ...task } = updated;
    setTasks(prev => {
      const next = prev.map(t => t.id === task.id ? { ...task } : t);
      return nextInstance && !next.some(t => t.id === nextInstance.id) ? [...next, nextInstance] : next;
    });
    setSelectedTask(task);
  }

  function onTaskDeleted(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    setSelectedTask(null);
  }

  return (
    <div className="flex flex-col h-full bg-background">
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
      <div className="h-14 px-4 md:px-6 flex items-center gap-2 md:gap-3 flex-shrink-0 overflow-hidden border-b border-border bg-background">
        {/* Left: project dot + name — never shrink */}
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: group.color }} aria-hidden="true" />
        <h1 className="text-sm font-semibold flex-shrink-0 text-foreground">{group.name}</h1>

        {/* Middle: status counts — scrollable on tablet, visible on desktop */}
        <div className="flex items-center gap-1.5 overflow-x-auto flex-shrink min-w-0" style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}>
          {statuses.map(s => (
            <span key={s.id} className="text-xs px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0 border border-border bg-surface text-muted-foreground tabular">
              {tasksByStatus(s.id).length} {s.name}
            </span>
          ))}
        </div>

        {/* Right: add column + settings + delete — always at the end */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {addingStatus ? (
            <form onSubmit={addStatus} className="animate-in-up">
              <input
                autoFocus value={newStatusName}
                onChange={e => setNewStatusName(e.target.value)}
                onBlur={() => { if (!newStatusName.trim()) setAddingStatus(false); }}
                onKeyDown={e => e.key === "Escape" && setAddingStatus(false)}
                placeholder="Column name…"
                aria-label="Column name"
                className="forma-input !py-1.5 !text-sm w-36"
              />
            </form>
          ) : (
            <button
              onClick={() => setAddingStatus(true)}
              aria-label="Add column"
              className="h-8 flex items-center gap-2 px-3 rounded-md text-xs border border-dashed border-border-strong text-muted-foreground transition-colors hover:bg-raised hover:border-border-strong hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Add column</span>
            </button>
          )}

          <button
            onClick={() => setShowSettings(true)}
            className="h-8 w-8 flex items-center justify-center rounded-md flex-shrink-0 text-muted-foreground transition-colors hover:bg-raised hover:text-foreground"
            title="Project settings"
            aria-label="Project settings"
          >
            <Settings className="w-3.5 h-3.5" aria-hidden="true" />
          </button>

          <button
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete project"
            className="h-8 flex items-center gap-2 px-3 rounded-md text-xs text-muted-foreground transition-colors hover:bg-raised hover:text-danger"
          >
            <Trash2 className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
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
