"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, ChevronDown, ChevronRight, GripVertical, Plus, RefreshCw, X } from "lucide-react";
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Abcde, LabelTask } from "@/types";
import { ABCDE_LETTERS, ABCDE_META } from "@/lib/frog/abcde";
import { localDateKey } from "@/lib/frog/dates";
import { MAX_PLAN_TASKS } from "@/lib/frog/today";
import { applyLabels, inLetter, labelCode, numberInOrder, tapLetter, type LabelChange } from "@/lib/frog/labels";
import { archiveTask, fetchLabels, fetchToday, saveLabels, savePlan } from "./api";
import { FROG } from "./bits";

// The "Label tasks" screen, in the book's order: put a letter on every task,
// then drag each letter's tasks into order of importance (A1, A2… B1, B2…).
// A1 is the frog. Tasks made today are kept apart from older ones. Every change
// is saved straight away (optimistically, one request at a time); "Start with
// A1" turns the labels into today's plan. New tasks are added on /today/new.

const errorStyle = { color: "var(--danger)", background: "var(--surface)", border: "1px solid var(--border)" } as const;
const listStyle = { background: "var(--surface)", border: "1px solid var(--border)" } as const;
// The letters that go on today's plan. E is "eliminate": it never does.
const PLAN_LETTERS: readonly Abcde[] = ["A", "B", "C", "D"];

