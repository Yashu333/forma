"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw } from "lucide-react";
import type { TodayCandidate, TodayPayload } from "@/types";
import { localDateKey } from "@/lib/frog/dates";
import { isPlanned } from "@/lib/frog/dayview";
import { fetchCandidates, fetchToday } from "./api";
import PlanStepper from "./PlanStepper";
import TodayDay from "./TodayDay";

// "Today" is the browser's local date. It is read through useSyncExternalStore
// so the server render and hydration see `null` (a skeleton) and the client
// then switches to the real date with no mismatch and no setState-in-effect.
// The store also re-reads on window focus, tab visibility and every minute, so
// the view notices midnight passing: the key below changes and the data reloads.

const SEP = "|";

function clockSnapshot(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return `${localDateKey(new Date(), tz)}${SEP}${tz}`;
}

function subscribeClock(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  const timer = window.setInterval(onChange, 60_000);
  return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
    window.clearInterval(timer);
  };
}

type View =
  | { key: string; payload: TodayPayload; candidates: TodayCandidate[] }
  | { key: string; error: string };

export default function TodayView() {
  const clock = useSyncExternalStore<string | null>(subscribeClock, clockSnapshot, () => null);
  const [nonce, setNonce] = useState(0); // bumped by Retry
  const [view, setView] = useState<View | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const [date, tz] = clock ? clock.split(SEP) : [null, null];
  // One key per (date, tz, retry): data for any other key is stale and is not shown.
  const key = clock ? `${clock}${SEP}${nonce}` : null;

  useEffect(() => {
    if (!key || !date || !tz) return;
    let cancelled = false;
    (async () => {
      try {
        const [payload, candidates] = await Promise.all([fetchToday(date, tz), fetchCandidates()]);
        if (!cancelled) setView({ key, payload, candidates });
      } catch (e) {
        if (!cancelled) setView({ key, error: e instanceof Error ? e.message : "Something went wrong" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, date, tz]);

  const current = view && view.key === key ? view : null;

  // Sequencing for the silent refetch. `refreshSeq` numbers every refresh as it
  // starts; `localVersion` counts local edits (optimistic updates, saved plans).
  // A refresh answer is applied only if no newer refresh has started and no local
  // edit has happened since it started: otherwise it is older than what's on screen.
  const refreshSeq = useRef(0);
  const localVersion = useRef(0);

  // Edits to the loaded payload (optimistic updates, server results).
  const change = useCallback(
    (fn: (p: TodayPayload) => TodayPayload) => {
      localVersion.current += 1;
      setView((v) => (v && v.key === key && "payload" in v ? { ...v, payload: fn(v.payload) } : v));
    },
    [key],
  );

  // Quiet re-fetch after a change, for what only the server knows (the streak).
  // Failures are ignored: the optimistic state is already on screen. An answer
  // for an old date is dropped by the key check below.
  const refresh = useCallback(async () => {
    if (!date || !tz) return;
    const seq = ++refreshSeq.current;
    const version = localVersion.current;
    try {
      const payload = await fetchToday(date, tz);
      if (seq !== refreshSeq.current || version !== localVersion.current) return;
      setView((v) => (v && v.key === key && "payload" in v ? { ...v, payload } : v));
    } catch {
      // keep what we have
    }
  }, [date, tz, key]);

  async function onSaved(payload: TodayPayload) {
    change(() => payload);
    setEditingKey(null);
    // Letters and plannedFor changed on the server; keep the picker's source fresh.
    try {
      const candidates = await fetchCandidates();
      setView((v) => (v && v.key === key && "payload" in v ? { ...v, candidates } : v));
    } catch {
      // the next full load fixes it
    }
  }

  if (!current || !tz) return <Shell><Skeleton /></Shell>;

  if ("error" in current) {
    return (
      <Shell>
        <div className="p-5 md:p-7 max-w-3xl mx-auto">
          <div className="rounded-2xl p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--border-strong)" }} role="alert">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Couldn&apos;t load today</p>
            <p className="text-xs mt-1 break-words" style={{ color: "var(--text-muted)" }}>{current.error}</p>
            <button className="btn-primary mt-4" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const editing = editingKey === key;

  return (
    <Shell>
      {isPlanned(current.payload) && !editing ? (
        <TodayDay
          payload={current.payload}
          tz={tz}
          onChange={change}
          onRefresh={refresh}
          onEditPlan={() => setEditingKey(key)}
        />
      ) : (
        <PlanStepper
          payload={current.payload}
          candidates={current.candidates}
          tz={tz}
          editing={isPlanned(current.payload)}
          onSaved={onSaved}
          onCancel={() => setEditingKey(null)}
        />
      )}
    </Shell>
  );
}

// The page scrolls inside the layout's overflow-hidden <main>.
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto" style={{ background: "var(--bg)" }}>{children}</div>;
}

function Skeleton() {
  const block = (h: string, extra = "") => (
    <div className={`rounded-2xl animate-pulse ${extra}`} style={{ height: h, background: "var(--card)", border: "1px solid var(--border)" }} />
  );
  return (
    <div className="p-5 md:p-7 max-w-3xl mx-auto flex flex-col gap-4" aria-busy="true" aria-label="Loading today">
      <div className="rounded-lg animate-pulse" style={{ height: "2rem", width: "40%", background: "var(--card)" }} />
      {block("11rem")}
      {block("3.5rem")}
      {block("3.5rem")}
      {block("3.5rem")}
    </div>
  );
}
