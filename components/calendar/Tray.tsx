"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { TaskChip } from "./Chips";
import type { CalTask } from "./types";

// Open tasks with no due date. Drag one onto a day to schedule it.
// From lg up it's a column beside the calendar (Tray); under lg it's a bottom
// sheet opened from the calendar's header (TraySheet). Only one of them is
// mounted at a time: they'd register the same draggable ids.

function TrayBody({ tasks, onOpen, header, variant = "chip" }: { tasks: CalTask[]; onOpen: (id: string) => void; header?: React.ReactNode; variant?: "chip" | "row" }) {
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
    <>
      <div className="p-4 pb-2">
        {header ?? <h2 className="text-sm font-semibold text-foreground">Unscheduled</h2>}
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
              {g.tasks.map((t) => <TaskChip key={t.id} task={t} overdue={false} variant={variant} onOpen={onOpen} />)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function Tray({ tasks, onOpen }: { tasks: CalTask[]; onOpen: (id: string) => void }) {
  return (
    <aside className="hidden lg:flex flex-col w-72 flex-shrink-0 border-l border-border bg-surface min-h-0" aria-label="Unscheduled tasks">
      <TrayBody tasks={tasks} onOpen={onOpen} />
    </aside>
  );
}

/**
 * The tray as a bottom sheet (under lg). While one of its tasks is being
 * dragged (`dragging`) it stays mounted, so dnd-kit keeps the drag, but steps
 * out of the way so the days underneath can take the drop.
 */
export function TraySheet({ tasks, onOpen, onClose, dragging }: { tasks: CalTask[]; onOpen: (id: string) => void; onClose: () => void; dragging: boolean }) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Focus moves into the sheet and back to what opened it; Escape closes; Tab stays inside.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
      if (e.key !== "Tab" || !sheetRef.current) return;
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className={`fixed inset-0 z-50 flex flex-col justify-end transition-opacity ${dragging ? "opacity-0 pointer-events-none" : "animate-fade-in"}`}>
      <div className="absolute inset-0 bg-background/80" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Unscheduled tasks"
        tabIndex={-1}
        className="relative flex flex-col max-h-[75dvh] min-h-0 rounded-t-lg border-t border-border-strong bg-surface pb-safe px-safe outline-none animate-in-up"
      >
        <TrayBody
          tasks={tasks}
          onOpen={onOpen}
          variant="row"
          header={
            <div className="flex items-center justify-between gap-2 -mt-1">
              <h2 className="text-sm font-semibold text-foreground">Unscheduled</h2>
              <button type="button" className="btn-icon -mr-2" onClick={onClose} aria-label="Close">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}
