"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, TouchSensor, closestCenter, pointerWithin, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { format } from "date-fns";
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type { Status, Task } from "@/types";
import TaskDetail from "@/components/task/TaskDetail";
import { openCommandPalette } from "@/components/command/CommandPalette";
import { useLocalClock } from "@/lib/frog/clock";
import { MouseAndPenSensor, centerOnPointer } from "@/lib/dnd-touch";
import { UNDER_LG_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { addDays, localDateKey } from "@/lib/frog/dates";
import { occurrencesBetween, parseRepeatRule } from "@/lib/recurrence/rule";
import { compareTasks } from "@/lib/frog/abcde";
import { fetchCalendar, fetchTask, setDueDate, setPlannedFor, setTimeBlock } from "./api";
import { TaskChip } from "./Chips";
import DayPlanner, { HOUR_PX } from "./DayPlanner";
import MonthGrid from "./MonthGrid";
import Tray, { TraySheet } from "./Tray";
import WeekAgenda from "./WeekAgenda";
import {
  DEFAULT_BLOCK, DAY_MINUTES, SNAP, WORKDAY_START, blockLength, dueKeyOf, keyToDate, minutesOfDay, monthGrid, nextFreeStart, rescheduleIso, slotIso, snap, weekDays,
  type CalItem, type CalTask, type CalView, type CalendarPayload, type Span,
} from "./types";

const VIEW_KEY = "forma.calendar.view";
// Under lg the dragged pill sits under the finger, and the day nearest the finger takes the drop
// (a row in the Unscheduled sheet is as wide as the screen; its centre is nowhere near the finger).
const NARROW_MODIFIERS = [centerOnPointer];

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
    // `?view=day` (the Today page's "Plan hours" link) wins over the remembered view.
    const asked = new URLSearchParams(window.location.search).get("view");
    if (asked === "month" || asked === "week" || asked === "day") return asked;
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "month" || v === "week" || v === "day") return v;
    } catch {
      // storage blocked: fall through
    }
    return window.innerWidth < 640 ? "week" : "month";
  });
  const [anchor, setAnchor] = useState(today);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [nonce, setNonce] = useState(0);
  // Optimistic edits (due dates, time blocks) layered over the loaded tasks.
  const [patches, setPatches] = useState<Record<string, Partial<CalTask>>>({});
  const [selected, setSelected] = useState<{ task: Task; statuses: Status[] } | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(view === "week");
  const [dragging, setDragging] = useState<CalTask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ start: number; minutes: number } | null>(null);
  const [filling, setFilling] = useState(false);
  // Under lg the unscheduled tray is a bottom sheet, opened from the header.
  const narrow = useMediaQuery(UNDER_LG_QUERY);
  const [trayOpen, setTrayOpen] = useState(false);
  const closeTray = useCallback(() => setTrayOpen(false), []);
  // Grown past lg (a rotated tablet, a wider window): the sheet is gone, so is its open state;
  // otherwise it would pop up again on the way back under lg.
  if (trayOpen && !narrow) setTrayOpen(false);
  // Where the pointer grabbed a block, in minutes from its top, so a moved block lands under the pointer.
  const grabOffset = useRef(0);

  const days = useMemo(() => (view === "month" ? monthGrid(anchor) : view === "week" ? weekDays(anchor) : [anchor]), [view, anchor]);
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
    for (const t of [...loaded.data.tasks, ...loaded.data.overdue, ...loaded.data.unscheduled, ...loaded.data.blocks, ...loaded.data.planned]) map.set(t.id, t);
    return [...map.values()].map((t) => (t.id in patches ? { ...t, ...patches[t.id] } : t));
  }, [loaded, patches]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    const visible = new Set(days);
    // Each task shows once, on the day you'll do it: its time block's day, else
    // the day it's planned for, else its due date (the same rule as Today and
    // the Day view). A due date on another day is noted on the chip. Timed
    // items first, in time order; untimed ones (planned, no block) after.
    const placed: { key: string; at: number; item: CalItem }[] = [];
    for (const task of pool) {
      const blockKey = task.scheduledAt ? localDateKey(new Date(task.scheduledAt), tz) : null;
      const dueKey = dueKeyOf(task, tz);
      const via = blockKey ? "block" : task.plannedFor ? "plan" : "due";
      const key = blockKey ?? task.plannedFor ?? dueKey;
      if (!key || !visible.has(key)) continue;
      const dueNote = dueKey && dueKey !== key
        ? { label: format(keyToDate(dueKey), "EEE d MMM"), overdue: dueKey < today }
        : undefined;
      const at = via === "block" ? new Date(task.scheduledAt!).getTime() : via === "due" ? new Date(task.dueDate!).getTime() : Number.MAX_SAFE_INTEGER;
      placed.push({ key, at, item: { kind: "task", task, via, dueNote } });
    }
    for (const { key, item } of placed.sort((a, b) => a.at - b.at)) {
      (map.get(key) ?? map.set(key, []).get(key)!).push(item);
    }
    for (const rec of loaded?.data.recurring ?? []) {
      const rule = parseRepeatRule(rec.repeat);
      if (!rule) continue;
      for (const date of occurrencesBetween(rule, localDateKey(new Date(rec.dueDate), tz), from, to)) {
        (map.get(date) ?? map.set(date, []).get(date)!).push({ kind: "ghost", rec, date });
      }
    }
    return map;
  }, [pool, loaded, days, tz, from, to, today]);

  const overdue = useMemo(
    () => pool.filter((t) => !t.done && t.dueDate && dueKeyOf(t, tz)! < today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
    [pool, tz, today],
  );
  const unscheduled = useMemo(() => pool.filter((t) => !t.done && !t.dueDate), [pool]);

  // Day view: the day's time blocks, and its planned or due tasks that don't have one yet (frog first).
  const dayKey = anchor;
  const frogId = loaded?.data.frogs[dayKey] ?? null;
  const dayBlocks = useMemo(
    () => (view === "day" ? pool.filter((t) => t.scheduledAt && localDateKey(new Date(t.scheduledAt), tz) === dayKey) : []),
    [view, pool, tz, dayKey],
  );
  const dayList = useMemo(() => {
    if (view !== "day") return [];
    const blocked = new Set(dayBlocks.map((t) => t.id));
    return pool
      .filter((t) => !blocked.has(t.id) && (t.plannedFor === dayKey || (!t.done && dueKeyOf(t, tz) === dayKey)))
      .sort((a, b) => Number(b.id === frogId) - Number(a.id === frogId) || Number(a.done) - Number(b.done) || compareTasks(a, b));
  }, [view, pool, dayBlocks, dayKey, tz, frogId]);
  const spans = (except?: string): Span[] =>
    dayBlocks.filter((t) => t.id !== except).map((t) => {
      const start = minutesOfDay(t.scheduledAt!);
      return { id: t.id, start, end: start + blockLength(t) };
    });
  /** Where "next free slot" starts looking: now (today) or 9 am (a later day). */
  const searchFrom = () => {
    if (dayKey !== today) return WORKDAY_START;
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  };

  function patch(id: string, fields: Partial<CalTask>) {
    setPatches((p) => ({ ...p, [id]: { ...p[id], ...fields } }));
  }
  function rollback(id: string, previous: Partial<CalTask> | undefined) {
    setPatches((p) => {
      const next = { ...p };
      if (previous === undefined) delete next[id];
      else next[id] = previous;
      return next;
    });
  }

  /** Puts a task in a time block on `day` (the day shown by default), optimistically. A task with no plan day joins that day's list. */
  async function saveBlock(task: CalTask, start: number, minutes: number, day = dayKey) {
    const previous = patches[task.id];
    const scheduledAt = slotIso(day, start);
    const plannedFor = task.plannedFor ? undefined : day;
    const fields = { scheduledAt, blockMinutes: minutes, ...(plannedFor && { plannedFor }) };
    patch(task.id, fields);
    setNotice(null);
    try {
      await setTimeBlock(task.id, fields);
    } catch (err) {
      rollback(task.id, previous);
      setNotice(err instanceof Error ? err.message : "Couldn't save that time block");
    }
  }

  async function unschedule(task: CalTask) {
    const previous = patches[task.id];
    patch(task.id, { scheduledAt: null });
    setNotice(null);
    try {
      await setTimeBlock(task.id, { scheduledAt: null });
    } catch (err) {
      rollback(task.id, previous);
      setNotice(err instanceof Error ? err.message : "Couldn't remove that time block");
    }
  }

  /** The length a task's block will get, chosen in the list before it's placed. */
  async function setLength(task: CalTask, minutes: number) {
    const previous = patches[task.id];
    patch(task.id, { blockMinutes: minutes });
    setNotice(null);
    try {
      await setTimeBlock(task.id, { blockMinutes: minutes });
    } catch (err) {
      rollback(task.id, previous);
      setNotice(err instanceof Error ? err.message : "Couldn't save that length");
    }
  }

  function placeNext(task: CalTask) {
    const minutes = blockLength(task);
    const start = nextFreeStart(spans(), minutes, searchFrom());
    if (start === null) setNotice("No free slot left on this day for that task.");
    else void saveBlock(task, start, minutes);
  }

  // Frog first, then A to C in order; D (delegate) and E (eliminate) stay off the timeline.
  async function fillDay() {
    setFilling(true);
    const taken = spans();
    const from = searchFrom();
    const saves: Promise<void>[] = [];
    let skipped = 0;
    for (const task of dayList) {
      if (task.done || task.abcde === "D" || task.abcde === "E") continue;
      const minutes = blockLength(task);
      const start = nextFreeStart(taken, minutes, from);
      if (start === null) {
        skipped++;
        continue;
      }
      taken.push({ id: task.id, start, end: start + minutes });
      saves.push(saveBlock(task, start, minutes));
    }
    await Promise.all(saves);
    setFilling(false);
    if (skipped > 0) setNotice(`${skipped} ${skipped === 1 ? "task doesn't" : "tasks don't"} fit before midnight.`);
  }

  const sensors = useSensors(
    // Mouse and pen start a drag after 5px; a finger has to hold for 200ms, so a swipe scrolls.
    useSensor(MouseAndPenSensor, { activationConstraint: { distance: 5 } }),
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

  const idOf = (activeId: string | number) => String(activeId).replace(/^(task|block|sched|plan):/, "");

  function onDragStart(e: DragStartEvent) {
    setDragging(pool.find((t) => t.id === idOf(e.active.id)) ?? null);
    grabOffset.current = 0;
    const initial = e.active.rect.current.initial;
    if (String(e.active.id).startsWith("block:") && initial) {
      const ev = e.activatorEvent as PointerEvent | TouchEvent;
      const y = "touches" in ev ? ev.touches[0]?.clientY : ev.clientY;
      if (typeof y === "number") grabOffset.current = Math.max(0, (y - initial.top) / (HOUR_PX / 60));
    }
  }

  /** Start minute of a drop on a timeline slot, or null when it isn't over one. */
  function slotStart(overId: string, task: CalTask, isBlock: boolean): number | null {
    if (!overId.startsWith("slot:")) return null;
    const minute = Number(overId.split("|")[1]);
    const start = isBlock ? snap(minute - grabOffset.current + SNAP / 2) : minute;
    return Math.max(0, Math.min(start, DAY_MINUTES - Math.max(SNAP, blockLength(task))));
  }

  function onDragOver(e: DragOverEvent) {
    const overId = e.over ? String(e.over.id) : "";
    const start = dragging ? slotStart(overId, dragging, String(e.active.id).startsWith("block:")) : null;
    setPreview(dragging && start !== null ? { start, minutes: blockLength(dragging) } : null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    setPreview(null);
    setTrayOpen(false); // a task dragged out of the sheet has landed (or not); show the calendar
    const overId = e.over ? String(e.over.id) : "";
    if (overId.startsWith("slot:")) {
      const task = pool.find((t) => t.id === idOf(e.active.id));
      const isBlock = String(e.active.id).startsWith("block:");
      const start = task ? slotStart(overId, task, isBlock) : null;
      if (!task || start === null) return;
      if (isBlock && task.scheduledAt && minutesOfDay(task.scheduledAt) === start) return;
      await saveBlock(task, start, task.blockMinutes ?? DEFAULT_BLOCK);
      return;
    }
    if (!overId.startsWith("day:")) return;
    const id = idOf(e.active.id);
    const task = pool.find((t) => t.id === id);
    if (!task) return;
    const dayKey = overId.slice(4);
    // A time block chip moves the block to that day, same time.
    if (String(e.active.id).startsWith("sched:") && task.scheduledAt) {
      if (localDateKey(new Date(task.scheduledAt), tz) !== dayKey) await saveBlock(task, minutesOfDay(task.scheduledAt), blockLength(task), dayKey);
      return;
    }
    // A planned chip moves the task to that day's plan; its due date stays.
    if (String(e.active.id).startsWith("plan:")) {
      if (task.plannedFor === dayKey) return;
      const previous = patches[task.id];
      patch(id, { plannedFor: dayKey });
      setNotice(null);
      try {
        await setPlannedFor(id, dayKey);
      } catch (err) {
        rollback(id, previous);
        setNotice(err instanceof Error ? err.message : "Couldn't move that task");
      }
      return;
    }
    if (dueKeyOf(task, tz) === dayKey) return;
    const iso = rescheduleIso(task, dayKey);
    const previous = patches[task.id];
    patch(id, { dueDate: iso });
    setNotice(null);
    try {
      await setDueDate(id, iso);
    } catch (err) {
      rollback(id, previous);
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
    setAnchor((a) => (view === "month" ? shiftMonth(a, dir) : addDays(a, dir * (view === "week" ? 7 : 1))));
  }

  const title = view === "month"
    ? format(keyToDate(anchor), "MMMM yyyy")
    : view === "week"
      ? `${format(keyToDate(from), "d MMM")} – ${format(keyToDate(to), "d MMM yyyy")}`
      : format(keyToDate(anchor), "EEEE d MMMM");
  const unit = view === "month" ? "month" : view === "week" ? "week" : "day";
  const isLoading = !loaded || loaded.key !== rangeKey;
  const error = failed && failed.key === rangeKey ? failed.error : null;
  const nowMs = loaded?.nowMs ?? 0; // "now" as of the last load, for the overdue colour

  return (
    <DndContext
      sensors={sensors}
      modifiers={narrow ? NARROW_MODIFIERS : undefined}
      collisionDetection={view === "day" ? pointerWithin : closestCenter}
      onDragStart={onDragStart}
      onDragOver={view === "day" ? onDragOver : undefined}
      onDragEnd={onDragEnd}
      onDragCancel={() => { setDragging(null); setPreview(null); }}
    >
      <div className="flex h-full text-foreground">
        <div className="flex-1 min-w-0 overflow-y-auto p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {/* Under sm a slightly smaller title lets a month's name share its row with the arrows,
                and the view switch and Unscheduled share the next one. */}
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.025em] mr-auto max-sm:text-[22px]" aria-live="polite">{title}</h1>
            <div className="flex items-center gap-1">
              <button type="button" className="btn-icon" onClick={() => shift(-1)} aria-label={`Previous ${unit}`}>
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setAnchor(today); setExpandedDay(null); }}>Today</button>
              <button type="button" className="btn-icon" onClick={() => shift(1)} aria-label={`Next ${unit}`}>
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden" role="group" aria-label="View">
              {(["month", "week", "day"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setViewAndStore(v)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors max-sm:px-2.5 ${view === v ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-raised"}`}
                >
                  {v === "month" ? "Month" : v === "week" ? "Week" : "Day"}
                </button>
              ))}
            </div>
            {narrow && view !== "day" && (
              <button type="button" className="btn-secondary max-sm:!px-3" onClick={() => setTrayOpen(true)} aria-haspopup="dialog" aria-expanded={trayOpen}>
                Unscheduled <span className="tabular text-subtle">{unscheduled.length}</span>
              </button>
            )}
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
            ) : view === "week" ? (
              <WeekAgenda days={days} today={today} nowMs={nowMs} itemsByDay={itemsByDay} onOpen={open} onAdd={(key) => openCommandPalette("add", `${key} `)} />
            ) : (
              <DayPlanner
                dayKey={dayKey}
                today={today}
                blocks={dayBlocks}
                list={dayList}
                frogId={frogId}
                preview={preview}
                filling={filling}
                onOpen={open}
                onSetBlock={saveBlock}
                onUnschedule={unschedule}
                onPlaceNext={placeNext}
                onSetLength={setLength}
                onFill={fillDay}
              />
            )}
          </div>
        </div>

        {view !== "day" && !narrow && <Tray tasks={unscheduled} onOpen={open} />}
      </div>

      {view !== "day" && narrow && trayOpen && (
        <TraySheet
          tasks={unscheduled}
          onOpen={(id) => { setTrayOpen(false); void open(id); }}
          onClose={closeTray}
          dragging={dragging !== null}
        />
      )}

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
