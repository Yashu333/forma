"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { useMediaQuery } from "@/lib/use-media-query";
import { ItemView } from "./Chips";
import { DayCard } from "./WeekAgenda";
import { keyToDate, type CalItem } from "./types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;
/** Dots a day shows on a phone, where chips don't fit; the picked day's list below the grid has them all. */
const MAX_DOTS = 4;

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
        <ItemView key={itemKey(item)} item={item} nowMs={nowMs} variant="chip" onOpen={onOpen} />
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

const itemKey = (item: CalItem) => (item.kind === "task" ? item.task.id : `g-${item.rec.id}-${item.date}`);

/**
 * Under sm: a compact cell (the date and a dot per item) that is one button,
 * picking the day whose list shows below the grid. Still a drop target.
 */
function CompactDayCell({ dayKey, month, today, items, picked, onPick }: {
  dayKey: string;
  month: string;
  today: string;
  items: CalItem[];
  picked: boolean;
  onPick: (key: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayKey}` });
  const isToday = dayKey === today;
  const inMonth = dayKey.startsWith(month);
  const count = items.length === 0 ? "nothing due" : `${items.length} ${items.length === 1 ? "task" : "tasks"}`;
  return (
    <div
      ref={setNodeRef}
      className={`min-w-0 overflow-hidden border-b border-r border-border ${isOver ? "bg-primary-soft" : inMonth ? "bg-surface" : "bg-background"}`}
      role="gridcell"
    >
      <button
        type="button"
        onClick={() => onPick(dayKey)}
        aria-pressed={picked}
        aria-label={`${format(keyToDate(dayKey), "EEEE d MMMM")}${isToday ? " (today)" : ""}, ${count}`}
        className={`w-full h-12 flex flex-col items-center justify-start gap-1 pt-1 focus-visible:-outline-offset-2 ${picked ? "ring-1 ring-inset ring-primary" : ""}`}
      >
        <span className={`text-xs tabular w-6 h-6 flex items-center justify-center rounded-md ${isToday ? "bg-primary-soft text-foreground font-semibold" : inMonth ? "text-muted-foreground" : "text-faint"}`}>
          {Number(dayKey.slice(8))}
        </span>
        {/* A dot per item in its project colour; a dashed ring for a repeat's next occurrence. */}
        <span className="flex flex-wrap justify-center gap-0.5" aria-hidden="true">
          {items.slice(0, MAX_DOTS).map((item) => (
            <span
              key={itemKey(item)}
              className={`w-1.5 h-1.5 rounded-full ${item.kind === "ghost" ? "border border-dashed border-border-strong" : ""}`}
              style={item.kind === "task" ? { background: item.task.group.color, opacity: item.task.done ? 0.4 : 1 } : undefined}
            />
          ))}
        </span>
      </button>
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

export default function MonthGrid(props: Props) {
  // Phones get compact cells and the picked day's list (chips don't fit 46px columns).
  const compact = useMediaQuery("(width < 40rem)");
  return compact ? <CompactMonth {...props} /> : <FullMonth {...props} />;
}

function CompactMonth({ days, month, today, nowMs, itemsByDay, onOpen, onAdd }: Props) {
  // The day whose items show below the grid: the one picked in this grid (any
  // of its days, the few from the months either side too), else today when
  // it's in this month, else the 1st. Showing another month drops the pick.
  const [pick, setPick] = useState<{ month: string; day: string } | null>(null);
  if (pick && pick.month !== month) setPick(null);
  const picked = pick && pick.month === month && days.includes(pick.day) ? pick.day : today.startsWith(month) ? today : `${month}-01`;
  const onPick = (day: string) => setPick({ month, day });
  return (
    <>
      <div role="grid" aria-label="Month" className="border-t border-l border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-7" role="row">
          {WEEKDAYS.map((d) => (
            <div key={d} role="columnheader" className="py-1.5 text-center text-xs font-semibold text-subtle border-b border-r border-border bg-surface">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((key) => (
            <CompactDayCell
              key={key}
              dayKey={key}
              month={month}
              today={today}
              items={itemsByDay.get(key) ?? []}
              picked={key === picked}
              onPick={onPick}
            />
          ))}
        </div>
      </div>
      <div className="mt-3">
        <DayCard dayKey={picked} today={today} nowMs={nowMs} items={itemsByDay.get(picked) ?? []} onOpen={onOpen} onAdd={onAdd} />
      </div>
    </>
  );
}

function FullMonth({ days, month, today, nowMs, itemsByDay, expandedDay, onExpand, onOpen, onAdd }: Props) {
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
