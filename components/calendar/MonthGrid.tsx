"use client";

import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { ItemView } from "./Chips";
import type { CalItem } from "./types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

interface CellProps {
  dayKey: string;
  month: string; // "YYYY-MM" being shown
  today: string;
  nowMs: number;
  items: CalItem[];
  expanded: boolean;
  onExpand: (key: string | null) => void;
  onOpen: (id: string) => void;
  onAdd: (key: string) => void;
}

function DayCell({ dayKey, month, today, nowMs, items, expanded, onExpand, onOpen, onAdd }: CellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayKey}` });
  const isToday = dayKey === today;
  const inMonth = dayKey.startsWith(month);
  const shown = expanded ? items : items.slice(0, MAX_CHIPS);
  const hidden = items.length - shown.length;

  return (
    <div
      ref={setNodeRef}
      className={`group/day min-w-0 overflow-hidden min-h-[7rem] border-b border-r border-border p-1.5 flex flex-col gap-1 ${isOver ? "bg-primary-soft" : inMonth ? "bg-surface" : "bg-background"}`}
      role="gridcell"
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-xs tabular w-6 h-6 flex items-center justify-center rounded-md ${isToday ? "bg-primary-soft text-foreground font-semibold" : inMonth ? "text-muted-foreground" : "text-faint"}`}
          aria-label={isToday ? `${Number(dayKey.slice(8))} (today)` : undefined}
        >
          {Number(dayKey.slice(8))}
        </span>
        {dayKey >= today && (
          <button
            type="button"
            onClick={() => onAdd(dayKey)}
            aria-label={`Add a task for ${dayKey}`}
            className="btn-icon !w-6 !h-6 !min-w-0 !min-h-0 opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {shown.map((item) => (
        <ItemView key={item.kind === "task" ? item.task.id : `g-${item.rec.id}-${item.date}`} item={item} nowMs={nowMs} variant="chip" onOpen={onOpen} />
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => onExpand(dayKey)} className="text-left text-xs text-subtle hover:text-foreground px-1">
          +{hidden} more
        </button>
      )}
      {expanded && items.length > MAX_CHIPS && (
        <button type="button" onClick={() => onExpand(null)} className="text-left text-xs text-subtle hover:text-foreground px-1">
          Show less
        </button>
      )}
    </div>
  );
}

interface Props {
  days: string[];
  month: string;
  today: string;
  nowMs: number;
  itemsByDay: Map<string, CalItem[]>;
  expandedDay: string | null;
  onExpand: (key: string | null) => void;
  onOpen: (id: string) => void;
  onAdd: (key: string) => void;
}

export default function MonthGrid({ days, month, today, nowMs, itemsByDay, expandedDay, onExpand, onOpen, onAdd }: Props) {
  return (
    <div role="grid" aria-label="Month" className="border-t border-l border-border rounded-lg overflow-hidden">
      <div className="grid grid-cols-7" role="row">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="px-2 py-1.5 text-xs font-semibold text-subtle border-b border-r border-border bg-surface">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((key) => (
          <DayCell
            key={key}
            dayKey={key}
            month={month}
            today={today}
            nowMs={nowMs}
            items={itemsByDay.get(key) ?? []}
            expanded={expandedDay === key}
            onExpand={onExpand}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        ))}
      </div>
    </div>
  );
}
