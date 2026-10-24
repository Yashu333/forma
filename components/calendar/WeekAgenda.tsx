"use client";

import { useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { ItemView } from "./Chips";
import { keyToDate, type CalItem } from "./types";

interface DayProps {
  dayKey: string;
  today: string;
  nowMs: number;
  items: CalItem[];
  onOpen: (id: string) => void;
  onAdd: (key: string) => void;
}

function DaySection({ dayKey, today, nowMs, items, onOpen, onAdd }: DayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayKey}` });
  const isToday = dayKey === today;
  return (
    <section
      ref={setNodeRef}
      aria-label={format(keyToDate(dayKey), "EEEE d MMMM")}
      className={`rounded-lg border p-3 ${isOver ? "border-primary bg-primary-soft" : "border-border bg-surface"}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-foreground">{format(keyToDate(dayKey), "EEE d MMM")}</h3>
        {isToday && <span className="text-xs text-foreground bg-primary-soft rounded-md px-1.5 py-0.5">Today</span>}
        {dayKey >= today && (
          <button type="button" onClick={() => onAdd(dayKey)} className="btn-icon ml-auto" aria-label={`Add a task for ${dayKey}`}>
            <Plus className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-subtle">Nothing due</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((item) => (
            <ItemView key={item.kind === "task" ? item.task.id : `g-${item.rec.id}-${item.date}`} item={item} nowMs={nowMs} variant="row" onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

interface Props {
  days: string[];
  today: string;
  nowMs: number;
  itemsByDay: Map<string, CalItem[]>;
  onOpen: (id: string) => void;
  onAdd: (key: string) => void;
}

export default function WeekAgenda({ days, today, nowMs, itemsByDay, onOpen, onAdd }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {days.map((key) => (
        <DaySection key={key} dayKey={key} today={today} nowMs={nowMs} items={itemsByDay.get(key) ?? []} onOpen={onOpen} onAdd={onAdd} />
      ))}
    </div>
  );
}
