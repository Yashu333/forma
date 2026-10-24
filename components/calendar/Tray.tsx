"use client";

import { useMemo, useState } from "react";
import { TaskChip } from "./Chips";
import type { CalTask } from "./types";

// Open tasks with no due date. Drag one onto a day to schedule it.
export default function Tray({ tasks, onOpen }: { tasks: CalTask[]; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const byGroup = new Map<string, { name: string; color: string; tasks: CalTask[] }>();
    for (const t of tasks) {
      if (needle && !t.title.toLowerCase().includes(needle)) continue;
      const g = byGroup.get(t.group.id) ?? { name: t.group.name, color: t.group.color, tasks: [] };
      g.tasks.push(t);
      byGroup.set(t.group.id, g);
    }
    return [...byGroup.values()];
  }, [tasks, filter]);

  return (
    <aside className="hidden lg:flex flex-col w-72 flex-shrink-0 border-l border-border bg-surface min-h-0" aria-label="Unscheduled tasks">
      <div className="p-4 pb-2">
        <h2 className="text-sm font-semibold text-foreground">Unscheduled</h2>
        <p className="text-xs text-subtle mt-0.5">Drag a task onto a day to give it a due date.</p>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tasks"
          aria-label="Filter unscheduled tasks"
          className="forma-input mt-3 !py-1.5 !text-sm"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {groups.length === 0 && <p className="text-sm text-subtle mt-2">{tasks.length === 0 ? "Every open task has a date." : "No tasks match."}</p>}
        {groups.map((g) => (
          <div key={g.name} className="mt-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: g.color }} aria-hidden="true" />
              <span className="text-xs font-semibold text-muted-foreground truncate">{g.name}</span>
            </div>
            <div className="flex flex-col gap-1">
              {g.tasks.map((t) => <TaskChip key={t.id} task={t} overdue={false} variant="chip" onOpen={onOpen} />)}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
