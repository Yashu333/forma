"use client";

import { useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  DragStartEvent, DragEndEvent, DragOverEvent, closestCorners,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Group, Status, Task } from "@/types";
import Column from "./Column";
import TaskCard from "./TaskCard";
import TaskDetail from "@/components/task/TaskDetail";
import { Plus } from "lucide-react";

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function tasksByStatus(statusId: string) {
    return tasks.filter(t => t.statusId === statusId).sort((a, b) => a.order - b.order);
  }

  function onDragStart({ active }: DragStartEvent) {
    setActiveTask(tasks.find(t => t.id === active.id) ?? null);
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

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null);
    if (!over) return;
    const activeId = active.id as string;
    const overId   = over.id as string;
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
    await fetch("/api/tasks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
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

  async function createTask(statusId: string, title: string) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, groupId: group.id, statusId, order: tasksByStatus(statusId).length }),
    });
    if (res.ok) {
      const task: Task = await res.json();
      setTasks(prev => [...prev, task]);
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

      {/* ── Header ── */}
      <div className="h-14 px-6 flex items-center gap-3 flex-shrink-0"
           style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
             style={{ background: group.color, boxShadow: `0 0 8px 2px ${group.color}55` }} />
        <h1 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{group.name}</h1>
        <div className="flex items-center gap-1.5 ml-2">
          {statuses.map(s => (
            <span key={s.id} className="text-[11px] font-medium px-2.5 py-0.5 rounded-full"
                  style={{ background: "var(--card)", border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}>
              {tasksByStatus(s.id).length} {s.name}
            </span>
          ))}
        </div>
      </div>

      {/* ── Board canvas ── */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          <div className="flex gap-4 p-5 h-full min-w-max items-start">
            {statuses.map(status => (
              <Column key={status.id} status={status} tasks={tasksByStatus(status.id)}
                onCreateTask={createTask} onOpenTask={openTask} />
            ))}

            {/* ── Add column ── */}
            <div className="w-80 flex-shrink-0">
              {addingStatus ? (
                <form onSubmit={addStatus} className="animate-in-up">
                  <input
                    autoFocus value={newStatusName}
                    onChange={e => setNewStatusName(e.target.value)}
                    onBlur={() => { if (!newStatusName.trim()) setAddingStatus(false); }}
                    onKeyDown={e => e.key === "Escape" && setAddingStatus(false)}
                    placeholder="Column name…"
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: "var(--elevated)", border: "1px solid var(--border-accent)", color: "var(--text-primary)" }}
                  />
                </form>
              ) : (
                <button
                  onClick={() => setAddingStatus(true)}
                  className="w-full h-11 flex items-center gap-2.5 px-3.5 rounded-xl text-sm transition-all duration-200"
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
                  <Plus className="w-4 h-4 flex-shrink-0" />
                  Add column
                </button>
              )}
            </div>
          </div>

          <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(0.18,0.67,0.6,1.22)" }}>
            {activeTask && <TaskCard task={activeTask} onOpen={() => {}} isDragging />}
          </DragOverlay>
        </DndContext>
      </div>

      {/* ── Task detail panel ── */}
      {selectedTask && (
        <TaskDetail task={selectedTask} statuses={statuses} userId={userId}
          onClose={() => setSelectedTask(null)} onUpdated={onTaskUpdated} onDeleted={onTaskDeleted} />
      )}
    </div>
  );
}
