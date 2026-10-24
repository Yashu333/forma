"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { X } from "lucide-react";
import type { Priority } from "@/types";
import { parseCapture } from "@/lib/capture/parse";
import { useLocalClock } from "@/lib/frog/clock";
import { captureTask, type CapturedTask, type PaletteProject } from "./api";

const PROJECT_KEY = "forma.capture.groupId";

const PRIORITY_LABEL: Record<Priority, { label: string; color: string }> = {
  URGENT: { label: "Urgent", color: "#C39BD3" },
  HIGH: { label: "High", color: "#F4959A" },
  MEDIUM: { label: "Medium", color: "#7EB8CC" },
  LOW: { label: "Low", color: "#94A3B8" },
};

function readStoredProject(): string | null {
  try {
    return window.localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

function storeProject(id: string) {
  try {
    window.localStorage.setItem(PROJECT_KEY, id);
  } catch {
    // private mode etc.: the first project is fine
  }
}

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateLabel(key: string, today: string): string {
  return key === today ? "Today" : format(keyToDate(key), "EEE d MMM");
}

function timeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return format(new Date(2000, 0, 1, h, m), "h:mm a").toLowerCase();
}

/** The same default the date picker uses when a day is chosen with no time: the next full hour. */
function defaultTime(): string {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  return format(now, "HH:mm");
}

function dueInstant(due: { date: string; time: string | null }): string {
  const [h, m] = (due.time ?? defaultTime()).split(":").map(Number);
  const d = keyToDate(due.date);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function Chip({ children, onRemove, label, color }: { children: React.ReactNode; onRemove?: () => void; label?: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-raised px-2 py-1 text-xs text-muted-foreground" style={color ? { color } : undefined}>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="rounded-sm text-subtle hover:text-foreground">
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

interface Props {
  projects: PaletteProject[];
  seed: string;
  onClose: () => void;
}

export default function AddMode({ projects, seed, onClose }: Props) {
  const clock = useLocalClock();
  const [text, setText] = useState(seed);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(readStoredProject);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ task: CapturedTask; due: string | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const today = clock?.date ?? null;
  const parsed = useMemo(() => {
    if (!today) return null;
    const now = new Date();
    const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    return parseCapture(text, { today, nowTime, projects, ignore: ignored });
  }, [text, today, projects, ignored]);

  const fallbackId = projects.some((p) => p.id === picked) ? picked : projects[0]?.id ?? null;
  const groupId = parsed?.groupId ?? fallbackId;
  const project = projects.find((p) => p.id === groupId) ?? null;

  function dismiss(kind: "project" | "priority" | "date" | "time" | "plan") {
    const t = parsed?.tokens.find((x) => x.kind === kind);
    if (t) setIgnored((prev) => [...prev, text.slice(t.start, t.end).toLowerCase()]);
  }

  function chooseProject(id: string) {
    setPicked(id);
    storeProject(id);
    if (parsed?.tokens.some((t) => t.kind === "project")) dismiss("project");
  }

  async function submit(andClose: boolean) {
    if (saving || !parsed || !today) return;
    if (!parsed.title) {
      setError("Add a title");
      return;
    }
    if (!groupId) {
      setError("Create a project first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const task = await captureTask({
        title: parsed.title,
        groupId,
        priority: parsed.priority,
        dueDate: parsed.due ? dueInstant(parsed.due) : null,
        plannedFor: parsed.planToday ? today : undefined,
      });
      window.dispatchEvent(new CustomEvent("task-created", { detail: task }));
      if (andClose) {
        onClose();
        return;
      }
      setAdded({ task, due: parsed.due ? dateLabel(parsed.due.date, today) : null });
      setText("");
      setIgnored([]);
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the task");
    } finally {
      setSaving(false);
    }
  }

  const has = (k: string) => parsed?.tokens.some((t) => t.kind === k) ?? false;

  return (
    <div className="p-4">
      <input
        ref={inputRef}
        autoFocus
        data-palette-input
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit(e.shiftKey);
          }
        }}
        placeholder="Add a task, e.g. call dentist tmr 3pm #personal !high"
        aria-label="New task"
        maxLength={600}
        className="forma-input"
      />

      <p className="mt-3 text-sm min-h-5 truncate text-foreground">
        {parsed?.title || <span className="text-subtle">Task title</span>}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 min-h-7">
        {projects.length > 0 && (
          <select
            value={groupId ?? ""}
            onChange={(e) => chooseProject(e.target.value)}
            aria-label="Project"
            className="forma-input !w-auto !py-1 !px-2 !text-xs max-w-[12rem]"
            style={project ? { borderLeft: `3px solid ${project.color}` } : undefined}
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {parsed?.due && today && (
          <Chip onRemove={has("date") ? () => dismiss("date") : undefined} label="date">
            {dateLabel(parsed.due.date, today)}
          </Chip>
        )}
        {parsed?.due?.time && (
          <Chip onRemove={() => dismiss("time")} label="time">
            <span className="font-mono">{timeLabel(parsed.due.time)}</span>
          </Chip>
        )}
        {parsed?.priority && (
          <Chip onRemove={() => dismiss("priority")} label="priority" color={PRIORITY_LABEL[parsed.priority].color}>
            {PRIORITY_LABEL[parsed.priority].label}
          </Chip>
        )}
        {parsed?.planToday && (
          <Chip onRemove={() => dismiss("plan")} label="plan for today">Plan for today</Chip>
        )}
      </div>

      {projects.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Create a project first.{" "}
          <Link href="/dashboard" onClick={onClose} className="text-foreground underline underline-offset-2">Go to the dashboard</Link>
        </p>
      )}
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      {added && !error && (
        <p className="mt-3 text-sm text-success" role="status">
          Added to {added.task.group.name}{added.due ? ` · ${added.due}` : ""}.{" "}
          <Link
            href={`/group/${added.task.groupId}?task=${added.task.id}`}
            onClick={onClose}
            className="text-foreground underline underline-offset-2"
          >
            Open
          </Link>
        </p>
      )}

      <p className="mt-4 text-xs text-subtle">
        Enter adds and keeps going. Shift+Enter adds and closes. Use #project, !high, tmr, fri, 3pm, @today.
      </p>
    </div>
  );
}
