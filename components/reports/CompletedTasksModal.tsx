"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { X, CheckCircle2, ChevronDown, ArrowUpDown, Layers, Flag } from "lucide-react";
import { PRIORITY_COLOR, PRIORITY_LABEL, ReportsData, formatCycleTime } from "./types";

interface Props {
  tasks: ReportsData["completedTasks"];
  groups: ReportsData["groups"];
  rangeLabel: string;
  onClose: () => void;
}

type SortKey = "completedAt" | "cycleTimeDays";
const PRIORITY_ORDER = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;

export default function CompletedTasksModal({ tasks, groups, rangeLabel, onClose }: Props) {
  const [projectId, setProjectId] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("completedAt");
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (showProjectMenu && projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) setShowProjectMenu(false);
      if (showPriorityMenu && priorityMenuRef.current && !priorityMenuRef.current.contains(e.target as Node)) setShowPriorityMenu(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProjectMenu, showPriorityMenu]);

  const projectsInTasks = useMemo(() => {
    const ids = new Set(tasks.map(t => t.projectId));
    return groups.filter(g => ids.has(g.id));
  }, [tasks, groups]);

  const filtered = useMemo(() => {
    let rows = tasks;
    if (projectId) rows = rows.filter(t => t.projectId === projectId);
    if (priority) rows = rows.filter(t => t.priority === priority);
    return [...rows].sort((a, b) =>
      sortKey === "completedAt"
        ? new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        : b.cycleTimeDays - a.cycleTimeDays,
    );
  }, [tasks, projectId, priority, sortKey]);

  const avgCycle = filtered.length
    ? Math.round((filtered.reduce((sum, t) => sum + t.cycleTimeDays, 0) / filtered.length) * 10) / 10
    : 0;

  const activeProject = groups.find(g => g.id === projectId);

  return (
    <div className="panel-overlay animate-fade-in">
      <div className="panel-backdrop" onClick={onClose} />

      <div role="dialog" aria-modal="true" aria-label="Completed tasks"
           className="w-full max-w-[640px] md:w-[640px] flex flex-col h-full overflow-hidden animate-in-right ml-auto bg-surface border-l border-border-strong">

        {/* Toolbar */}
        <div className="h-14 px-5 flex items-center justify-between flex-shrink-0 border-b border-border">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-success" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-foreground">Completed tasks</h2>
          </div>
          <button onClick={onClose} className="btn-icon" aria-label="Close"><X className="w-4 h-4" aria-hidden="true" /></button>
        </div>

        {/* Summary row — reflects current filters */}
        <div className="px-5 pt-4 flex items-center gap-5 flex-shrink-0">
          <div>
            <p className="text-2xl font-semibold tracking-[-0.02em] text-foreground tabular">{filtered.length}</p>
            <p className="text-xs text-subtle">completed &middot; {rangeLabel}</p>
          </div>
          <div className="w-px h-[30px] bg-border" />
          <div>
            <p className="text-2xl font-semibold tracking-[-0.02em] text-foreground tabular">{formatCycleTime(avgCycle)}</p>
            <p className="text-xs text-subtle">avg. time from created to done</p>
          </div>
        </div>

        {/* Filters + sort */}
        <div className="px-5 pt-4 pb-3 flex items-center gap-2 flex-wrap flex-shrink-0 border-b border-border">
          {/* Project filter */}
          <div className="relative" ref={projectMenuRef}>
            <button
              onClick={() => { setShowProjectMenu(v => !v); setShowPriorityMenu(false); }}
              aria-haspopup="listbox"
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs border border-border bg-surface text-foreground transition-colors hover:bg-raised hover:border-border-strong"
            >
              {activeProject ? (
                <span className="w-2 h-2 rounded-full" style={{ background: activeProject.color }} aria-hidden="true" />
              ) : (
                <Layers className="w-3 h-3 text-subtle" aria-hidden="true" />
              )}
              <span className="max-w-[110px] truncate">{activeProject ? activeProject.name : "All projects"}</span>
              <ChevronDown className="w-3 h-3 text-subtle" aria-hidden="true" />
            </button>
            {showProjectMenu && (
              <div className="dropdown-menu absolute top-full mt-1 left-0 min-w-[170px] max-h-[240px] overflow-y-auto animate-in-up">
                <button className="dropdown-item first:pt-2" onClick={() => { setProjectId(""); setShowProjectMenu(false); }}>
                  <Layers className="w-3.5 h-3.5 text-subtle" aria-hidden="true" /> All projects
                </button>
                {projectsInTasks.map(g => (
                  <button key={g.id} className="dropdown-item last:pb-2" onClick={() => { setProjectId(g.id); setShowProjectMenu(false); }}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: g.color }} />
                    <span className="truncate">{g.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Priority filter */}
          <div className="relative" ref={priorityMenuRef}>
            <button
              onClick={() => { setShowPriorityMenu(v => !v); setShowProjectMenu(false); }}
              aria-haspopup="listbox"
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs border border-border bg-surface text-foreground transition-colors hover:bg-raised hover:border-border-strong"
            >
              {priority ? (
                <span className="w-2 h-2 rounded-full" style={{ background: PRIORITY_COLOR[priority] }} />
              ) : (
                <Flag className="w-3 h-3 text-subtle" aria-hidden="true" />
              )}
              {priority ? PRIORITY_LABEL[priority] : "All priorities"}
              <ChevronDown className="w-3 h-3 text-subtle" aria-hidden="true" />
            </button>
            {showPriorityMenu && (
              <div className="dropdown-menu absolute top-full mt-1 left-0 min-w-[150px] animate-in-up">
                <button className="dropdown-item first:pt-2" onClick={() => { setPriority(""); setShowPriorityMenu(false); }}>
                  <Flag className="w-3.5 h-3.5 text-subtle" aria-hidden="true" /> All priorities
                </button>
                {PRIORITY_ORDER.map(p => (
                  <button key={p} className="dropdown-item last:pb-2" onClick={() => { setPriority(p); setShowPriorityMenu(false); }}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PRIORITY_COLOR[p] }} />
                    {PRIORITY_LABEL[p]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort toggle */}
          <button
            onClick={() => setSortKey(k => k === "completedAt" ? "cycleTimeDays" : "completedAt")}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs ml-auto border border-border bg-surface text-foreground transition-colors hover:bg-raised hover:border-border-strong"
          >
            <ArrowUpDown className="w-3 h-3 text-subtle" aria-hidden="true" />
            Sort: {sortKey === "completedAt" ? "Most recent" : "Longest cycle time"}
          </button>
        </div>

        {/* Column headers */}
        {filtered.length > 0 && (
          <div className="px-5 pt-3 pb-1.5 flex items-center gap-3 flex-shrink-0">
            <span className="flex-1 min-w-0 text-xs font-medium text-subtle">Task</span>
            <span className="w-[104px] flex-shrink-0 text-xs font-medium text-subtle hidden sm:block">Project</span>
            <span className="w-16 flex-shrink-0 text-xs font-medium text-subtle text-right">Cycle time</span>
            <span className="w-16 flex-shrink-0 text-xs font-medium text-subtle text-right">Done</span>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {filtered.length === 0 ? (
            <p className="text-sm mt-4 text-muted-foreground">
              {tasks.length === 0 ? "No tasks completed in this range." : "No tasks match these filters."}
            </p>
          ) : (
            <div className="flex flex-col">
              {filtered.map(t => (
                <Link
                  key={t.id}
                  href={`/group/${t.projectId}`}
                  className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-md border-b border-border transition-colors hover:bg-raised"
                >
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIORITY_COLOR[t.priority] }} title={PRIORITY_LABEL[t.priority]} />
                    <span className="text-sm truncate text-foreground">{t.title}</span>
                  </span>

                  <span className="w-[104px] flex-shrink-0 hidden sm:flex items-center gap-1.5 text-xs text-subtle">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: t.projectColor }} />
                    <span className="truncate">{t.projectName}</span>
                  </span>

                  <span className="w-16 flex-shrink-0 text-right text-xs text-muted-foreground tabular">
                    {formatCycleTime(t.cycleTimeDays)}
                  </span>

                  <span className="w-16 flex-shrink-0 text-right text-xs text-subtle tabular">
                    {format(parseISO(t.completedAt), "MMM d")}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
