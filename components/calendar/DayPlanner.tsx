"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CalendarPlus, Timer, X } from "lucide-react";
import { ABCDE_META } from "@/lib/frog/abcde";
import { AbcdeBadge, FrogIcon } from "@/components/today/bits";
import { DAY_MINUTES, SNAP, blockLength, clockText, durationText, layoutBlocks, minutesOfDay, snap, type CalTask } from "./types";

// The Day view: an hour-by-hour timeline of time blocks next to the day's
// list. Drag a task from the list onto a time to block it; drag a block to
// move it; change its length from its menu or by pulling its bottom edge.

/** Height of one hour on the timeline. */
export const HOUR_PX = 96;
const PX = HOUR_PX / 60;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const SLOTS = Array.from({ length: DAY_MINUTES / SNAP }, (_, i) => i * SNAP);
/** Minutes of the shortest block as drawn: enough height for its row. */
const MIN_DRAWN = 15;

interface Props {
  dayKey: string;
  today: string;
  blocks: CalTask[];
  list: CalTask[];
  frogId: string | null;
  /** Where the dragged task would land. */
  preview: { start: number; minutes: number } | null;
  filling: boolean;
  onOpen: (id: string) => void;
  onSetBlock: (task: CalTask, start: number, minutes: number) => void;
  onUnschedule: (task: CalTask) => void;
  onPlaceNext: (task: CalTask) => void;
  /** Sets how long a task's block will be, before it's on the timeline. */
  onSetLength: (task: CalTask, minutes: number) => void;
  onFill: () => void;
}

