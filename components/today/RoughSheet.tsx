"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, ListPlus, RefreshCw } from "lucide-react";
import { openCommandPalette } from "@/components/command/CommandPalette";
import { addDays } from "@/lib/frog/dates";
import { formatDateKeyLong } from "@/lib/frog/dayview";
import { fetchNote, saveNote, type DailyNote } from "./api";
import RadioGroup from "./RadioGroup";

// The rough sheet: a free-text brain dump for the day, written before planning.
// Any line can be turned into a task (through quick add); lines that became
// tasks get a "→ " in front. Two taps of check-in sit on top: how you feel and
// how sure you are of finishing today's list.

const MOODS = [1, 2, 3, 4] as const;
const MOOD_LABEL: Record<number, string> = { 1: "Low", 2: "Okay", 3: "Good", 4: "Great" };
const CONFIDENCE = [1, 2, 3] as const;
const CONFIDENCE_LABEL: Record<number, string> = { 1: "Not really", 2: "Maybe", 3: "Yes" };
const TASK_MARK = "→ ";
const SAVE_DELAY = 700;

type Status = "idle" | "saving" | "saved" | "error";

interface Props {
  date: string;
  /** Start folded into a one-line summary (on a day that's already planned). */
  collapsible?: boolean;
}

export default function RoughSheet({ date, collapsible = false }: Props) {
  const [loaded, setLoaded] = useState<{ date: string; previous: { date: string; body: string } | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(!collapsible);
  const [showPrevious, setShowPrevious] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // The body as last sent to the server, and the line waiting for quick add to create its task.
  const savedBody = useRef("");
  const pendingLine = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchNote(date)
      .then(({ note, previous }) => {
        if (cancelled) return;
        apply(note);
        setLoaded({ date, previous });
        setLoadError(null);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Couldn't load the rough sheet"));
    return () => {
      cancelled = true;
    };
  }, [date, nonce]);

  function apply(note: DailyNote | null) {
    setBody(note?.body ?? "");
    savedBody.current = note?.body ?? "";
    setMood(note?.mood ?? null);
    setConfidence(note?.confidence ?? null);
    setStatus("idle");
  }

  const ready = loaded?.date === date;

  // Autosave the text a moment after typing stops.
  useEffect(() => {
    if (!ready || body === savedBody.current) return;
    const timer = window.setTimeout(() => void persist({ body }), SAVE_DELAY);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, ready]);

  // Leaving the page with unsaved text: send it anyway.
  const latest = useRef({ date, body, ready });
  latest.current = { date, body, ready };
  useEffect(() => {
    return () => {
      const { date: d, body: b, ready: r } = latest.current;
      if (r && b !== savedBody.current) void saveNote({ date: d, body: b }, true).catch(() => {});
    };
  }, []);

  // A task made from a line: mark that line once quick add has created it.
  useEffect(() => {
    function onCreated(e: Event) {
      const line = pendingLine.current;
      const title = ((e as CustomEvent).detail?.title as string | undefined)?.trim().toLowerCase();
      if (!line || !title) return;
      pendingLine.current = null;
      setBody((b) => {
        const lines = b.split("\n");
        const i = lines.findIndex((l) => l === line && !l.startsWith(TASK_MARK) && l.toLowerCase().includes(title));
        if (i < 0) return b;
        lines[i] = TASK_MARK + lines[i].replace(/^\s*[-*•]\s*/, "");
        return lines.join("\n");
      });
    }
    window.addEventListener("task-created", onCreated);
    return () => window.removeEventListener("task-created", onCreated);
  }, []);

  async function persist(fields: { body?: string; mood?: number | null; confidence?: number | null }) {
    setStatus("saving");
    try {
      const note = await saveNote({ date, ...fields });
      if (fields.body !== undefined) savedBody.current = note.body;
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  /** The line the cursor is on, sent to quick add. */
  function makeTask() {
    const ta = textRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? 0;
    const start = body.lastIndexOf("\n", pos - 1) + 1;
    const end = body.indexOf("\n", pos);
    const line = body.slice(start, end < 0 ? body.length : end);
    const text = line.replace(/^\s*(→|[-*•])\s*/, "").trim();
    if (!text) return;
    pendingLine.current = line;
    openCommandPalette("add", text);
  }

  const lineCount = body.split("\n").filter((l) => l.trim()).length;
  const summary = [
    lineCount > 0 ? `${lineCount} ${lineCount === 1 ? "line" : "lines"}` : "Empty",
    mood ? `feeling ${MOOD_LABEL[mood].toLowerCase()}` : null,
    confidence ? `finish the list: ${CONFIDENCE_LABEL[confidence].toLowerCase()}` : null,
  ].filter(Boolean).join(" · ");

  const previous = ready ? loaded.previous : null;
  const previousLabel = previous && (previous.date === addDays(date, -1) ? "Yesterday's sheet" : `Sheet from ${formatDateKeyLong(previous.date)}`);

  return (
    <section className="rounded-lg border border-border bg-surface mb-5" aria-labelledby="rough-sheet-title">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-2 min-w-0 flex-1 text-left max-lg:py-2.5 max-lg:-my-2.5"
          >
            <ChevronDown className={`w-4 h-4 text-subtle flex-shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
            {/* The summary truncates, never the title. */}
            <h2 id="rough-sheet-title" className="text-sm font-semibold text-foreground max-lg:flex-shrink-0 max-lg:whitespace-nowrap">Rough sheet</h2>
            {!open && ready && <span className="text-xs text-subtle truncate">{summary}</span>}
          </button>
        ) : (
          <h2 id="rough-sheet-title" className="text-sm font-semibold text-foreground flex-1">Rough sheet</h2>
        )}
        <SaveStatus status={status} onRetry={() => void persist({ body, mood, confidence })} />
      </div>

      {open && (
        <div className="px-4 pb-4">
          {loadError ? (
            <div role="alert" className="flex items-center gap-2 text-xs text-danger">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="flex-1">{loadError}</span>
              <button type="button" className="btn-secondary" onClick={() => setNonce((n) => n + 1)}>
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
              </button>
            </div>
          ) : !ready ? (
            <div className="h-32 rounded-md bg-raised animate-pulse" aria-busy="true" aria-label="Loading the rough sheet" />
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 mb-3">
                <CheckIn
                  label="How do you feel?"
                  values={MOODS}
                  names={MOOD_LABEL}
                  value={mood}
                  onChange={(v) => { setMood(v); void persist({ mood: v }); }}
                />
                <CheckIn
                  label="Will you finish today's list?"
                  values={CONFIDENCE}
                  names={CONFIDENCE_LABEL}
                  value={confidence}
                  onChange={(v) => { setConfidence(v); void persist({ confidence: v }); }}
                />
              </div>

              <textarea
                ref={textRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    makeTask();
                  }
                }}
                aria-label="Rough sheet"
                placeholder="Write anything: tasks, ideas, whatever is on your mind. Turn a line into a task when you're ready."
                rows={6}
                maxLength={20_000}
                className="forma-input w-full min-h-[8rem] resize-y !text-sm leading-6"
              />

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2">
                <button type="button" className="btn-secondary" onClick={makeTask}>
                  <ListPlus className="w-3.5 h-3.5" aria-hidden="true" /> Make task from line
                </button>
                <span className="text-xs text-subtle">
                  Puts the line your cursor is on into quick add (<kbd className="font-mono">Ctrl+Enter</kbd>). Lines that became tasks get a →.
                </span>
              </div>

              {previous && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowPrevious((v) => !v)}
                    aria-expanded={showPrevious}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground max-lg:py-2 max-lg:-my-2"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPrevious ? "" : "-rotate-90"}`} aria-hidden="true" />
                    {previousLabel}
                  </button>
                  {showPrevious && (
                    <p className="mt-2 rounded-md bg-raised/70 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap break-words">{previous.body}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function CheckIn({ label, values, names, value, onChange }: { label: string; values: readonly number[]; names: Record<number, string>; value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
      <RadioGroup label={label} values={values} value={value} onChange={onChange} className="flex flex-wrap gap-1.5">
        {(v, on, radio) => (
          <button
            {...radio}
            className={`rounded-md h-8 px-3 text-xs font-medium border transition-colors max-lg:h-10 ${
              on ? "bg-primary-soft border-primary text-foreground" : "bg-raised border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
            }`}
          >
            {names[v]}
          </button>
        )}
      </RadioGroup>
    </div>
  );
}

function SaveStatus({ status, onRetry }: { status: Status; onRetry: () => void }) {
  if (status === "error") {
    return (
      <button type="button" onClick={onRetry} className="text-xs text-danger underline flex-shrink-0 max-lg:py-2 max-lg:-my-2">
        Not saved. Retry
      </button>
    );
  }
  return (
    <span className="text-xs text-subtle flex-shrink-0" aria-live="polite">
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
    </span>
  );
}
