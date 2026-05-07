"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  closestCorners,
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
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [statuses, setStatuses] = useState<Status[]>(group.statuses);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [addingStatus, setAddingStatus] = useState(false);
  const [newStatusName, setNewStatusName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function tasksByStatus(statusId: string) {
    return tasks.filter((t) => t.statusId === statusId).sort((a, b) => a.order - b.order);
  }

  function onDragStart({ active }: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === active.id) ?? null);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTask = tasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    const overTask = tasks.find((t) => t.id === overId);
    const overStatus = statuses.find((s) => s.id === overId);
    const targetStatusId = overTask ? overTask.statusId : overStatus ? overStatus.id : null;

    if (!targetStatusId || activeTask.statusId === targetStatusId) return;

    setTasks((prev) =>
      prev.map((t) => (t.id === activeId ? { ...t, statusId: targetStatusId } : t))
    );
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    const moved = tasks.find((t) => t.id === activeId);
    if (!moved) return;

    const columnTasks = tasksByStatus(moved.statusId);
    const oldIdx = columnTasks.findIndex((t) => t.id === activeId);
    const newIdx = columnTasks.findIndex((t) => t.id === overId);

    if (oldIdx === -1) return;

    const reordered = newIdx === -1 ? columnTasks : arrayMove(columnTasks, oldIdx, newIdx);
    const updates = reordered.map((t, i) => ({ id: t.id, order: i, statusId: moved.statusId }));

    setTasks((prev) => {
      const rest = prev.filter((t) => t.statusId !== moved.statusId);
      return [...rest, ...reordered.map((t, i) => ({ ...t, order: i }))];
    });

    await fetch("/api/tasks/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
  }

  async function addStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!newStatusName.trim()) return;
    const res = await fetch(`/api/groups/${group.id}/statuses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newStatusName.trim(), order: statuses.length }),
    });
    if (res.ok) {
      const s: Status = await res.json();
      setStatuses((prev) => [...prev, s]);
      setNewStatusName("");
      setAddingStatus(false);
    }
  }

  async function createTask(statusId: string, title: string) {
    const columnTasks = tasksByStatus(statusId);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        groupId: group.id,
        statusId,
        order: columnTasks.length,
      }),
    });
    if (res.ok) {
      const task: Task = await res.json();
      setTasks((prev) => [...prev, task]);
    }
  }

  async function openTask(task: Task) {
    const res = await fetch(`/api/tasks/${task.id}`);
    if (res.ok) setSelectedTask(await res.json());
    else setSelectedTask(task);
  }

  function onTaskUpdated(updated: Task) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...updated } : t)));
    setSelectedTask(updated);
  }

  function onTaskDeleted(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setSelectedTask(null);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/60 flex items-center gap-3 flex-shrink-0 bg-card/30 backdrop-blur-sm">
        <div
          className="w-3 h-3 rounded-full shadow-[0_0_8px_2px_var(--glow)]"
          style={{ background: group.color, ["--glow" as string]: group.color + "66" }}
        />
        <h1 className="text-lg font-semibold text-foreground">{group.name}</h1>
        <span className="text-xs text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full ml-auto">
          {statuses.length} columns · {tasks.length} tasks
        </span>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div className="flex gap-5 p-6 h-full min-w-max items-start">
            {statuses.map((status) => (
              <Column
                key={status.id}
                status={status}
                tasks={tasksByStatus(status.id)}
                onCreateTask={createTask}
                onOpenTask={openTask}
              />
            ))}

            {/* Add column */}
            {addingStatus ? (
              <form onSubmit={addStatus} className="w-72 flex-shrink-0">
                <input
                  autoFocus
                  value={newStatusName}
                  onChange={(e) => setNewStatusName(e.target.value)}
                  onBlur={() => { if (!newStatusName.trim()) setAddingStatus(false); }}
                  onKeyDown={(e) => e.key === "Escape" && setAddingStatus(false)}
                  placeholder="Column name…"
                  className="w-full px-3 py-2 rounded-xl bg-card border border-accent/60 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-accent/40 shadow-[0_0_0_3px_rgba(249,115,22,0.08)]"
                />
              </form>
            ) : (
              <button
                onClick={() => setAddingStatus(true)}
                className="w-72 flex-shrink-0 h-11 flex items-center gap-2 px-4 rounded-xl border border-dashed border-border/60 text-muted-foreground/60 hover:border-accent/50 hover:text-accent hover:bg-accent/5 transition-all duration-200 text-sm group"
              >
                <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" />
                Add column
              </button>
            )}
          </div>

          <DragOverlay>
            {activeTask && <TaskCard task={activeTask} onOpen={() => {}} isDragging />}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Task detail panel */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          statuses={statuses}
          userId={userId}
          onClose={() => setSelectedTask(null)}
          onUpdated={onTaskUpdated}
          onDeleted={onTaskDeleted}
        />
      )}
    </div>
  );
}
