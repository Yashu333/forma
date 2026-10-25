"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Archive, Check, ChevronDown, GripVertical, Trash2, Undo2 } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useLocalClock } from "@/lib/frog/clock";
import { addDays } from "@/lib/frog/dates";
import { mondayOf, weekdayOf } from "@/lib/recurrence/rule";
import type { HabitDTO } from "./api";
import { useHabits } from "./useHabits";

const DAY_LETTERS: [number, string, string][] = [
  [1, "M", "Monday"], [2, "T", "Tuesday"], [3, "W", "Wednesday"], [4, "T", "Thursday"],
  [5, "F", "Friday"], [6, "S", "Saturday"], [0, "S", "Sunday"],
];

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function WeekdayChips({ value, onChange }: { value: number[]; onChange: (next: number[]) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Scheduled days">
      {DAY_LETTERS.map(([d, letter, name]) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            aria-label={name}
            title={name}
            onClick={() => {
              const next = on ? value.filter((x) => x !== d) : [...value, d];
              if (next.length > 0) onChange(next);
            }}
            className={`w-7 h-7 rounded-md border text-xs font-medium transition-colors max-lg:w-9 max-lg:h-9 ${on ? "border-primary bg-primary-soft text-foreground" : "border-border text-subtle hover:border-border-strong hover:text-foreground"}`}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}

// "Every day", "Weekdays", "Weekends", or "Mon, Wed, Fri".
function scheduleLabel(weekdays: number[]): string {
  const set = new Set(weekdays);
  if (set.size === 7) return "Every day";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return "Weekdays";
  if (set.size === 2 && set.has(0) && set.has(6)) return "Weekends";
  return DAY_LETTERS.filter(([d]) => set.has(d)).map(([, , name]) => name.slice(0, 3)).join(", ");
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-subtle">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-foreground tabular leading-tight">{value}</div>
      {hint && <div className="text-xs text-subtle tabular truncate">{hint}</div>}
    </div>
  );
}

function HabitCard({ habit, today, onToggle, onUpdate, onArchive, onDelete }: {
  habit: HabitDTO;
  today: string;
  onToggle: (date: string) => void;
  onUpdate: (body: { name?: string; weekdays?: number[] }) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: habit.id });
  const [editing, setEditing] = useState(false);
  const [editingDays, setEditingDays] = useState(false);
  const [name, setName] = useState(habit.name);
  const start = addDays(mondayOf(today), -28);
  const cells = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  const pct = habit.rate.scheduled ? Math.round((habit.rate.done / habit.rate.scheduled) * 100) : 0;
  const doneToday = habit.checks.includes(today);
  const streak = habit.streak.current;

  function commitName() {
    const next = name.trim();
    setEditing(false);
    if (next && next !== habit.name) onUpdate({ name: next });
    else setName(habit.name);
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.6 : 1, position: "relative", zIndex: isDragging ? 10 : undefined }}
      className="rounded-lg border border-border bg-surface p-4 sm:p-5 flex flex-col sm:flex-row gap-5"
    >
      <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${habit.name}`}
          className="btn-icon cursor-grab active:cursor-grabbing -ml-2"
          style={{ touchAction: "none" }}
        >
          <GripVertical className="w-4 h-4" aria-hidden="true" />
        </button>
        {editing ? (
          <input
            autoFocus
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") { setName(habit.name); setEditing(false); }
            }}
            aria-label="Habit name"
            className="forma-input !py-1 flex-1 min-w-0"
          />
        ) : (
          <button type="button" onClick={() => { setName(habit.name); setEditing(true); }} className="text-left text-sm font-semibold text-foreground truncate flex-1 min-w-0 hover:underline max-lg:min-h-11" title="Rename">
            {habit.name}
          </button>
        )}
        <button type="button" className="btn-icon" onClick={onArchive} aria-label={`Archive ${habit.name}`} title="Archive">
          <Archive className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" className="btn-icon hover:!text-danger" onClick={onDelete} aria-label={`Delete ${habit.name}`} title="Delete">
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setEditingDays((v) => !v)}
        aria-expanded={editingDays}
        className="mt-1 self-start inline-flex items-center gap-1 rounded-md text-xs text-subtle hover:text-foreground max-lg:mt-0 max-lg:min-h-11"
      >
        {scheduleLabel(habit.weekdays)}
        <ChevronDown className={`w-3 h-3 transition-transform ${editingDays ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {editingDays && (
        <div className="mt-2">
          <WeekdayChips value={habit.weekdays} onChange={(weekdays) => onUpdate({ weekdays })} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-4 max-w-sm">
        <Stat label="Streak" value={`${streak} ${streak === 1 ? "day" : "days"}`} />
        <Stat label="Best" value={`${habit.streak.longest} ${habit.streak.longest === 1 ? "day" : "days"}`} />
        <Stat
          label="Hit rate"
          value={habit.rate.scheduled ? `${pct}%` : "–"}
          hint={habit.rate.scheduled ? `${habit.rate.done} of ${habit.rate.scheduled} days` : "No days yet"}
        />
      </div>

      <div className="mt-auto pt-5">
        <button
          type="button"
          aria-pressed={doneToday}
          onClick={() => onToggle(today)}
          className={doneToday ? "btn-secondary !bg-success/15 !border-success/40 !text-success" : "btn-secondary"}
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          {doneToday ? "Done today" : "Mark today done"}
        </button>
      </div>
      </div>

      <div className="w-full sm:w-[15.5rem] shrink-0">
        <div className="grid grid-cols-7 gap-1" role="group" aria-label="Last five weeks">
          {DAY_LETTERS.map(([d, letter, name]) => (
            <span key={d} className="pb-0.5 text-[11px] text-center text-subtle" title={name} aria-hidden="true">{letter}</span>
          ))}
          {cells.map((d) => {
            const future = d > today;
            const ticked = habit.checks.includes(d);
            const scheduled = habit.weekdays.includes(weekdayOf(d));
            const date = keyToDate(d);
            const label = `${format(date, "EEE d MMM")}: ${ticked ? "done" : future ? "upcoming" : scheduled ? "not done" : "not scheduled"}`;
            return (
              <button
                key={d}
                type="button"
                role="checkbox"
                aria-checked={ticked}
                aria-label={label}
                title={label}
                disabled={future}
                onClick={() => onToggle(d)}
                className={`h-9 sm:h-8 rounded-md text-[11px] tabular transition-colors disabled:cursor-default ${
                  ticked
                    ? "bg-success text-primary-foreground font-semibold"
                    : future
                      ? "text-faint"
                      : d === today
                        ? "bg-primary-soft text-foreground font-semibold hover:bg-raised"
                        : scheduled
                          ? "bg-raised text-muted-foreground hover:bg-border"
                          : "text-subtle hover:bg-raised"
                }`}
              >
                {date.getDate() === 1 ? format(date, "MMM") : date.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    </li>
  );
}

export default function HabitsPage() {
  const clock = useLocalClock();
  if (!clock) return <div className="p-5 md:p-7 text-sm text-subtle" aria-busy="true">Loading habits…</div>;
  return <HabitsInner today={clock.date} tz={clock.tz} />;
}

function HabitsInner({ today, tz }: { today: string; tz: string }) {
  const { data, error, notice, setNotice, refresh, toggle, add, update, remove, move } = useHabits(today, tz);
  const [name, setName] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<HabitDTO | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    await add(trimmed, weekdays);
    setName("");
    setAdding(false);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || !data) return;
    const to = data.habits.findIndex((h) => h.id === over.id);
    if (to >= 0) void move(String(active.id), to);
  }

  const habits = data?.habits ?? [];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-5 md:p-7 max-w-3xl mx-auto text-foreground">
        <h1 className="text-[28px] sm:text-4xl font-semibold tracking-[-0.025em] leading-[1.1]">Habits</h1>
        <p className="text-sm mt-2 text-muted-foreground">Small things you do on set days. Tick them off on Today or here.</p>

        <form onSubmit={submit} className="mt-5 rounded-lg border border-border bg-surface p-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New habit, e.g. Read for 20 minutes"
              aria-label="New habit"
              maxLength={100}
              className="forma-input flex-1 min-w-[12rem]"
            />
            <button type="submit" className="btn-primary" disabled={!name.trim() || adding}>Add habit</button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-subtle">Repeats on</span>
            <WeekdayChips value={weekdays} onChange={setWeekdays} />
          </div>
        </form>

        {(error || notice) && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-danger">
            <span className="flex-1">{error ?? notice}</span>
            {error ? <button className="btn-secondary" onClick={() => void refresh()}>Retry</button> : <button className="btn-ghost" onClick={() => setNotice(null)}>Dismiss</button>}
          </div>
        )}

        {!data && !error && <p className="mt-6 text-sm text-subtle">Loading…</p>}
        {data && habits.length === 0 && (
          <p className="mt-6 text-sm text-muted-foreground">No habits yet. Add one above.</p>
        )}

        {habits.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={habits.map((h) => h.id)} strategy={verticalListSortingStrategy}>
              <ul className="mt-5 flex flex-col gap-3">
                {habits.map((h) => (
                  <HabitCard
                    key={h.id}
                    habit={h}
                    today={today}
                    onToggle={(date) => void toggle(h, date)}
                    onUpdate={(body) => void update(h.id, body)}
                    onArchive={() => void update(h.id, { archived: true })}
                    onDelete={() => setToDelete(h)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {data && data.archived.length > 0 && (
          <section className="mt-8" aria-label="Archived habits">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showArchived ? "" : "-rotate-90"}`} aria-hidden="true" />
              Archived <span className="tabular text-subtle">{data.archived.length}</span>
            </button>
            {showArchived && (
              <ul className="mt-2 flex flex-col gap-2">
                {data.archived.map((h) => (
                  <li key={h.id} className="rounded-lg border border-border bg-surface px-4 py-2.5 flex items-center gap-3">
                    <span className="text-sm text-muted-foreground flex-1 truncate">{h.name}</span>
                    <button type="button" className="btn-outline" onClick={() => void update(h.id, { archived: false })}>
                      <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Restore
                    </button>
                    <button type="button" className="btn-icon hover:!text-danger" aria-label={`Delete ${h.name}`} onClick={() => void remove(h.id)}>
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {toDelete && (
        <ConfirmDialog
          title="Delete habit?"
          message={`"${toDelete.name}" and its history will be deleted. Archive it instead to keep the history.`}
          confirmLabel="Delete habit"
          onConfirm={() => { const h = toDelete; setToDelete(null); void remove(h.id); }}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
