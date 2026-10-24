"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { format } from "date-fns";
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { Status, Task } from "@/types";
import TaskDetail from "@/components/task/TaskDetail";
import { openCommandPalette } from "@/components/command/CommandPalette";
import { useLocalClock } from "@/lib/frog/clock";
import { addDays, localDateKey } from "@/lib/frog/dates";
import { occurrencesBetween, parseRepeatRule } from "@/lib/recurrence/rule";
import { fetchCalendar, fetchTask, setDueDate } from "./api";
import { TaskChip } from "./Chips";
import MonthGrid from "./MonthGrid";
import Tray from "./Tray";
import WeekAgenda from "./WeekAgenda";
import { dueKeyOf, keyToDate, monthGrid, rescheduleIso, weekDays, type CalItem, type CalTask, type CalView, type CalendarPayload } from "./types";

const VIEW_KEY = "forma.calendar.view";

type Loaded = { key: string; data: CalendarPayload; nowMs: number };
type Failed = { key: string; error: string };

function shiftMonth(anchor: string, dir: number): string {
  const [y, m] = anchor.split("-").map(Number);
  const idx = y * 12 + (m - 1) + dir;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
}

export default function CalendarView({ userId }: { userId: string }) {
  const clock = useLocalClock();
  if (!clock) {
    return <div className="p-5 sm:p-7 text-sm text-subtle" aria-busy="true">Loading calendar…</div>;
  }
  return <CalendarInner userId={userId} today={clock.date} tz={clock.tz} />;
}