export default function DayPlanner({ dayKey, today, blocks, list, frogId, preview, filling, onOpen, onSetBlock, onUnschedule, onPlaceNext, onSetLength, onFill }: Props) {
  const isToday = dayKey === today;
  const isPast = dayKey < today;
  const nowMin = useNowMinutes(isToday);
  const scrollRef = useRef<HTMLDivElement>(null);

  const placed = useMemo(() => {
    const spans = blocks.map((t) => {
      const start = minutesOfDay(t.scheduledAt!);
      return { id: t.id, start, end: Math.min(start + blockLength(t), DAY_MINUTES), task: t };
    });
    // A 5 or 10 minute block is drawn as tall as 15 minutes (one row of text), so
    // columns are worked out from the drawn height: short blocks never cover each other.
    const cols = layoutBlocks(spans.map((s) => ({ ...s, end: Math.max(s.end, s.start + MIN_DRAWN) })));
    return spans.map((s) => ({ ...s, ...cols.get(s.id)! }));
  }, [blocks]);

  // Open on the hour before now (today), the first block, or 8 am.
  const firstStart = placed.length > 0 ? Math.min(...placed.map((p) => p.start)) : null;
  useLayoutEffect(() => {
    const target = isToday && nowMin !== null ? nowMin - 60 : firstStart !== null ? firstStart - 30 : 8 * 60;
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, target * PX);
    // Only when the day changes, not on every block edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  const fillable = !isPast && list.some((t) => !t.done && t.abcde !== "D" && t.abcde !== "E");
  const totalBlocked = placed.reduce((sum, p) => sum + (p.end - p.start), 0);

  return (
    <div className="flex flex-col lg:flex-row-reverse gap-4">
      <aside className="lg:w-72 flex-shrink-0 rounded-lg border border-border bg-surface p-4 self-start w-full" aria-label="Tasks to schedule">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">To schedule</h2>
          {totalBlocked > 0 && <span className="text-xs text-subtle tabular">{durationText(totalBlocked)} blocked</span>}
        </div>
        <p className="text-xs text-subtle mt-0.5">Pick how long each task takes, then drag it onto a time or use + to put it in the next free slot.</p>

        {fillable && (
          <>
            <button type="button" className="btn-primary w-full justify-center mt-3" onClick={onFill} disabled={filling}>
              {filling ? "Filling…" : "Fill my day"}
            </button>
            <p className="text-xs text-subtle mt-1.5">Frog first, then A to C in order. D and E tasks are left out.</p>
          </>
        )}

        <div className="flex flex-col gap-1.5 mt-3">
          {list.length === 0 ? (
            <p className="text-sm text-subtle">
              {blocks.length > 0 ? "Everything planned has a time." : "Nothing planned for this day."}
              {isToday && blocks.length === 0 && (
                <> <Link href="/today" className="underline text-muted-foreground hover:text-foreground">Plan your day</Link></>
              )}
            </p>
          ) : (
            list.map((t) => <ListItem key={t.id} task={t} isFrog={t.id === frogId} canPlace={!isPast} onOpen={onOpen} onPlaceNext={onPlaceNext} onSetLength={onSetLength} />)
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0 rounded-lg border border-border bg-surface overflow-hidden">
        <div ref={scrollRef} className="overflow-y-auto max-h-[calc(100vh-12rem)] min-h-[24rem]">
          <div className="relative flex" style={{ height: DAY_MINUTES * PX }}>
            {/* Hour labels */}
            <div className="w-16 flex-shrink-0 relative" aria-hidden="true">
              {HOURS.map((h) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 font-mono text-[11px] text-subtle" style={{ top: h * HOUR_PX }}>
                  {h === 0 ? "" : clockText(h * 60).replace(":00", "")}
                </span>
              ))}
            </div>

            {/* Lane: hour lines, drop slots, blocks */}
            <div className="relative flex-1 border-l border-border">
              {HOURS.map((h) => (
                <div key={h} className="absolute inset-x-0 border-t border-border" style={{ top: h * HOUR_PX }} aria-hidden="true" />
              ))}
              {SLOTS.map((min) => <Slot key={min} dayKey={dayKey} minute={min} />)}

              {preview && (
                <div
                  className="absolute inset-x-1 rounded-md border border-dashed border-border-strong bg-primary-soft px-2 py-0.5 text-[11px] font-mono text-muted-foreground pointer-events-none"
                  style={{ top: preview.start * PX, height: Math.max(Math.min(preview.minutes, DAY_MINUTES - preview.start) * PX, 16) }}
                >
                  {clockText(preview.start)}
                </div>
              )}

              {placed.map((p) => (
                <Block
                  key={p.id}
                  task={p.task}
                  start={p.start}
                  minutes={p.end - p.start}
                  col={p.col}
                  cols={p.cols}
                  isFrog={p.id === frogId}
                  past={isPast || (isToday && nowMin !== null && p.end <= nowMin)}
                  onOpen={onOpen}
                  onSetBlock={onSetBlock}
                  onUnschedule={onUnschedule}
                />
              ))}

              {isToday && nowMin !== null && (
                <div className="absolute inset-x-0 pointer-events-none z-10" style={{ top: nowMin * PX }} aria-hidden="true">
                  <div className="h-0.5 bg-primary" />
                  <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-primary" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Minutes since midnight, ticking every minute (only while the day shown is today). */
function useNowMinutes(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [active]);
  return active ? now : null;
}

function Slot({ dayKey, minute }: { dayKey: string; minute: number }) {
  const { setNodeRef } = useDroppable({ id: `slot:${dayKey}|${minute}` });
  return <div ref={setNodeRef} className="absolute inset-x-0" style={{ top: minute * PX, height: SNAP * PX }} aria-hidden="true" />;
}

interface BlockProps {
  task: CalTask;
  start: number;
  minutes: number;
  col: number;
  cols: number;
  isFrog: boolean;
  past: boolean;
  onOpen: (id: string) => void;
  onSetBlock: (task: CalTask, start: number, minutes: number) => void;
  onUnschedule: (task: CalTask) => void;
}

function Block({ task, start, minutes, col, cols, isFrog, past, onOpen, onSetBlock, onUnschedule }: BlockProps) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `block:${task.id}` });
  const resize = useRef<{ y0: number; m0: number } | null>(null);
  const [resizeTo, setResizeTo] = useState<number | null>(null);
  const len = resizeTo ?? minutes;
  const maxLen = DAY_MINUTES - start;
  const color = task.abcde ? ABCDE_META[task.abcde].color : task.group.color;
  const label = `${task.title}, ${clockText(start)} to ${clockText(start + len)}`;

  function commitLength(next: number) {
    const clamped = Math.max(SNAP, Math.min(maxLen, next));
    if (clamped !== minutes) onSetBlock(task, start, clamped);
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className={`group/block absolute rounded-md border border-border hover:border-border-strong bg-raised transition-colors overflow-hidden ${task.done ? "text-faint" : "text-foreground"}`}
      style={{
        top: start * PX + 1,
        height: Math.max(len, MIN_DRAWN) * PX - 2,
        left: `calc(${(col / cols) * 100}% + 4px)`,
        width: `calc(${100 / cols}% - 8px)`,
        borderLeft: `3px solid ${color}`,
        opacity: isDragging ? 0.4 : past && !task.done ? 0.75 : 1,
        zIndex: resizeTo !== null ? 20 : 1,
      }}
    >
      {/* One row that fits a 15 minute block: title, length, focus, remove. */}
      <div className="flex items-center gap-1 pl-2 pr-1 h-5 mt-px min-w-0">
        {isFrog && <span className="flex-shrink-0" title="Today's frog"><FrogIcon className="w-3.5 h-3.5" /></span>}
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          onKeyDown={(e) => {
            if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
            e.preventDefault();
            const next = Math.max(0, Math.min(DAY_MINUTES - minutes, start + (e.key === "ArrowUp" ? -SNAP : SNAP) * (e.shiftKey ? 3 : 1)));
            if (next !== start) onSetBlock(task, next, minutes);
          }}
          aria-label={`${label}. Alt and arrow keys move it.`}
          className={`min-w-0 flex-1 text-left text-xs font-medium truncate ${task.done ? "line-through" : ""}`}
        >
          {task.title}
        </button>
        <LengthPicker title={task.title} minutes={len} max={maxLen} onChange={commitLength} />
        {!task.done && (
          <a
            href={`/pomodoro?task=${task.id}`}
            target="_blank"
            rel="noopener"
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-shrink-0 rounded p-0.5 text-subtle hover:text-foreground hover:bg-border"
            aria-label={`Focus on ${task.title}`}
            title="Start a focus timer on this task"
          >
            <Timer className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onUnschedule(task)}
          className="flex-shrink-0 rounded p-0.5 text-subtle hover:text-foreground hover:bg-border"
          aria-label={`Remove the time block for ${task.title}`}
          title="Remove from the timeline"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      {len >= 45 && (
        <p className="px-2 font-mono text-[11px] text-subtle truncate" aria-hidden="true">
          {clockText(start)} – {clockText(start + len)}
        </p>
      )}

      {/* Bottom edge: drag to change the length. It sits over the block so it takes no room. */}
      <div
        className="absolute inset-x-0 bottom-0 h-2 flex items-end justify-center cursor-ns-resize touch-none"
        aria-hidden="true"
        title="Drag to change the length"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          resize.current = { y0: e.clientY, m0: minutes };
        }}
        onTouchStart={(e) => e.stopPropagation()}
        onPointerMove={(e) => {
          if (!resize.current) return;
          const next = snap(resize.current.m0 + (e.clientY - resize.current.y0) / PX);
          setResizeTo(Math.max(SNAP, Math.min(maxLen, next)));
        }}
        onPointerUp={() => {
          if (!resize.current) return;
          resize.current = null;
          if (resizeTo !== null) commitLength(resizeTo);
          setResizeTo(null);
        }}
        onPointerCancel={() => {
          resize.current = null;
          setResizeTo(null);
        }}
      >
        <span className={`mb-0.5 h-0.5 w-6 rounded-full transition-colors ${resizeTo !== null ? "bg-primary" : "bg-border-strong opacity-0 group-hover/block:opacity-100"}`} />
      </div>
    </div>
  );
}

const LENGTHS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

/** A small length menu ("30m", "1h 30m"). A length not on the list (from dragging) is kept as its own option. */
function LengthPicker({ title, minutes, max = DAY_MINUTES, onChange }: { title: string; minutes: number; max?: number; onChange: (minutes: number) => void }) {
  const options = [...new Set([...LENGTHS.filter((m) => m <= max), minutes])].sort((a, b) => a - b);
  return (
    <select
      value={minutes}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      aria-label={`Length of ${title}`}
      title="Length"
      className="flex-shrink-0 appearance-none bg-transparent rounded px-1 h-5 font-mono text-[11px] text-subtle hover:text-foreground hover:bg-border cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      {options.map((m) => (
        <option key={m} value={m}>{durationText(m)}</option>
      ))}
    </select>
  );
}

