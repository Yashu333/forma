"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Plus, RefreshCw, X } from "lucide-react";
import type { LabelProject, LabelTask } from "@/types";
import { addLabelTask, deleteTask, fetchLabels, renameTask } from "./api";

// The "New tasks" screen (/today/new): the book's first step, writing down
// everything you have to do. Type, Enter, repeat. No letters here; those come
// on the Label tasks screen.

const PROJECT_KEY = "forma.labelTasks.groupId";
const errorStyle = { color: "#F87171", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.30)" } as const;

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
    // private mode etc.: the default project is fine
  }
}

export default function NewTasks() {
  const [projects, setProjects] = useState<LabelProject[] | null>(null);
  const [added, setAdded] = useState<LabelTask[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bumped by Retry
  const [title, setTitle] = useState("");
  const [groupId, setGroupId] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchLabels();
        if (cancelled) return;
        setProjects(data.projects);
        setLoadError(null);
        const stored = readStoredProject();
        setGroupId((g) => g || (data.projects.some((p) => p.id === stored) ? stored! : data.projects[0]?.id ?? ""));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load your projects");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean || !groupId || adding) return;
    setAdding(true);
    setError(null);
    try {
      const task = await addLabelTask(clean, groupId);
      setAdded((list) => [task, ...list]);
      setTitle("");
      storeProject(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that task");
    } finally {
      setAdding(false);
      inputRef.current?.focus();
    }
  }

  async function rename(id: string, next: string) {
    const before = added.find((t) => t.id === id)?.title;
    setAdded((list) => list.map((t) => (t.id === id ? { ...t, title: next } : t)));
    try {
      await renameTask(id, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rename that task");
      if (before !== undefined) setAdded((list) => list.map((t) => (t.id === id ? { ...t, title: before } : t)));
    }
  }

  async function remove(id: string) {
    const index = added.findIndex((t) => t.id === id);
    const task = added[index];
    if (!task) return;
    setAdded((list) => list.filter((t) => t.id !== id));
    inputRef.current?.focus();
    try {
      await deleteTask(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that task");
      setAdded((list) => [...list.slice(0, index), task, ...list.slice(index)]);
    }
  }

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--bg)" }}>
      <div className="p-4 md:p-7 max-w-2xl mx-auto" style={{ color: "var(--text-primary)" }}>
        <Link href="/today" className="inline-flex items-center gap-1 text-xs mb-3 hover:underline" style={{ color: "var(--text-muted)" }}>
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Today
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">New tasks</h1>
        <p className="text-sm mt-1 mb-5" style={{ color: "var(--text-muted)" }}>Write down everything you have to do.</p>

        {loadError ? (
          <div className="rounded-lg p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--border-strong)" }} role="alert">
            <p className="text-sm font-semibold">Couldn&apos;t load your projects</p>
            <p className="text-xs mt-1 break-words" style={{ color: "var(--text-muted)" }}>{loadError}</p>
            <button className="btn-primary mt-4" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : !projects ? (
          <div className="rounded-lg animate-pulse" style={{ height: "3rem", background: "var(--card)" }} aria-busy="true" aria-label="Loading" />
        ) : projects.length === 0 ? (
          <div className="rounded-lg p-5 text-center" style={{ background: "var(--card)", border: "1px solid var(--border-strong)" }}>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Create a project first, then add tasks here.</p>
            <Link href="/dashboard" className="text-xs mt-2 inline-block underline" style={{ color: "var(--text-muted)" }}>Go to dashboard</Link>
          </div>
        ) : (
          <>
            <form onSubmit={add} className="flex gap-2">
              <label htmlFor="new-task" className="sr-only">New task</label>
              <input
                id="new-task"
                ref={inputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={2000}
                placeholder="Type a task and press Enter"
                className="forma-input flex-1 min-w-0 text-base"
                style={{ borderRadius: "0.5rem" }}
                autoComplete="off"
                autoFocus
              />
              <button type="submit" className="btn-primary flex-shrink-0" style={{ borderRadius: "0.5rem" }} disabled={!title.trim() || adding}>
                <Plus className="w-4 h-4" aria-hidden="true" /> {adding ? "Adding…" : "Add"}
              </button>
            </form>

            {projects.length > 1 && (
              <div className="flex items-center gap-2 mt-2">
                <label htmlFor="new-task-project" className="text-xs" style={{ color: "var(--text-muted)" }}>Project</label>
                <select
                  id="new-task-project"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="forma-input w-48 min-w-0 text-xs"
                  style={{ borderRadius: "0.5rem", colorScheme: "dark", height: "2rem", paddingTop: 0, paddingBottom: 0 }}
                >
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-4 text-xs rounded-lg px-3 py-2 flex items-start justify-between gap-2" style={errorStyle}>
                <span className="min-w-0 break-words">{error}</span>
                <button aria-label="Dismiss" onClick={() => setError(null)} className="flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
              </p>
            )}

            {added.length > 0 && (
              <ul aria-label="Added" className="mt-5 rounded-lg overflow-hidden divide-y divide-[var(--border)]" style={{ background: "var(--card)", border: "1px solid var(--border-strong)" }}>
                {added.map((t) => (
                  <AddedRow key={t.id} task={t} onRename={(next) => rename(t.id, next)} onRemove={() => remove(t.id)} />
                ))}
              </ul>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {added.length > 0 ? `${added.length} added` : ""}
              </span>
              {added.length > 0 && (
                <Link href="/today/label" className="btn-ghost" style={{ border: "1px solid var(--border-strong)" }}>
                  Next: label them <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// One added task: click the title to fix a typo, × to remove it.
function AddedRow({ task, onRename, onRemove }: { task: LabelTask; onRename: (title: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  function finish(save: boolean) {
    const clean = draft.trim();
    if (save && clean && clean !== task.title) onRename(clean);
    else setDraft(task.title);
    setEditing(false);
  }

  return (
    <li className="flex items-center gap-2 pl-3 pr-1 py-1">
      {editing ? (
        <input
          aria-label="Edit task"
          value={draft}
          maxLength={2000}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") finish(false);
          }}
          className="forma-input flex-1 min-w-0 text-sm"
          style={{ borderRadius: "0.375rem", height: "2.25rem" }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(task.title);
            setEditing(true);
          }}
          title="Edit"
          className="flex-1 min-w-0 text-left text-sm break-words py-2 rounded-md focus-visible:outline-2"
        >
          {task.title}
        </button>
      )}
      <button type="button" className="btn-icon flex-shrink-0" aria-label={`Remove ${task.title}`} onClick={onRemove}>
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </li>
  );
}