function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export default function LabelTasks() {
  const router = useRouter();
  const [tasks, setTasks] = useState<LabelTask[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bumped by Retry
  const [pending, setPending] = useState(0);
  const [planning, setPlanning] = useState(false);
  // A and B start open; C, D and E start folded and open when a task goes in.
  const [open, setOpen] = useState<Set<Abcde>>(() => new Set<Abcde>(["A", "B"]));
  const [showOlder, setShowOlder] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The latest list, so taps that land before a re-render still build on each other.
  const latest = useRef<LabelTask[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const today = useMemo(() => localDateKey(new Date(), browserTz()), []);

  function replaceTasks(next: LabelTask[]) {
    latest.current = next;
    setTasks(next);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchLabels();
        if (cancelled) return;
        replaceTasks(data.tasks);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load your tasks");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Runs `save` after any earlier save. A failure shows the error and reloads
  // the list so the screen matches what's stored.
  function enqueue(save: () => Promise<unknown>, fallback: string) {
    setPending((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        await save();
      } catch (e) {
        setError(e instanceof Error ? e.message : fallback);
        try {
          replaceTasks((await fetchLabels()).tasks);
        } catch {
          // keep what's on screen; Retry on the next failure
        }
      } finally {
        setPending((n) => n - 1);
      }
    });
  }

  function commit(changes: LabelChange[]) {
    if (changes.length === 0) return;
    replaceTasks(applyLabels(latest.current, changes));
    enqueue(() => saveLabels(changes), "Couldn't save those labels");
  }

  function tap(id: string, letter: Abcde) {
    commit(tapLetter(latest.current, id, letter));
    setOpen((s) => new Set(s).add(letter));
  }

  // A drop inside a letter: the new order becomes 1, 2, 3…
  function reorder(letter: Abcde, activeId: string, overId: string) {
    const ids = inLetter(latest.current, letter).map((t) => t.id);
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    commit(numberInOrder(latest.current, letter, arrayMove(ids, from, to)));
  }

  function removeEliminated() {
    const ids = inLetter(latest.current, "E").map((t) => t.id);
    setConfirmRemove(false);
    if (ids.length === 0) return;
    replaceTasks(latest.current.filter((t) => !ids.includes(t.id)));
    enqueue(async () => {
      for (const id of ids) await archiveTask(id);
    }, "Couldn't remove those tasks");
  }

  // Makes the labels today's plan: every A–D task in label order, with A1 as
  // the frog. Whatever is already on today's list stays on it, and a frog that
  // was already eaten today stays the frog.
  async function planToday() {
    if (planning) return;
    setPlanning(true);
    setError(null);
    try {
      await queue.current; // let label saves land first
      const tz = browserTz();
      const date = localDateKey(new Date(), tz);
      const current = await fetchToday(date, tz);
      const all = latest.current;
      const ids = new Set<string>(PLAN_LETTERS.flatMap((l) => inLetter(all, l)).map((t) => t.id));
      for (const t of current.tasks) ids.add(t.id);
      const frog = current.frog?.completedAt ? current.frog : inLetter(all, "A")[0];
      if (frog) ids.add(frog.id);
      await savePlan({
        date,
        tz,
        taskIds: [...ids].slice(0, MAX_PLAN_TASKS),
        ranks: {},
        frogTaskId: frog?.id ?? null,
        finalize: true,
      });
      router.push("/today");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't plan today");
      setPlanning(false);
    }
  }

  if (loadError) {
    return (
      <Frame>
        <div className="rounded-lg p-6 text-center" style={listStyle} role="alert">
          <AlertCircle className="w-5 h-5 mx-auto mb-2 text-danger" aria-hidden="true" />
          <p className="text-sm font-semibold">Something went wrong</p>
          <p className="text-xs mt-1 break-words text-muted-foreground">{loadError}</p>
          <button className="btn-secondary mt-4" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
          </button>
        </div>
      </Frame>
    );
  }

  if (!tasks) {
    return (
      <Frame>
        <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label="Loading tasks">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg animate-pulse bg-raised" style={{ height: "3.25rem" }} />
          ))}
        </div>
      </Frame>
    );
  }

  const unlabelled = tasks.filter((t) => t.abcde === null);
  const isNew = (t: LabelTask) => localDateKey(new Date(t.createdAt), browserTz()) === today;
  const newToday = unlabelled.filter(isNew);
  const older = unlabelled.filter((t) => !isNew(t));
  const groups = ABCDE_LETTERS.map((letter) => ({ letter, rows: inLetter(tasks, letter) })).filter((g) => g.rows.length > 0);
  const frog = inLetter(tasks, "A")[0];

  return (
    <Frame status={pending > 0 ? "Saving…" : null}>
      {error && (
        <p role="alert" className="mb-4 text-xs rounded-md px-3 py-2 flex items-start justify-between gap-2" style={errorStyle}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" aria-hidden="true" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button aria-label="Dismiss" onClick={() => setError(null)} className="flex-shrink-0"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
        </p>
      )}

      {tasks.length === 0 ? (
        <div className="rounded-lg p-6 text-center" style={listStyle}>
          <p className="text-sm text-muted-foreground">No open tasks yet.</p>
          <Link href="/today/new" className="btn-primary mt-4 inline-flex">
            <Plus className="w-4 h-4" aria-hidden="true" /> Add tasks
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {newToday.length > 0 && (
            <section aria-labelledby="label-group-new">
              <div className="flex items-baseline gap-2 mb-2">
                <h2 id="label-group-new" className="text-sm font-semibold">New today</h2>
                <span className="text-xs tabular-nums text-subtle">{newToday.length}</span>
                <span className="text-xs ml-auto text-subtle">Tap a letter</span>
              </div>
              <ul className="rounded-lg overflow-hidden divide-y divide-border" style={listStyle}>
                {newToday.map((t) => <Row key={t.id} task={t} onTap={(l) => tap(t.id, l)} />)}
              </ul>
            </section>
          )}

          {older.length > 0 && (
            <section aria-labelledby="label-group-older">
              <h2 id="label-group-older" className="text-sm font-semibold mb-2">
                <Disclosure open={showOlder} controls="label-list-older" onToggle={() => setShowOlder((v) => !v)}>
                  <span>Older tasks</span>
                  <Count n={older.length} />
                </Disclosure>
              </h2>
              {showOlder && (
                <ul id="label-list-older" className="rounded-lg overflow-hidden divide-y divide-border" style={listStyle}>
                  {older.map((t) => <Row key={t.id} task={t} onTap={(l) => tap(t.id, l)} />)}
                </ul>
              )}
            </section>
          )}

          {groups.map(({ letter, rows }) => {
            const meta = ABCDE_META[letter];
            const isOpen = open.has(letter);
            const listId = `label-list-${letter}`;
            return (
              <section key={letter} aria-labelledby={`label-group-${letter}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 mb-2">
                  <h2 id={`label-group-${letter}`} className="text-sm font-semibold">
                    <Disclosure
                      open={isOpen}
                      controls={listId}
                      onToggle={() => setOpen((s) => {
                        const next = new Set(s);
                        if (next.has(letter)) next.delete(letter);
                        else next.add(letter);
                        return next;
                      })}
                    >
                      <span style={{ color: meta.color }}>{letter}</span>
                      <span>{meta.label}</span>
                      <Count n={rows.length} />
                    </Disclosure>
                  </h2>
                  {isOpen && rows.length > 1 && (
                    <span className="text-xs text-subtle">Drag to reorder</span>
                  )}
                  {letter === "E" && isOpen && (
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      {confirmRemove ? (
                        <>
                          <span className="text-xs text-muted-foreground">
                            Archive {rows.length === 1 ? "this task" : `these ${rows.length} tasks`}?
                          </span>
                          <button type="button" className="btn-outline" onClick={() => setConfirmRemove(false)}>Keep</button>
                          <button type="button" className="btn-outline !text-danger" onClick={removeEliminated}>Archive</button>
                        </>
                      ) : (
                        <button type="button" className="btn-outline" onClick={() => setConfirmRemove(true)}>Remove these</button>
                      )}
                    </div>
                  )}
                </div>

                {isOpen && (
                  <SortableLetter
                    id={listId}
                    letter={letter}
                    rows={rows}
                    frogId={frog?.id}
                    onTap={tap}
                    onReorder={(a, o) => reorder(letter, a, o)}
                  />
                )}
              </section>
            );
          })}

          {frog && (
            <div className="flex flex-col items-end gap-1">
              <button type="button" className="btn-primary" onClick={planToday} disabled={planning}>
                {planning ? "Planning today…" : <>Start with {labelCode(frog)} <ArrowRight className="w-4 h-4" aria-hidden="true" /></>}
              </button>
              <span className="text-xs text-subtle">Puts your A–D tasks on today&apos;s list</span>
            </div>
          )}
        </div>
      )}
    </Frame>
  );
}

function Frame({ children, status }: { children: React.ReactNode; status?: string | null }) {
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-4 md:p-7 max-w-3xl mx-auto text-foreground">
        <Link href="/today" className="inline-flex items-center gap-1 text-xs mb-3 hover:underline text-subtle hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Today
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[28px] sm:text-4xl font-semibold tracking-[-0.025em] leading-[1.1]">Label tasks</h1>
            <span role="status" className="text-xs text-subtle">{status ?? ""}</span>
          </div>
          <Link href="/today/new" className="btn-outline">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New tasks
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}

function Disclosure({ open, controls, onToggle, children }: { open: boolean; controls: string; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="inline-flex items-center gap-1.5 rounded-md"
    >
      {open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-xs font-normal tabular-nums text-subtle">{n}</span>;
}

// One letter's list. Drags stay inside the letter; the keyboard works too
// (focus the handle, Space, arrows, Space).
function SortableLetter({
  id,
  letter,
  rows,
  frogId,
  onTap,
  onReorder,
}: {
  id: string;
  letter: Abcde;
  rows: LabelTask[];
  frogId?: string;
  onTap: (id: string, letter: Abcde) => void;
  onReorder: (activeId: string, overId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={rows.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul id={id} aria-label={`${letter} tasks`} className="rounded-lg divide-y divide-border" style={listStyle}>
          {rows.map((t) => (
            <SortableRow key={t.id} task={t} isFrog={t.id === frogId} draggable={rows.length > 1} onTap={(l) => onTap(t.id, l)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ task, isFrog, draggable, onTap }: { task: LabelTask; isFrog: boolean; draggable: boolean; onTap: (letter: Abcde) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !draggable });
  return (
    <Row
      task={task}
      isFrog={isFrog}
      onTap={onTap}
      liRef={setNodeRef}
      liStyle={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
        background: isDragging ? "var(--raised)" : undefined,
        outline: isDragging ? "1px solid var(--primary)" : undefined,
      }}
      handle={
        draggable ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${labelCode(task)}, ${task.title}`}
            className="btn-icon flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical className="w-4 h-4" aria-hidden="true" />
          </button>
        ) : (
          <span className="w-8 flex-shrink-0" aria-hidden="true" />
        )
      }
    />
  );
}

function Row({
  task,
  isFrog,
  onTap,
  handle,
  liRef,
  liStyle,
}: {
  task: LabelTask;
  isFrog?: boolean;
  onTap: (letter: Abcde) => void;
  handle?: React.ReactNode;
  liRef?: (node: HTMLElement | null) => void;
  liStyle?: React.CSSProperties;
}) {
  const color = task.abcde ? ABCDE_META[task.abcde].color : null;
  return (
    <li ref={liRef} style={liStyle} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 first:rounded-t-lg last:rounded-b-lg">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {handle}
        {color && (
          <span
            className="inline-flex items-center justify-center rounded-md h-7 w-10 flex-shrink-0 text-xs font-semibold font-mono tabular-nums"
            style={{ color: `color-mix(in srgb, ${color} 75%, white)`, background: `${color}1A`, border: `1px solid ${color}40` }}
          >
            {labelCode(task)}
          </span>
        )}
        <p className="text-sm break-words min-w-0">{task.title}</p>
        {isFrog && <span className="text-xs font-medium flex-shrink-0" style={{ color: FROG }}>Your frog</span>}
      </div>

      <div role="group" aria-label={`Label for ${task.title}`} className="flex gap-1 flex-shrink-0">
        {ABCDE_LETTERS.map((l) => {
          const on = task.abcde === l;
          const c = ABCDE_META[l].color;
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              aria-label={`${l}, ${ABCDE_META[l].label.toLowerCase()}`}
              title={on ? `Remove ${l}` : `${l}: ${ABCDE_META[l].description}`}
              onClick={() => onTap(l)}
              className={`w-8 h-8 rounded-md text-xs font-semibold transition-colors duration-150 ${on ? "" : "hover:bg-raised hover:!border-border-strong"}`}
              style={
                on
                  ? { color: c, background: `${c}24`, border: `1px solid ${c}90` }
                  : { color: "var(--muted-foreground)", background: "transparent", border: "1px solid var(--border)" }
              }
            >
              {l}
            </button>
          );
        })}
      </div>
    </li>
  );
}
