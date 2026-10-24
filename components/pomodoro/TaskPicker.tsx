"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { TodayCandidate, TodayPayload } from "@/types";
import { localDateKey } from "@/lib/frog/dates";

export interface PickedTask {
  id: string;
  title: string;
  color: string;
}

interface Option extends PickedTask {
  project: string;
  planned: boolean;
}

async function loadOptions(): Promise<Option[]> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const date = localDateKey(new Date(), tz);
  const [todayRes, candRes] = await Promise.all([
    fetch(`/api/today?${new URLSearchParams({ date, tz })}`),
    fetch("/api/today/candidates"),
  ]);
  const planned: Option[] = [];
  if (todayRes.ok) {
    const today: TodayPayload = await todayRes.json();
    for (const t of today.tasks) {
      if (!t.completedAt) planned.push({ id: t.id, title: t.title, color: t.group.color, project: t.group.name, planned: true });
    }
  }
  const seen = new Set(planned.map((o) => o.id));
  const others: Option[] = [];
  if (candRes.ok) {
    const cands: TodayCandidate[] = await candRes.json();
    for (const c of cands) {
      if (!seen.has(c.id)) others.push({ id: c.id, title: c.title, color: c.group.color, project: c.group.name, planned: false });
    }
  }
  return [...planned, ...others];
}

interface Props {
  value: PickedTask | null;
  onChange: (task: PickedTask | null) => void;
}

// "Working on": the task this focus time is logged against. Optional.
export default function TaskPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadOptions()
      .then((o) => { if (!cancelled) { setOptions(o); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (open && e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (options ?? []).filter((o) => !needle || o.title.toLowerCase().includes(needle) || o.project.toLowerCase().includes(needle)).slice(0, 60);
  }, [options, q]);

  function choose(task: PickedTask | null) {
    onChange(task);
    setOpen(false);
    setQ("");
  }

  return (
    <div ref={ref} style={{ position: "relative", maxWidth: "calc(100vw - 32px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="pomo-outline"
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer",
            color: value ? "var(--foreground)" : "var(--subtle)", fontSize: 14, maxWidth: 360,
          }}
        >
          {value && <span style={{ width: 8, height: 8, borderRadius: 999, background: value.color, flexShrink: 0 }} aria-hidden="true" />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {value ? value.title : "Pick a task (optional)"}
          </span>
          <ChevronDown size={14} aria-hidden="true" style={{ flexShrink: 0, color: "var(--subtle)" }} />
        </button>
        {value && (
          <button
            type="button"
            onClick={() => choose(null)}
            aria-label="Clear task"
            className="pomo-outline"
            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <div className="dropdown-menu" style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 6, width: 340, maxWidth: "calc(100vw - 32px)" }}>
          <div style={{ padding: 8 }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your tasks"
              aria-label="Search your tasks"
              className="forma-input"
              style={{ padding: "6px 10px", fontSize: 14 }}
            />
          </div>
          <ul role="listbox" aria-label="Tasks" style={{ maxHeight: 280, overflowY: "auto", paddingBottom: 6 }}>
            <li role="option" aria-selected={!value}>
              <button type="button" className="dropdown-item" onClick={() => choose(null)}>No task</button>
            </li>
            {options === null && !failed && <li style={{ padding: "8px 12px", fontSize: 13, color: "var(--subtle)" }}>Loading…</li>}
            {failed && <li style={{ padding: "8px 12px", fontSize: 13, color: "var(--danger)" }}>Couldn&apos;t load your tasks</li>}
            {options !== null && shown.length === 0 && <li style={{ padding: "8px 12px", fontSize: 13, color: "var(--subtle)" }}>No tasks match</li>}
            {shown.map((o, i) => (
              <li key={o.id} role="option" aria-selected={value?.id === o.id}>
                {o.planned && (i === 0 || !shown[i - 1].planned) && (
                  <div style={{ padding: "6px 12px 2px", fontSize: 12, fontWeight: 600, color: "var(--subtle)" }}>Planned for today</div>
                )}
                {!o.planned && (i === 0 || shown[i - 1].planned) && (
                  <div style={{ padding: "6px 12px 2px", fontSize: 12, fontWeight: 600, color: "var(--subtle)" }}>Other open tasks</div>
                )}
                <button type="button" className="dropdown-item" onClick={() => choose({ id: o.id, title: o.title, color: o.color })}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: o.color, flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>{o.title}</span>
                  <span style={{ fontSize: 12, color: "var(--subtle)", flexShrink: 0 }}>{o.project}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
