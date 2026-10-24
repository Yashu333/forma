"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, CalendarCheck, CalendarDays, CornerDownLeft, LayoutGrid, ListChecks, Plus, Sun, Timer, type LucideIcon } from "lucide-react";
import { searchTasks, type PaletteProject, type SearchResult } from "./api";

interface GotoRow {
  kind: "goto";
  id: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  color?: string;
  external?: boolean;
}
interface TaskRow { kind: "task"; id: string; task: SearchResult }
interface AddRow { kind: "add"; id: "add" }
type Row = GotoRow | TaskRow | AddRow;

const PAGES: GotoRow[] = [
  { kind: "goto", id: "page-dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutGrid },
  { kind: "goto", id: "page-today", label: "Today", href: "/today", icon: Sun },
  { kind: "goto", id: "page-calendar", label: "Calendar", href: "/calendar", icon: CalendarDays },
  { kind: "goto", id: "page-habits", label: "Habits", href: "/habits", icon: ListChecks },
  { kind: "goto", id: "page-review", label: "Weekly review", href: "/review", icon: CalendarCheck },
  { kind: "goto", id: "page-reports", label: "Reports", href: "/reports", icon: BarChart3 },
  { kind: "goto", id: "page-pomodoro", label: "Pomodoro", href: "/pomodoro", icon: Timer, external: true },
];

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <span className="text-muted-foreground">{text}</span>;
  return (
    <>
      <span className="text-muted-foreground">{text.slice(0, i)}</span>
      <span className="text-foreground font-medium">{text.slice(i, i + q.length)}</span>
      <span className="text-muted-foreground">{text.slice(i + q.length)}</span>
    </>
  );
}

interface Props {
  projects: PaletteProject[];
  onClose: () => void;
  onAddAsTask: (text: string) => void;
}

export default function SearchMode({ projects, onClose, onAddAsTask }: Props) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState<string | null>(null); // the query `results` answers
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const query = q.trim();
  const searchable = query.length >= 2;

  useEffect(() => {
    if (!searchable) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchTasks(query, ctrl.signal);
        setResults(found);
        setSearched(query);
        setError(null);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Search failed");
        setSearched(query);
      }
    }, 150);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, searchable]);

  const rows = useMemo<Row[]>(() => {
    const needle = query.toLowerCase();
    const goto: GotoRow[] = [
      ...PAGES,
      ...projects.map<GotoRow>((p) => ({ kind: "goto", id: `project-${p.id}`, label: p.name, href: `/group/${p.id}`, color: p.color })),
    ].filter((r) => !needle || r.label.toLowerCase().includes(needle));
    const tasks: TaskRow[] = searchable && searched === query ? results.map((t) => ({ kind: "task", id: t.id, task: t })) : [];
    const out: Row[] = [...goto, ...tasks];
    if (searchable && searched === query && tasks.length === 0) out.push({ kind: "add", id: "add" });
    return out;
  }, [query, searchable, searched, results, projects]);

  const current = Math.min(active, Math.max(rows.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function activate(row: Row | undefined) {
    if (!row) return;
    if (row.kind === "add") {
      onAddAsTask(q);
      return;
    }
    onClose();
    if (row.kind === "goto") {
      if (row.external) window.open(row.href, "_blank", "noopener");
      else router.push(row.href);
      return;
    }
    const t = row.task;
    router.push(`/group/${t.group.id}?task=${t.parentTaskId ?? t.id}`);
  }

  const gotoRows = rows.filter((r): r is GotoRow => r.kind === "goto");
  const taskRows = rows.filter((r): r is TaskRow => r.kind === "task");
  const addRow = rows.find((r): r is AddRow => r.kind === "add");
  const indexOf = (r: Row) => rows.indexOf(r);
  const loading = searchable && searched !== query && !error;

  function optionProps(r: Row) {
    const i = indexOf(r);
    return {
      id: `cmd-opt-${i}`,
      role: "option" as const,
      "aria-selected": i === current,
      "data-index": i,
      onMouseEnter: () => setActive(i),
      onClick: () => activate(r),
    };
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="p-4 pb-2">
        <input
          autoFocus
          data-palette-input
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant={rows.length ? `cmd-opt-${current}` : undefined}
          aria-label="Search tasks and pages"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(current + 1, rows.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(current - 1, 0)); }
            else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); activate(rows[current]); }
          }}
          placeholder="Search tasks or jump to a page"
          maxLength={200}
          className="forma-input"
        />
      </div>

      <ul id="cmd-list" ref={listRef} role="listbox" aria-label="Results" className="overflow-y-auto px-2 pb-3 flex-1 min-h-0">
        {gotoRows.length > 0 && <li role="presentation" className="px-2 pt-2 pb-1 text-xs font-semibold text-subtle">Go to</li>}
        {gotoRows.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.id} {...optionProps(r)} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm cursor-pointer ${indexOf(r) === current ? "bg-raised text-foreground" : "text-muted-foreground"}`}>
              {Icon ? <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> : <span className="w-2 h-2 rounded-full flex-shrink-0 mx-1" style={{ background: r.color }} aria-hidden="true" />}
              <span className="truncate flex-1">{r.label}</span>
              {indexOf(r) === current && <CornerDownLeft className="w-3.5 h-3.5 text-subtle" aria-hidden="true" />}
            </li>
          );
        })}

        {taskRows.length > 0 && <li role="presentation" className="px-2 pt-3 pb-1 text-xs font-semibold text-subtle">Tasks</li>}
        {taskRows.map((r) => (
          <li
            key={r.id}
            {...optionProps(r)}
            className={`rounded-md px-2.5 py-2 mt-0.5 text-sm cursor-pointer ${indexOf(r) === current ? "bg-raised" : ""}`}
            style={{ borderLeft: `3px solid ${r.task.group.color}` }}
          >
            <div className="flex items-center gap-2">
              <span className={`truncate flex-1 ${r.task.done ? "line-through opacity-70" : ""}`}>
                <Highlight text={r.task.title} q={query} />
              </span>
              {r.task.done && <span className="text-xs text-subtle flex-shrink-0">Done</span>}
            </div>
            <div className="text-xs text-subtle truncate">
              {r.task.parentTitle ? `in ${r.task.parentTitle} · ` : ""}{r.task.group.name}
            </div>
          </li>
        ))}

        {loading && <li role="presentation" className="px-2.5 py-3 text-sm text-subtle">Searching…</li>}
        {error && <li role="alert" className="px-2.5 py-3 text-sm text-danger">{error}</li>}
        {searchable && searched === query && !error && taskRows.length === 0 && (
          <li role="presentation" className="px-2.5 pt-3 pb-1 text-sm text-muted-foreground">No tasks match</li>
        )}
        {addRow && (
          <li {...optionProps(addRow)} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm cursor-pointer ${indexOf(addRow) === current ? "bg-raised text-foreground" : "text-muted-foreground"}`}>
            <Plus className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">Add &ldquo;{query}&rdquo; as a task</span>
          </li>
        )}
      </ul>
    </div>
  );
}
