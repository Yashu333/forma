"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { TodayCandidate, TodayPayload } from "@/types";
import { useLocalClock } from "@/lib/frog/clock";
import { isPlanned } from "@/lib/frog/dayview";
import { fetchCandidates, fetchToday } from "./api";
import PlanStepper from "./PlanStepper";
import TodayDay from "./TodayDay";

type View =
  | { key: string; payload: TodayPayload; candidates: TodayCandidate[] }
  | { key: string; error: string };

export default function TodayView() {
  const clock = useLocalClock();
  const [nonce, setNonce] = useState(0); // bumped by Retry
  const [view, setView] = useState<View | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const date = clock?.date ?? null;
  const tz = clock?.tz ?? null;
  // One key per (date, tz, retry): data for any other key is stale and is not shown.
  const key = clock ? `${clock.key}|${nonce}` : null;

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

  // Letters and plannedFor changed on the server; keep the picker's source fresh.
  async function refreshCandidates() {
    try {
      const candidates = await fetchCandidates();
      setView((v) => (v && v.key === key && "payload" in v ? { ...v, candidates } : v));
    } catch {
      // the next full load fixes it
    }
  }

  async function onSaved(payload: TodayPayload) {
    change(() => payload);
    setEditingKey(null);
    await refreshCandidates();
  }

  // The review returns the whole payload, so it replaces the loaded one (and
  // makes any refresh still in flight stale). Moved and archived tasks change
  // what the plan picker may offer.
  async function onReviewed(payload: TodayPayload) {
    change(() => payload);
    await refreshCandidates();
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
          onReviewed={onReviewed}
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