function CalendarInner({ userId, today, tz }: { userId: string; today: string; tz: string }) {
  const [view, setView] = useState<CalView>(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "month" || v === "week") return v;
    } catch {
      // storage blocked: fall through
    }
    return window.innerWidth < 640 ? "week" : "month";
  });
  const [anchor, setAnchor] = useState(today);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [nonce, setNonce] = useState(0);
  const [patches, setPatches] = useState<Record<string, string | null>>({});
  const [selected, setSelected] = useState<{ task: Task; statuses: Status[] } | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(view === "week");
  const [dragging, setDragging] = useState<CalTask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const days = useMemo(() => (view === "month" ? monthGrid(anchor) : weekDays(anchor)), [view, anchor]);
  const from = days[0];
  const to = days[days.length - 1];
  const rangeKey = `${from}|${to}|${nonce}`;

  useEffect(() => {
    const ctrl = new AbortController();
    fetchCalendar(from, to, tz, ctrl.signal)
      .then((data) => {
        setLoaded({ key: rangeKey, data, nowMs: Date.now() });
        setFailed(null);
        setPatches({});
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setFailed({ key: rangeKey, error: e instanceof Error ? e.message : "Couldn't load the calendar" });
      });
    return () => ctrl.abort();
  }, [from, to, tz, rangeKey]);

  // A task added from the command palette shows up without a reload.
  useEffect(() => {
    const reload = () => setNonce((n) => n + 1);
    window.addEventListener("task-created", reload);
    return () => window.removeEventListener("task-created", reload);
  }, []);

  const pool = useMemo<CalTask[]>(() => {
    if (!loaded) return [];
    const map = new Map<string, CalTask>();
    for (const t of [...loaded.data.tasks, ...loaded.data.overdue, ...loaded.data.unscheduled]) map.set(t.id, t);
    return [...map.values()].map((t) => (t.id in patches ? { ...t, dueDate: patches[t.id] } : t));
  }, [loaded, patches]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    const visible = new Set(days);
    const tasks = pool
      .filter((t) => t.dueDate)
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
    for (const task of tasks) {
      const key = dueKeyOf(task, tz);
      if (!key || !visible.has(key)) continue;
      (map.get(key) ?? map.set(key, []).get(key)!).push({ kind: "task", task });
    }
    for (const rec of loaded?.data.recurring ?? []) {
      const rule = parseRepeatRule(rec.repeat);
      if (!rule) continue;
      for (const date of occurrencesBetween(rule, localDateKey(new Date(rec.dueDate), tz), from, to)) {
        (map.get(date) ?? map.set(date, []).get(date)!).push({ kind: "ghost", rec, date });
      }
    }
    return map;
  }, [pool, loaded, days, tz, from, to]);

  const overdue = useMemo(
    () => pool.filter((t) => !t.done && t.dueDate && dueKeyOf(t, tz)! < today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
    [pool, tz, today],
  );
  const unscheduled = useMemo(() => pool.filter((t) => !t.done && !t.dueDate), [pool]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const open = useCallback(async (id: string) => {
    try {
      const task = await fetchTask(id);
      setSelected({ task, statuses: loaded?.data.statusesByGroup[task.groupId] ?? [] });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't open that task");
    }
  }, [loaded]);

  function onDragStart(e: DragStartEvent) {
    setDragging(pool.find((t) => `task:${t.id}` === e.active.id) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const overId = e.over ? String(e.over.id) : "";
    if (!overId.startsWith("day:")) return;
    const id = String(e.active.id).replace(/^task:/, "");
    const task = pool.find((t) => t.id === id);
    if (!task) return;
    const dayKey = overId.slice(4);
    if (dueKeyOf(task, tz) === dayKey) return;
    const iso = rescheduleIso(task, dayKey);
    const previous = task.id in patches ? patches[task.id] : undefined;
    setPatches((p) => ({ ...p, [id]: iso }));
    setNotice(null);
    try {
      await setDueDate(id, iso);
    } catch (err) {
      setPatches((p) => {
        const next = { ...p };
        if (previous === undefined) delete next[id];
        else next[id] = previous;
        return next;
      });
      setNotice(err instanceof Error ? err.message : "Couldn't reschedule that task");
    }
  }

  function setViewAndStore(v: CalView) {
    setView(v);
    setExpandedDay(null);
    setOverdueOpen(v === "week");
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage blocked: the choice just won't be remembered
    }
  }

  function shift(dir: number) {
    setExpandedDay(null);
    setAnchor((a) => (view === "month" ? shiftMonth(a, dir) : addDays(a, dir * 7)));
  }

  const title = view === "month"
    ? format(keyToDate(anchor), "MMMM yyyy")
    : `${format(keyToDate(from), "d MMM")} – ${format(keyToDate(to), "d MMM yyyy")}`;
  const isLoading = !loaded || loaded.key !== rangeKey;
  const error = failed && failed.key === rangeKey ? failed.error : null;
  const nowMs = loaded?.nowMs ?? 0; // "now" as of the last load, for the overdue colour

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="flex h-full text-foreground">
        <div className="flex-1 min-w-0 overflow-y-auto p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.025em] mr-auto" aria-live="polite">{title}</h1>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-icon" onClick={() => shift(-1)} aria-label={view === "month" ? "Previous month" : "Previous week"}>
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setAnchor(today); setExpandedDay(null); }}>Today</button>
              <button type="button" className="btn-icon" onClick={() => shift(1)} aria-label={view === "month" ? "Next month" : "Next week"}>
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden" role="group" aria-label="View">
              {(["month", "week"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setViewAndStore(v)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === v ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-raised"}`}
                >
                  {v === "month" ? "Month" : "Week"}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-danger">
              <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              <span className="flex-1">{error}</span>
              <button type="button" className="btn-secondary" onClick={() => setNonce((n) => n + 1)}>
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {notice && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-danger">
              <span className="flex-1">{notice}</span>
              <button type="button" className="btn-ghost" onClick={() => setNotice(null)}>Dismiss</button>
            </div>
          )}

          {overdue.length > 0 && (
            <section className="mb-4 rounded-lg border border-border bg-surface" aria-label="Overdue tasks">
              <button
                type="button"
                onClick={() => setOverdueOpen((v) => !v)}
                aria-expanded={overdueOpen}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-foreground"
              >
                <ChevronDown className={`w-4 h-4 text-subtle transition-transform ${overdueOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
                Overdue
                <span className="text-danger tabular">{overdue.length}</span>
              </button>
              {overdueOpen && (
                <div className="flex flex-col gap-1.5 px-3 pb-3">
                  {overdue.map((t) => <TaskChip key={t.id} task={t} overdue variant="row" onOpen={open} />)}
                </div>
              )}
            </section>
          )}

          <div className={isLoading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={isLoading}>
            {view === "month" ? (
              <MonthGrid
                days={days}
                month={anchor.slice(0, 7)}
                today={today}
                nowMs={nowMs}
                itemsByDay={itemsByDay}
                expandedDay={expandedDay}
                onExpand={setExpandedDay}
                onOpen={open}
                onAdd={(key) => openCommandPalette("add", `${key} `)}
              />
            ) : (
              <WeekAgenda days={days} today={today} nowMs={nowMs} itemsByDay={itemsByDay} onOpen={open} onAdd={(key) => openCommandPalette("add", `${key} `)} />
            )}
          </div>
        </div>

        <Tray tasks={unscheduled} onOpen={open} />
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="rounded-md bg-raised border border-border-strong px-2 py-1 text-xs text-foreground max-w-[14rem] truncate" style={{ borderLeft: `3px solid ${dragging.group.color}` }}>
            {dragging.title}
          </div>
        )}
      </DragOverlay>

      {selected && (
        <TaskDetail
          task={selected.task}
          statuses={selected.statuses}
          userId={userId}
          onClose={() => setSelected(null)}
          onUpdated={(t) => { setSelected((s) => (s ? { ...s, task: t } : s)); setNonce((n) => n + 1); }}
          onDeleted={() => { setSelected(null); setNonce((n) => n + 1); }}
        />
      )}
    </DndContext>
  );
}