function ListItem({ task, isFrog, canPlace, onOpen, onPlaceNext, onSetLength }: { task: CalTask; isFrog: boolean; canPlace: boolean; onOpen: (id: string) => void; onPlaceNext: (task: CalTask) => void; onSetLength: (task: CalTask, minutes: number) => void }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `task:${task.id}` });
  const color = task.abcde ? ABCDE_META[task.abcde].color : task.group.color;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className="flex items-center gap-1.5 rounded-md bg-raised/70 border border-border hover:border-border-strong pl-2.5 pr-1 py-1.5 transition-colors cursor-grab"
      style={{ borderLeft: `3px solid ${color}`, opacity: isDragging ? 0.4 : 1 }}
    >
      {isFrog && <span className="flex-shrink-0" title="Today's frog"><FrogIcon className="w-3.5 h-3.5" /></span>}
      <button type="button" onClick={() => onOpen(task.id)} className={`min-w-0 flex-1 text-left text-sm truncate ${task.done ? "line-through text-faint" : "text-foreground"}`}>
        {task.title}
      </button>
      <AbcdeBadge abcde={task.abcde} abcdeRank={task.abcdeRank} />
      {!task.done && <LengthPicker title={task.title} minutes={blockLength(task)} onChange={(m) => onSetLength(task, m)} />}
      {canPlace && !task.done && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onPlaceNext(task)}
          className="flex-shrink-0 rounded p-1 text-subtle hover:text-foreground hover:bg-border"
          aria-label={`Put ${task.title} in the next free slot`}
          title="Put it in the next free slot"
        >
          <CalendarPlus className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
