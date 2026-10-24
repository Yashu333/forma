"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ListPlus, RefreshCw, Tags } from "lucide-react";
import type { TodayPayload } from "@/types";
import { useLocalClock } from "@/lib/frog/clock";
import { formatDateKeyLong, isPlanned } from "@/lib/frog/dayview";
import { fetchToday } from "./api";
import TodayDay from "./TodayDay";

type View =
  | { key: string; payload: TodayPayload }
  | { key: string; error: string };

export default function TodayView() {
  const clock = useLocalClock();
  const [nonce, setNonce] = useState(0); // bumped by Retry
  const [view, setView] = useState<View | null>(null);

  const date = clock?.date ?? null;
  const tz = clock?.tz ?? null;
  // One key per (date, tz, retry): data for any other key is stale and is not shown.
  const key = clock ? `${clock.key}|${nonce}` : null;

  useEffect(() => {
    if (!key || !date || !tz) return;
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchToday(date, tz);
        if (!cancelled) setView({ key, payload });
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

  // The review returns the whole payload, so it replaces the loaded one (and
  // makes any refresh still in flight stale).
  function onReviewed(payload: TodayPayload) {
    change(() => payload);
  }

  if (!current || !tz) return <Shell><Skeleton /></Shell>;

  if ("error" in current) {
    return (
      <Shell>
        <div className="p-5 md:p-7 max-w-3xl mx-auto">
          <div className="rounded-lg border border-border bg-surface p-6 text-center" role="alert">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 text-danger" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">Something went wrong</p>
            <p className="text-xs mt-1 break-words text-muted-foreground">{current.error}</p>
            <button className="btn-secondary mt-4" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {isPlanned(current.payload) ? (
        <TodayDay payload={current.payload} tz={tz} onChange={change} onRefresh={refresh} onReviewed={onReviewed} />
      ) : (
        <NotPlanned date={current.payload.date} />
      )}
    </Shell>
  );
}

// No plan yet: the day is planned on New tasks → Label tasks, whose
// "Start with A1" saves the plan and comes back here.
function NotPlanned({ date }: { date: string }) {
  return (
    <div className="p-5 md:p-7 max-w-3xl mx-auto text-foreground">
      <h1 className="text-[28px] sm:text-4xl font-semibold tracking-[-0.025em] leading-[1.1]">Plan your day</h1>
      <p className="text-sm mt-2 mb-5 text-muted-foreground">{formatDateKeyLong(date)}</p>
      <div className="rounded-lg border border-border bg-surface p-5">
        <ol className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>1. Write down everything you have to do.</li>
          <li>2. Put A, B, C, D or E on each task and drag them into order.</li>
          <li>3. Start with A1, your frog.</li>
        </ol>
        <div className="flex flex-wrap gap-2 mt-5">
          <Link href="/today/new" className="btn-primary">
            <ListPlus className="w-4 h-4" aria-hidden="true" /> New tasks
          </Link>
          <Link href="/today/label" className="btn-ghost border border-border">
            <Tags className="w-3.5 h-3.5" aria-hidden="true" /> Label tasks
          </Link>
        </div>
      </div>
    </div>
  );
}

// The page scrolls inside the layout's overflow-hidden <main>.
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto bg-background">{children}</div>;
}

function Skeleton() {
  const block = (h: string, extra = "") => (
    <div className={`rounded-lg border border-border bg-raised animate-pulse ${extra}`} style={{ height: h }} />
  );
  return (
    <div className="p-5 md:p-7 max-w-3xl mx-auto flex flex-col gap-4" role="status" aria-busy="true" aria-label="Loading today">
      <div className="rounded-lg animate-pulse bg-raised" style={{ height: "2rem", width: "40%" }} />
      {block("11rem")}
      {block("3.5rem")}
      {block("3.5rem")}
      {block("3.5rem")}
    </div>
  );
}
