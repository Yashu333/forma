"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import TaskPicker, { type PickedTask } from "@/components/pomodoro/TaskPicker";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Settings, X, Music, SkipBack, SkipForward, Monitor, PictureInPicture2, Shuffle, Volume1 } from "lucide-react";

type Mode = "focus" | "short" | "long";

interface TimerConfig {
  focusMins: number;
  shortMins: number;
  longMins: number;
  sessionsBeforeLong: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
}

const DEFAULT_CONFIG: TimerConfig = {
  focusMins: 25,
  shortMins: 5,
  longMins: 15,
  sessionsBeforeLong: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
};

// Ember: orange marks the active focus block, success green and warm grey mark the breaks.
const MODE_COLORS: Record<Mode, string> = {
  focus: "#F2711C",
  short: "#7DBB8A",
  long:  "#B8AFA7",
};
const MODE_LABELS: Record<Mode, string> = {
  focus: "Focus",
  short: "Short break",
  long:  "Long break",
};

const MONO = "var(--font-jetbrains-mono), 'JetBrains Mono', ui-monospace, monospace";

// Digit card dimensions — responsive via CSS clamp, these are the base values
// for PiP only; the main UI uses CSS custom properties for scaling
const W = 172;   // card width  px  (used for PiP only)
const H = 224;   // card height px  (used for PiP only)
const FONT = 164; // font size   px  (used for PiP only)

// ── Audio ─────────────────────────────────────────────────────────────────────

function buildAlarmBuffer(ctx: AudioContext): AudioBuffer {
  const duration = 1.4, sr = ctx.sampleRate;
  const len = Math.floor(duration * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  const tones = [880, 1046, 1318];
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const tone = tones[Math.floor(t / (duration / tones.length)) % tones.length];
    data[i] = Math.sin(2 * Math.PI * tone * t) * 0.45 * Math.min(1, (duration - t) / 0.3);
  }
  return buf;
}

// Starts a looping alarm. Returns a stop function.
function startLoopingAlarm(ctx: AudioContext): () => void {
  let stopped = false;
  let currentSrc: AudioBufferSourceNode | null = null;
  const buf = buildAlarmBuffer(ctx);

  function scheduleNext() {
    if (stopped) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    currentSrc = src;
    src.onended = () => {
      if (!stopped) scheduleNext();
    };
    src.start();
  }

  scheduleNext();

  return () => {
    stopped = true;
    try { currentSrc?.stop(); } catch {}
  };
}

// ── Flip digit ────────────────────────────────────────────────────────────────
//
// Split-flap mechanism:
//   Phase 0 (idle):  top=current, bottom=current
//   Phase 1 (flip):  top=old, bottom=old, flap (top-half of old) rotates DOWN
//                    revealing bottom which is ALSO still old — looks like old
//   Phase 2 (done):  flap removed, top=new, bottom=new → full new digit visible
//
// The key insight: bottom stays on OLD digit during the animation so the card
// always shows a complete digit. Only after the flap hits 90° do we cut to new.

function FlipDigit({ digit }: { digit: string; prev: string }) {
  // "shown" is what both static halves display — lags behind `digit` by one tick
  const [shown, setShown]     = useState(digit);
  const [flipping, setFlip]   = useState(false);

  useEffect(() => {
    if (digit === shown) return;
    const t1 = setTimeout(() => setFlip(true), 0);
    const t2 = setTimeout(() => {
      setFlip(false);
      setShown(digit);
    }, 340);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digit]);

  const numStyle: React.CSSProperties = {
    fontFamily: MONO,
    fontWeight: 600,
    fontSize: "var(--digit-font)",
    lineHeight: 1,
    color: "var(--foreground)",
    userSelect: "none",
    position: "absolute",
    width: "100%",
    textAlign: "center",
  };

  return (
    <div style={{ position: "relative", width: "var(--digit-w)", height: "var(--digit-h)" }}>
      {/* Card shadow */}
      <div style={{
        position: "absolute", inset: 0,
        borderRadius: 10,
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }} />

      {/* Static top half — always shows `shown` (old during flip) */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        height: "50%", overflow: "hidden",
        borderRadius: "10px 10px 0 0",
        background: "var(--raised)",
        borderBottom: "1px solid var(--background)",
      }}>
        <div style={{ ...numStyle, bottom: 0, transform: "translateY(50%)" }}>
          {shown}
        </div>
      </div>

      {/* Static bottom half — always shows `shown` (old during flip) */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: "50%", overflow: "hidden",
        borderRadius: "0 0 10px 10px",
        background: "var(--surface)",
      }}>
        <div style={{ ...numStyle, top: 0, transform: "translateY(-50%)" }}>
          {shown}
        </div>
      </div>

      {/* Animated flap: top-half of OLD digit rotating down */}
      {flipping && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          height: "50%", overflow: "hidden",
          borderRadius: "10px 10px 0 0",
          background: "var(--raised)",
          zIndex: 4,
          transformOrigin: "50% 100%",
          animation: "flapDown 0.34s cubic-bezier(0.55,0,0.45,1) forwards",
          backfaceVisibility: "hidden",
        }}>
          <div style={{ ...numStyle, bottom: 0, transform: "translateY(50%)" }}>
            {shown}
          </div>
          {/* Progressive shadow as flap falls */}
          <div style={{
            position: "absolute", inset: 0,
            background: "color-mix(in srgb, var(--background) 55%, transparent)",
            animation: "flapShade 0.34s ease forwards",
          }} />
        </div>
      )}

      {/* Center seam */}
      <div style={{
        position: "absolute", left: 0, right: 0,
        top: "calc(50% - 1px)", height: 2,
        background: "var(--background)", zIndex: 5,
      }} />
    </div>
  );
}

// ── Flip clock ────────────────────────────────────────────────────────────────

function FlipClock({ seconds }: { seconds: number }) {
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  const prevRef = useRef(seconds);
  const [prev, setPrev] = useState({ mins, secs });

  useEffect(() => {
    const ps = prevRef.current;
    setPrev({
      mins: String(Math.floor(ps / 60)).padStart(2, "0"),
      secs: String(ps % 60).padStart(2, "0"),
    });
    prevRef.current = seconds;
  }, [seconds]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "clamp(6px,2vw,14px)" }}>
      <div style={{ display: "flex", gap: "clamp(4px,1vw,8px)" }}>
        <FlipDigit digit={mins[0]} prev={prev.mins[0]} />
        <FlipDigit digit={mins[1]} prev={prev.mins[1]} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "clamp(10px,1.5vw,18px)", marginBottom: 6 }}>
        {[0, 1].map(i => (
          <div key={i} style={{
            width: "clamp(6px,1vw,10px)", height: "clamp(6px,1vw,10px)", borderRadius: "50%",
            background: "var(--muted-foreground)",
          }} />
        ))}
      </div>

      <div style={{ display: "flex", gap: "clamp(4px,1vw,8px)" }}>
        <FlipDigit digit={secs[0]} prev={prev.secs[0]} />
        <FlipDigit digit={secs[1]} prev={prev.secs[1]} />
      </div>
    </div>
  );
}

// ── Settings modal ────────────────────────────────────────────────────────────

function SettingsModal({
  config, saving, onSave, onClose,
}: {
  config: TimerConfig;
  saving: boolean;
  onSave: (c: TimerConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config);
  // Raw string values for the number inputs so the user can clear and retype freely
  const [raw, setRaw] = useState<Record<string, string>>({
    focusMins: String(config.focusMins),
    shortMins: String(config.shortMins),
    longMins: String(config.longMins),
    sessionsBeforeLong: String(config.sessionsBeforeLong),
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "color-mix(in srgb, var(--background) 85%, transparent)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Timer settings"
        className="pomodoro-settings-modal"
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: 8,
          padding: "28px 32px 24px",
          width: 480,
          fontSize: 13,
          display: "flex", flexDirection: "column", gap: 0,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ color: "var(--foreground)", fontWeight: 600, fontSize: 15 }}>Timer settings</div>
            <div style={{ color: "var(--subtle)", fontSize: 12, marginTop: 2 }}>Changes apply on save</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="pomo-outline" style={{ background: "var(--raised)", border: "1px solid var(--border)", cursor: "pointer", color: "var(--muted-foreground)", display: "flex", padding: 6, borderRadius: 6 }}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Section label */}
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 10 }}>Durations</div>

        {/* Duration sliders */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
          {([
            ["Focus duration", "focusMins", 1, 90, " min"],
            ["Short break",    "shortMins", 1, 30, " min"],
            ["Long break",     "longMins",  5, 60, " min"],
            ["Sessions per cycle", "sessionsBeforeLong", 2, 8, ""],
          ] as [string, keyof TimerConfig, number, number, string][]).map(([label, key, min, max, unit]) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label htmlFor={`pomo-${key}`} style={{ color: "var(--muted-foreground)", fontSize: 13 }}>{label}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    id={`pomo-${key}`}
                    type="number"
                    min={min} max={max}
                    value={raw[key]}
                    onChange={e => setRaw(r => ({ ...r, [key]: e.target.value }))}
                    onBlur={e => {
                      const v = Math.min(max, Math.max(min, parseInt(e.target.value, 10) || min));
                      setRaw(r => ({ ...r, [key]: String(v) }));
                      setDraft(d => ({ ...d, [key]: v }));
                    }}
                    className="forma-number"
                    style={{
                      width: 52, textAlign: "center",
                      background: "var(--raised)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 6, padding: "3px 0",
                      color: "var(--foreground)", fontSize: 13, fontWeight: 600,
                      fontFamily: MONO, outline: "none",
                      display: "block",
                    }}
                  />
                  {unit && <span style={{ fontSize: 12, color: "var(--subtle)" }}>{unit.trim()}</span>}
                </div>
              </div>
              <input
                type="range" min={min} max={max} value={draft[key] as number}
                onChange={e => {
                const v = Number(e.target.value);
                setDraft(d => ({ ...d, [key]: v }));
                setRaw(r => ({ ...r, [key]: String(v) }));
              }}
                style={{ width: "100%", cursor: "pointer" }}
                aria-label={label}
                className="forma-range"
              />
            </div>
          ))}
        </div>

        {/* Section label */}
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 10 }}>Auto-start</div>

        {/* Toggles */}
        <div style={{
          display: "flex", flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 8, overflow: "hidden",
          marginBottom: 20,
        }}>
          {([
            ["autoStartBreaks", "Auto-start breaks", "Break starts automatically after focus"],
            ["autoStartFocus",  "Auto-start focus",  "Focus starts automatically after break"],
          ] as [keyof TimerConfig, string, string][]).map(([key, label, desc], i) => (
            <div
              key={key}
              role="switch"
              aria-checked={!!draft[key]}
              aria-label={label}
              tabIndex={0}
              onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setDraft(d => ({ ...d, [key]: !d[key] })); } }}
              onClick={() => setDraft(d => ({ ...d, [key]: !d[key] }))}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                padding: "11px 14px",
                background: i === 0 ? "var(--surface)" : "var(--raised)",
                cursor: "pointer",
                borderBottom: i === 0 ? "1px solid var(--border)" : "none",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: 12, color: "var(--subtle)" }}>{desc}</span>
              </div>
              <div style={{
                width: 44, height: 26, borderRadius: 999, flexShrink: 0,
                background: draft[key] ? "var(--primary)" : "var(--raised)",
                border: `1px solid ${draft[key] ? "var(--primary)" : "var(--input)"}`,
                position: "relative",
                transition: "background 0.18s, border-color 0.18s",
              }}>
                <div style={{
                  position: "absolute",
                  top: 3, left: draft[key] ? 20 : 3,
                  width: 18, height: 18, borderRadius: "50%",
                  background: draft[key] ? "var(--primary-foreground)" : "var(--muted-foreground)",
                  transition: "left 0.18s ease, background 0.18s",
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* Save button */}
        <button
          onClick={() => { onSave(draft); onClose(); }}
          disabled={saving}
          className="btn-primary w-full"
          style={{ padding: "10px 0" }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <style>{`
        .forma-range {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 2px;
          background: var(--raised);
          outline: none;
          border: none;
        }
        .forma-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px; height: 16px;
          border-radius: 50%;
          background: var(--primary);
          cursor: pointer;
          border: 2px solid var(--surface);
          margin-top: -6px;
        }
        .forma-range::-moz-range-thumb {
          width: 16px; height: 16px;
          border-radius: 50%;
          background: var(--primary);
          cursor: pointer;
          border: 2px solid var(--surface);
        }
        .forma-range::-webkit-slider-runnable-track {
          background: var(--raised);
          border-radius: 2px;
          height: 4px;
          transition: background 0.15s;
        }
        .forma-range:hover::-webkit-slider-runnable-track {
          background: color-mix(in srgb, var(--primary) 25%, transparent);
        }
        .forma-range:active::-webkit-slider-runnable-track {
          background: color-mix(in srgb, var(--primary) 45%, transparent);
        }
        .forma-range::-moz-range-track {
          background: var(--raised);
          border-radius: 2px;
          height: 4px;
          transition: background 0.15s;
        }
        .forma-range:hover::-moz-range-track {
          background: color-mix(in srgb, var(--primary) 25%, transparent);
        }
        .forma-range:active::-moz-range-track {
          background: color-mix(in srgb, var(--primary) 45%, transparent);
        }
        .forma-range::-webkit-slider-container {
          padding-block: 0;
        }
        /* Hide number input spinners */
        .forma-number::-webkit-outer-spin-button,
        .forma-number::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .forma-number:hover { border-color: var(--input) !important; }
        .forma-number:focus { border-color: var(--primary) !important; }
        .forma-number {
          -moz-appearance: textfield;
        }
      `}</style>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface Pending { nextMode: Mode; autoStart: boolean }

export default function PomodoroPage() {
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    setIsTouchDevice(mq.matches);
    const h = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  const [config, setConfig]     = useState<TimerConfig>(DEFAULT_CONFIG);
  const [mode, setMode]         = useState<Mode>("focus");
  const [secondsLeft, setLeft]  = useState(DEFAULT_CONFIG.focusMins * 60);
  const [running, setRunning]   = useState(false);
  const [muted, setMuted]       = useState(false);
  const [sessions, setSessions] = useState(0);
  const [alarmRinging, setAlarmRinging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSaving] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  // The task focus time is logged against (optional), and the one a session was started on.
  const [task, setTask] = useState<PickedTask | null>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);

  const workerRef          = useRef<Worker | null>(null);
  const audioCtxRef        = useRef<AudioContext | null>(null);
  const stopAlarmRef       = useRef<(() => void) | null>(null);
  const pendingRef         = useRef<Pending | null>(null);
  const pipRef             = useRef<Window | null>(null);
  const spotifyWasPaused   = useRef(false);
  // Wall-clock anchor: set when timer starts, used to compute elapsed time accurately
  const startedAtRef       = useRef<number | null>(null);
  const secondsAtStartRef  = useRef<number>(0);
  const hydratedRef        = useRef(false);
  // Focus time of the session in progress: when it began, seconds already run
  // before the current stretch (pauses split a session), and the task it is for.
  const taskRef            = useRef<string | null>(null);
  const focusLogRef        = useRef<{ startedAt: number; accSec: number; taskId: string | null } | null>(null);

  function chooseTask(t: PickedTask | null) {
    taskRef.current = t?.id ?? null;
    setTask(t);
    setDoneNote(null);
    try {
      if (t) localStorage.setItem("pomodoro_task", JSON.stringify(t));
      else localStorage.removeItem("pomodoro_task");
    } catch {}
  }

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem("pomodoro_mode") as Mode | null;
      if (savedMode && ["focus", "short", "long"].includes(savedMode)) setMode(savedMode);
      const savedSessions = localStorage.getItem("pomodoro_sessions");
      if (savedSessions) setSessions(parseInt(savedSessions, 10) || 0);
    } catch {}
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("task");
      const saved = localStorage.getItem("pomodoro_task");
      const stored: PickedTask | null = saved ? JSON.parse(saved) : null;
      if (fromUrl) {
        // A link from a task: look it up, then drop the param so a reload doesn't redo this.
        window.history.replaceState(null, "", window.location.pathname);
        fetch(`/api/tasks/${encodeURIComponent(fromUrl)}`)
          .then(r => (r.ok ? r.json() : null))
          .then((t: { id: string; title: string; group?: { color: string } } | null) => {
            if (t) chooseTask({ id: t.id, title: t.title, color: t.group?.color ?? "#B8AFA7" });
          })
          .catch(() => {});
      } else if (stored && typeof stored.id === "string") {
        taskRef.current = stored.id;
        setTask(stored);
        // Drop it if the task is gone or already done.
        fetch("/api/today/candidates")
          .then(r => (r.ok ? r.json() : null))
          .then((list: { id: string }[] | null) => { if (list && !list.some(c => c.id === stored.id)) chooseTask(null); })
          .catch(() => {});
      }
    } catch {}
    hydratedRef.current = true;
  }, []);

  useEffect(() => { if (hydratedRef.current) try { localStorage.setItem("pomodoro_sessions", String(sessions)); } catch {} }, [sessions]);
  useEffect(() => { if (hydratedRef.current) try { localStorage.setItem("pomodoro_mode", mode); } catch {} }, [mode]);

  // Persistence of timer state is handled in the anchor effect below (after refs are set)

  useEffect(() => {
    fetch("/api/user-settings")
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((s: TimerConfig) => {
        setConfig(s);
        // Restore persisted timer state if it exists
        try {
          const saved = localStorage.getItem("pomodoro_timer_state");
          if (saved) {
            const state = JSON.parse(saved);
            const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
            const totalDuration = state.mode === "focus" ? s.focusMins * 60
              : state.mode === "short" ? s.shortMins * 60 : s.longMins * 60;
            const remaining = Math.max(0, state.secondsAtStart - elapsed);
            if (remaining > 0 && remaining <= totalDuration) {
              setMode(state.mode);
              startedAtRef.current = state.startedAt;
              secondsAtStartRef.current = state.secondsAtStart;
              if (state.mode === "focus" && typeof state.focusStartedAt === "number") {
                focusLogRef.current = { startedAt: state.focusStartedAt, accSec: Number(state.focusAcc) || 0, taskId: state.focusTaskId ?? null };
              }
              setLeft(remaining);
              setRunning(true);

              return;
            } else {
              localStorage.removeItem("pomodoro_timer_state");
            }
          }
        } catch {}
        setLeft(s.focusMins * 60);
      })
      .catch(() => {});
  }, []);

  const dur = useCallback((m: Mode, cfg: TimerConfig) => {
    if (m === "focus") return cfg.focusMins * 60;
    if (m === "short") return cfg.shortMins * 60;
    return cfg.longMins * 60;
  }, []);

  const getAudio = useCallback(() => {
    if (!audioCtxRef.current)
      audioCtxRef.current = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
    return audioCtxRef.current;
  }, []);

  const stopWorker = useCallback(() => {
    if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
  }, []);

  // Dismiss looping alarm → apply pending transition → resume Spotify if we paused it
  const dismissAlarm = useCallback(() => {
    stopAlarmRef.current?.();
    stopAlarmRef.current = null;
    setAlarmRinging(false);
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (!p) return;
    setMode(p.nextMode);
    setLeft(dur(p.nextMode, config));
    setRunning(false);
    // Resume Spotify only if we were the ones who paused it
    if (spotifyWasPaused.current) {
      spotifyWasPaused.current = false;
      spotifyCtrlRef.current?.("play");
    }
    if (p.autoStart) {
      setTimeout(() => setRunning(true), 50);
    }
  }, [config, dur]);

  // Logs the focus session in progress (if any) against its task. `segmentSec` is how long
  // the current stretch has run since the last start or resume. Short sessions and failures are ignored:
  // a failed log must never get in the way of the timer.
  const logFocus = useCallback((completed: boolean, segmentSec: number) => {
    const log = focusLogRef.current;
    focusLogRef.current = null;
    if (!log) return;
    const sec = Math.round(log.accSec + segmentSec);
    if (sec < 60) return;
    fetch("/api/focus-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        taskId: log.taskId ?? taskRef.current,
        startedAt: new Date(log.startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        durationSec: sec,
        completed,
      }),
    }).catch(() => {});
  }, []);

  const runningSegmentSec = useCallback(() => {
    if (startedAtRef.current === null) return 0;
    return Math.min(secondsAtStartRef.current, Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)));
  }, []);

  const stop = useCallback(() => {
    // Stopping, resetting or skipping a focus session ends it early.
    logFocus(false, runningSegmentSec());
    stopWorker();
    setRunning(false);
    try { localStorage.removeItem("pomodoro_timer_state"); } catch {}
    // If alarm is ringing when user hits stop/reset, dismiss it too
    if (stopAlarmRef.current) {
      stopAlarmRef.current();
      stopAlarmRef.current = null;
      setAlarmRinging(false);
      pendingRef.current = null;
      setPending(null);
      // Resume Spotify if we paused it for the alarm
      if (spotifyWasPaused.current) {
        spotifyWasPaused.current = false;
        spotifyCtrlRef.current?.("play");
      }
    }
  }, [stopWorker, logFocus, runningSegmentSec]);

  const reset = useCallback(() => {
    // If the alarm is ringing, the session count was already incremented when
    // the timer hit 0. Revert it so resetting feels like restarting the same session.
    if (stopAlarmRef.current) {
      setSessions(s => mode === "focus" ? Math.max(0, s - 1) : s);
    }
    stop();
    setLeft(dur(mode, config));
  }, [mode, config, stop, dur]);
  const switchMode = useCallback((m: Mode) => {
    stop();
    setMode(m);
    setLeft(dur(m, config));
  }, [config, stop, dur]);

  // Capture wall-clock anchor whenever timer starts + persist state
  useEffect(() => {
    if (running) {
      if (startedAtRef.current === null) {
        startedAtRef.current = Date.now();
        secondsAtStartRef.current = secondsLeft;
      }
      if (mode === "focus" && !focusLogRef.current) {
        focusLogRef.current = { startedAt: Date.now(), accSec: 0, taskId: taskRef.current };
      }
      try {
        localStorage.setItem("pomodoro_timer_state", JSON.stringify({
          startedAt: startedAtRef.current,
          secondsAtStart: secondsAtStartRef.current,
          mode,
          focusStartedAt: focusLogRef.current?.startedAt ?? null,
          focusAcc: focusLogRef.current?.accSec ?? 0,
          focusTaskId: focusLogRef.current?.taskId ?? null,
        }));
      } catch {}
    } else {
      // A pause (or a stop/expiry, which already cleared the log) ends a stretch of a focus session.
      if (startedAtRef.current !== null && focusLogRef.current) focusLogRef.current.accSec += runningSegmentSec();
      startedAtRef.current = null;
      try { localStorage.removeItem("pomodoro_timer_state"); } catch {}
    }
  // secondsLeft intentionally excluded — we only snapshot it at the moment running flips to true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode]);

  // Resync timer immediately when tab becomes visible (browsers throttle background intervals)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && startedAtRef.current !== null) {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        const remaining = Math.max(0, secondsAtStartRef.current - elapsed);
        setLeft(remaining);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!running) return;

    const fireExpiry = () => {
      stopWorker();
      setRunning(false);
      try { localStorage.removeItem("pomodoro_timer_state"); } catch {}

      // The stretch that just ran out lasted the whole time left at its start.
      if (mode === "focus") logFocus(true, secondsAtStartRef.current);

      const nextSessions = mode === "focus" ? sessions + 1 : sessions;
      setSessions(nextSessions);

      let nextMode: Mode;
      let autoStart: boolean;
      if (mode === "focus") {
        nextMode  = nextSessions % config.sessionsBeforeLong === 0 ? "long" : "short";
        autoStart = config.autoStartBreaks;
      } else {
        nextMode  = "focus";
        autoStart = config.autoStartFocus;
      }

      pendingRef.current = { nextMode, autoStart };
      setPending({ nextMode, autoStart });

      if (!muted) {
        try {
          stopAlarmRef.current?.();
          stopAlarmRef.current = startLoopingAlarm(getAudio());
        } catch {}
      }
      const ctrl = spotifyCtrlRef.current;
      if (ctrl) {
        spotifyWasPaused.current = true;
        ctrl("pause");
      }
      setAlarmRinging(true);
      setLeft(0);
    };

    const blob = new Blob(
      [`setInterval(()=>postMessage("t"),250)`],
      { type: "application/javascript" },
    );
    const w = new Worker(URL.createObjectURL(blob));
    workerRef.current = w;

    w.onmessage = () => {
      const elapsed = startedAtRef.current !== null
        ? Math.floor((Date.now() - startedAtRef.current) / 1000)
        : 0;
      const remaining = Math.max(0, secondsAtStartRef.current - elapsed);

      if (remaining === 0) {
        fireExpiry();
        return;
      }

      setLeft(remaining);
    };

    return () => stopWorker();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, muted, mode, config, sessions]);

  const saveConfig = useCallback(async (c: TimerConfig) => {
    setSaving(true);
    try {
      const res = await fetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Only the six timer fields, so saving can't reset other settings (e.g. frog-first mode).
        body: JSON.stringify({
          focusMins: c.focusMins, shortMins: c.shortMins, longMins: c.longMins,
          sessionsBeforeLong: c.sessionsBeforeLong, autoStartBreaks: c.autoStartBreaks, autoStartFocus: c.autoStartFocus,
        }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setConfig(c);
      if (!running) setLeft(dur(mode, c));
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }, [mode, running, dur]);

  // Moves the picked task to its project's Done column (the server picks the column).
  async function markTaskDone() {
    if (!task) return;
    const title = task.title;
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markDone: true, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        setDoneNote(typeof b?.error === "string" ? b.error : "Couldn't mark it done");
        return;
      }
      chooseTask(null);
      setDoneNote(`Marked "${title}" done`);
    } catch {
      setDoneNote("Couldn't mark it done");
    }
  }

  const buildPiPHtml = useCallback((secs: number, m: Mode) => {
    const mins = String(Math.floor(secs / 60)).padStart(2, "0");
    const secsStr = String(secs % 60).padStart(2, "0");
    const col = MODE_COLORS[m];
    return `
      <div id="pip-root" style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100vh;gap:4px;
        background:#1D1B19;
        font-family:'JetBrains Mono','SF Mono','Consolas',monospace;
      ">
        <div style="display:flex;align-items:center;gap:8px">
          ${["m0","m1","sep","s0","s1"].map(part => {
            if (part === "sep") return `
              <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:3px">
                <div style="width:5px;height:5px;border-radius:50%;background:#B8AFA7"></div>
                <div style="width:5px;height:5px;border-radius:50%;background:#B8AFA7"></div>
              </div>`;
            const ch = part.startsWith("m") ? mins[parseInt(part[1])] : secsStr[parseInt(part[1])];
            return `
              <div style="
                position:relative;width:46px;height:60px;
                border-radius:8px;
                background:#272422;
                border:1px solid #46423D;
                overflow:hidden;
              ">
                <div class="pip-digit" style="
                  position:absolute;top:50%;left:50%;
                  transform:translate(-50%,-50%);
                  font-size:43px;font-weight:700;line-height:1;
                  color:#F5F0EB;user-select:none;text-align:center;width:100%;
                ">${ch}</div>
              </div>`;
          }).join("")}
        </div>
        <div id="pip-mode" style="font-size:12px;color:${col};font-weight:600">${MODE_LABELS[m]}</div>
      </div>`;
  }, []);

  const openPiP = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dpip = (window as any).documentPictureInPicture;
    if (!dpip) return;
    if (pipRef.current && !pipRef.current.closed) { pipRef.current.close(); pipRef.current = null; return; }
    const pip = await dpip.requestWindow({ width: 240, height: 96 });
    pipRef.current = pip;
    pip.document.documentElement.style.cssText = "height:100%;margin:0;padding:0";
    pip.document.body.style.cssText = "margin:0;padding:0;height:100%;overflow:hidden";
    pip.document.body.innerHTML = buildPiPHtml(secondsLeft, mode);
    pip.addEventListener("pagehide", () => { pipRef.current = null; });
  }, [secondsLeft, mode, buildPiPHtml]);

  // Keep PiP display in sync with timer
  useEffect(() => {
    const pip = pipRef.current;
    if (!pip || pip.closed) return;
    const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
    const secs = String(secondsLeft % 60).padStart(2, "0");
    const digits = [mins[0], mins[1], secs[0], secs[1]];
    pip.document.querySelectorAll<HTMLElement>(".pip-digit").forEach((el, i) => {
      if (el.textContent !== digits[i]) el.textContent = digits[i];
    });
    const col = MODE_COLORS[mode];
    const modeEl = pip.document.getElementById("pip-mode");
    if (modeEl) {
      if (modeEl.textContent !== MODE_LABELS[mode]) modeEl.textContent = MODE_LABELS[mode];
      modeEl.style.color = col;
    }
    const rootEl = pip.document.getElementById("pip-root");
    if (rootEl) {
      if (rootEl.style.background !== "#1D1B19") rootEl.style.background = "#1D1B19";
    }
  }, [secondsLeft, mode]);

  const color = MODE_COLORS[mode];
  const dotsInCycle = sessions % config.sessionsBeforeLong;
  const completedCycles = Math.floor(sessions / config.sessionsBeforeLong);

  return (
    <div style={{
      // Dynamic viewport height (fits between a phone's browser bars), clear of
      // the notch and home indicator in an installed app; env() is 0 on desktop.
      // maxWidth: before the stylesheet applies, body still has its default 8px
      // margin, and a 100vw box then made phones zoom the page out for good.
      height: "100dvh", width: "100vw", maxWidth: "100%", overflow: "hidden",
      paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)",
      paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)",
      background: "var(--background)", display: "flex", flexDirection: "column", position: "relative",
      // Digit card dimensions — smaller on touch to fit portrait + landscape without scrolling.
      // The min(…vw) caps only bite below ~460px wide (a 360px phone before touch is detected,
      // or one under 360px): four cards, the colon and the gaps then still fit the screen.
      ["--digit-w" as string]: isTouchDevice ? "min(clamp(68px, 16vw, 120px), 19vw)" : "min(clamp(88px, 12vw, 172px), 19vw)",
      ["--digit-h" as string]: isTouchDevice ? "min(clamp(88px, 21vw, 156px), 24.6vw)" : "min(clamp(114px, 16vw, 224px), 24.6vw)",
      ["--digit-font" as string]: isTouchDevice ? "min(clamp(64px, 15vw, 114px), 17.9vw)" : "min(clamp(84px, 11vw, 164px), 18.1vw)",
    }}>

      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", borderBottom: "1px solid var(--border)",
        background: "var(--surface)", position: "relative", zIndex: 10, flexShrink: 0,
        flexWrap: "wrap", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <StatChip label="Sessions" value={String(sessions)} />
          <StatChip label="Cycles" value={String(completedCycles)} />
          <div style={{ width: 1, height: 28, background: "var(--border)" }} />
          <StatChip label="Focus" value={`${config.focusMins}m`} color={MODE_COLORS.focus} />
          <StatChip label="Short" value={`${config.shortMins}m`} color={MODE_COLORS.short} />
          <StatChip label="Long" value={`${config.longMins}m`} color={MODE_COLORS.long} />
          <StatChip label="Per cycle" value={String(config.sessionsBeforeLong)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => { stop(); setMode("focus"); setLeft(dur("focus", config)); setSessions(0); try { localStorage.removeItem("pomodoro_sessions"); localStorage.removeItem("pomodoro_mode"); localStorage.removeItem("pomodoro_timer_state"); } catch {} }}
            title="Reset full cycle"
            aria-label="Reset full cycle"
            className="pomo-outline"
            style={{ width: 34, height: 34, borderRadius: 8, background: "transparent", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
            <RotateCcw size={15} style={{ transform: "scaleX(-1)" }} aria-hidden="true" />
          </button>
          <button onClick={() => setMuted(m => !m)} title={muted ? "Unmute" : "Mute"}
            aria-label={muted ? "Unmute" : "Mute"}
            className="pomo-outline"
            style={{ width: 34, height: 34, borderRadius: 8, background: "transparent", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: muted ? "var(--subtle)" : "var(--muted-foreground)" }}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button onClick={() => setShowSettings(true)} title="Settings"
            aria-label="Settings"
            className="pomo-outline"
            style={{ width: 34, height: 34, borderRadius: 8, background: "transparent", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
            <Settings size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: isTouchDevice ? 14 : 24, position: "relative", zIndex: 1, padding: isTouchDevice ? "12px 16px" : "16px 16px", overflowY: isTouchDevice ? "hidden" : "auto" }}>

        {/* Spotify widget — bottom-right on desktop, top-right on touch (tablet/phone) */}
        <div className="spotify-widget-anchor" style={{ position: "absolute", zIndex: 20, right: isTouchDevice ? 16 : 28, ...(isTouchDevice ? { top: 16 } : { bottom: 24 }) }}>
          <Suspense>
            <SpotifyWidget />
          </Suspense>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {(["focus", "short", "long"] as Mode[]).map(m => (
            <button key={m} onClick={() => switchMode(m)} className={mode === m ? undefined : "pomo-outline"} style={{
              padding: isTouchDevice ? "6px 14px" : "8px 21px", borderRadius: 8,
              border: `1px solid ${mode === m ? color + "80" : "var(--border)"}`,
              background: mode === m ? color + "18" : "transparent",
              color: mode === m ? color : "var(--muted-foreground)",
              fontSize: isTouchDevice ? 13 : 15, fontWeight: 600,
              cursor: "pointer", transition: "background-color 0.15s, border-color 0.15s, color 0.15s",
            }} aria-pressed={mode === m}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Working on: focus time is logged against this task */}
        <TaskPicker value={task} onChange={chooseTask} />
        {doneNote && <span role="status" style={{ fontSize: 13, color: "var(--success)", marginTop: -8 }}>{doneNote}</span>}

        {/* Flip clock */}
        <FlipClock seconds={secondsLeft} />

        {/* Alarm dismiss banner */}
        {alarmRinging && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 20px", borderRadius: 8,
            background: "var(--surface)", border: "1px solid var(--border)",
            animation: "pulse 1.2s ease-in-out infinite",
          }} role="alert">
            <span style={{ fontSize: 13, fontWeight: 600, color: color }}>
              {pending?.nextMode === "focus" ? "Break's over." : "Time's up."}
              {" "}
              <span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}>
                {pending?.autoStart
                  ? `${pending.nextMode === "focus" ? "Focus" : pending.nextMode === "long" ? "Long break" : "Short break"} starting after you stop the alarm.`
                  : "Stop the alarm when you're ready."}
              </span>
            </span>
            {task && pending && pending.nextMode !== "focus" && (
              <button onClick={markTaskDone} className="pomo-outline" style={{
                padding: "5px 14px", borderRadius: 6, border: "1px solid var(--border)",
                background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                Mark done
              </button>
            )}
            <button onClick={dismissAlarm} style={{
              padding: "5px 14px", borderRadius: 6, border: "none",
              background: color, color: "var(--primary-foreground)", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}>
              Stop alarm
            </button>
          </div>
        )}

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: alarmRinging ? 0 : 4 }}>
          <button onClick={reset} title="Reset timer"
            style={{ width: isTouchDevice ? 42 : 50, height: isTouchDevice ? 42 : 50, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", transition: "color 0.15s, border-color 0.15s" }}
            aria-label="Reset timer"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--foreground)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--muted-foreground)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
            <RotateCcw size={isTouchDevice ? 18 : 22} />
          </button>

          <button
            onClick={() => { if (!running && !alarmRinging) getAudio(); setRunning(r => !r); }}
            disabled={alarmRinging}
            style={{
              width: isTouchDevice ? 62 : 76, height: isTouchDevice ? 62 : 76, borderRadius: 12,
              background: alarmRinging ? "var(--raised)" : color,
              border: "none", cursor: alarmRinging ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary-foreground)",
              transition: "background 0.2s",
              opacity: alarmRinging ? 0.4 : 1,
            }}
            aria-label={running ? "Pause" : "Start"}>
            {running ? <Pause size={isTouchDevice ? 26 : 34} /> : <Play size={isTouchDevice ? 26 : 34} style={{ transform: "translateX(2px)" }} />}
          </button>

          <button onClick={openPiP} title="Picture in Picture"
            style={{ width: isTouchDevice ? 42 : 50, height: isTouchDevice ? 42 : 50, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)", transition: "color 0.15s, border-color 0.15s" }}
            aria-label="Picture in picture"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--foreground)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--muted-foreground)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
            <PictureInPicture2 size={isTouchDevice ? 17 : 20} />
          </button>
        </div>

        {/* Session dots */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: isTouchDevice ? 5 : 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {Array.from({ length: config.sessionsBeforeLong }, (_, i) => (
              <div key={i} style={{
                height: isTouchDevice ? 8 : 12, borderRadius: 999,
                width: i < dotsInCycle ? (isTouchDevice ? 20 : 28) : (isTouchDevice ? 8 : 12),
                background: i < dotsInCycle ? color : "var(--raised)",
                border: `1px solid ${i < dotsInCycle ? color + "80" : "var(--border-strong)"}`,
                transition: "width 0.3s ease, background-color 0.3s ease",
              }} />
            ))}
          </div>
          <span style={{ fontSize: isTouchDevice ? 12 : 15, color: "var(--subtle)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
            {dotsInCycle} / {config.sessionsBeforeLong} sessions
          </span>
        </div>

      </div>

      {showSettings && (
        <SettingsModal config={config} saving={savingSettings} onSave={saveConfig} onClose={() => setShowSettings(false)} />
      )}

      <style>{`
        .pomo-outline { transition: border-color 0.15s, color 0.15s, background-color 0.15s; }
        .pomo-outline:hover { border-color: var(--border-strong) !important; color: var(--foreground) !important; }
        @keyframes flapDown {
          0%   { transform: rotateX(0deg); }
          100% { transform: rotateX(-90deg); }
        }
        @keyframes flapShade {
          0%   { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.7; }
        }
        .spotify-vol {
          -webkit-appearance: none;
          appearance: none;
          height: 3px;
          border-radius: 2px;
          outline: none;
          border: none;
          cursor: pointer;
          transition: height 0.15s;
        }
        .spotify-vol:hover { height: 5px; }
        .spotify-vol::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px; height: 12px;
          border-radius: 50%;
          background: #1DB954;
          cursor: pointer;
          border: none;
        }
        .spotify-vol::-moz-range-thumb {
          width: 12px; height: 12px;
          border-radius: 50%;
          background: #1DB954;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
}

// ── Spotify control ref (shared between page + widget) ───────────────────────
// The page needs to pause/resume Spotify on timer events. We expose a stable
// ref so PomodoroPage can call spotifyCtrl.current?.("pause") without prop drilling.
const spotifyCtrlRef = { current: null as ((action: string) => void) | null };

// ── Spotify widget ────────────────────────────────────────────────────────────


interface NowPlaying {
  connected: boolean;
  playing?: boolean;
  shuffle?: boolean;
  volume?: number;
  track?: {
    name: string;
    artists: string;
    albumArt: string | null;
    url: string | null;
    progressMs: number;
    durationMs: number;
  };
}

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  image: string | null;
}

function SpotifyWidget() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<NowPlaying | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [showDevices, setShowDevices] = useState(false);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [isMini, setIsMini] = useState(false);
  const devicesRef = useRef<HTMLDivElement>(null);
  const playlistsRef = useRef<HTMLDivElement>(null);
  const cmdInFlight = useRef(false);
  const volumeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Touch devices (tablets, phones) get the mini layout regardless of orientation/size
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    setIsMini(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMini(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const fetchNowPlaying = useCallback(async () => {
    try {
      const res = await fetch("/api/spotify/now-playing");
      if (res.ok) setData(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => { if (!cancelled) await fetchNowPlaying(); };
    const id = setInterval(poll, 5000);
    poll();
    return () => { cancelled = true; clearInterval(id); };
  }, [fetchNowPlaying]);

  // Tick progress locally every second so the bar moves smoothly between polls
  useEffect(() => {
    if (!data?.playing || !data.track) return;
    const id = setInterval(() => {
      setData(prev => {
        if (!prev?.track || !prev.playing) return prev;
        const next = Math.min(prev.track.progressMs + 1000, prev.track.durationMs);
        return { ...prev, track: { ...prev.track, progressMs: next } };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [data?.playing, data?.track?.name]);

  useEffect(() => {
    if (searchParams.get("spotify")) router.replace("/pomodoro");
  }, [searchParams, router]);

  useEffect(() => {
    if (!showDevices) return;
    const handler = (e: MouseEvent) => {
      if (devicesRef.current && !devicesRef.current.contains(e.target as Node)) setShowDevices(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDevices]);

  const control = useCallback(async (action: string, deviceId?: string, contextUri?: string) => {
    if (cmdInFlight.current) return;
    cmdInFlight.current = true;
    if (action === "play") setData(prev => prev ? { ...prev, playing: true } : prev);
    if (action === "pause") setData(prev => prev ? { ...prev, playing: false } : prev);
    try {
      await fetch("/api/spotify/controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, deviceId, contextUri }),
      });
      if (action === "next" || action === "previous" || contextUri) setTimeout(fetchNowPlaying, 500);
    } finally {
      setTimeout(() => { cmdInFlight.current = false; }, 300);
    }
  }, [fetchNowPlaying]);

  useEffect(() => { spotifyCtrlRef.current = control; }, [control]);

  const openDevices = useCallback(async () => {
    if (showDevices) { setShowDevices(false); return; }
    setShowPlaylists(false);
    try {
      const res = await fetch("/api/spotify/controls");
      if (res.ok) setDevices((await res.json()).devices ?? []);
    } catch {}
    setShowDevices(true);
  }, [showDevices]);

  const openPlaylists = useCallback(async () => {
    if (showPlaylists) { setShowPlaylists(false); return; }
    setShowDevices(false);
    try {
      const res = await fetch("/api/spotify/playlists");
      if (res.ok) setPlaylists((await res.json()).playlists ?? []);
    } catch {}
    setShowPlaylists(true);
  }, [showPlaylists, playlists.length]);

  useEffect(() => {
    if (!showPlaylists) return;
    const handler = (e: MouseEvent) => {
      if (playlistsRef.current && !playlistsRef.current.contains(e.target as Node)) setShowPlaylists(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPlaylists]);

  const handleConnect = () => { setConnecting(true); window.location.href = "/api/spotify/auth"; };
  const handleDisconnect = async () => {
    await fetch("/api/spotify/now-playing", { method: "DELETE" });
    setData({ connected: false });
  };

  const isPlaying = data?.playing ?? false;
  const isShuffle = data?.shuffle ?? false;
  const volume = data?.volume ?? 100;
  const track = data?.track ?? null;
  const progress = track ? Math.round((track.progressMs / track.durationMs) * 100) : 0;
  const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  const handleVolume = (v: number) => {
    setData(prev => prev ? { ...prev, volume: v } : prev);
    if (volumeDebounce.current) clearTimeout(volumeDebounce.current);
    volumeDebounce.current = setTimeout(() => {
      fetch("/api/spotify/controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "volume", value: v }),
      });
    }, 300);
  };

  if (!data || !data.connected) {
    return (
      <button
        onClick={handleConnect}
        disabled={connecting}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 14px", borderRadius: 8,
          background: "var(--surface)", border: "1px solid var(--border)",
          cursor: connecting ? "default" : "pointer",
          color: connecting ? "var(--faint)" : "var(--subtle)",
          fontWeight: 600, fontSize: 12, opacity: connecting ? 0.6 : 1,
        }}
      >
        <Music size={13} style={{ color: "#1DB954" }} />
        {connecting ? "Connecting…" : "Connect Spotify"}
      </button>
    );
  }

  // ── Shared pieces ──────────────────────────────────────────────────────────

  const playlistDropdown = (
    <div style={{ position: "relative" }} ref={playlistsRef}>
      <button
        className={showPlaylists ? undefined : "pomo-outline"} style={{ width: 28, height: 28, borderRadius: 6, background: showPlaylists ? "#1DB95418" : "transparent", border: `1px solid ${showPlaylists ? "#1DB95460" : "var(--border)"}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={openPlaylists} title="Pick playlist"
      >
        <Music size={11} style={{ color: showPlaylists ? "#1DB954" : "var(--muted-foreground)" }} />
      </button>
      {showPlaylists && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: 6, width: 220, zIndex: 50, maxHeight: 260, overflowY: "auto" }}>
          {playlists.length === 0 && <div style={{ fontSize: 11, color: "var(--subtle)", padding: "4px 8px" }}>No playlists found</div>}
          {playlists.map(p => (
            <button key={p.id} onClick={() => { control("play", undefined, p.uri); setShowPlaylists(false); setTimeout(fetchNowPlaying, 600); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 7, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
              {p.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={p.image} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: "cover", flexShrink: 0 }} />
                : <div style={{ width: 28, height: 28, borderRadius: 4, background: "var(--raised)", flexShrink: 0 }} />}
              <span style={{ fontSize: 11, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const deviceDropdown = (
    <div style={{ position: "relative" }} ref={devicesRef}>
      <button
        className="pomo-outline" style={{ width: 28, height: 28, borderRadius: 6, background: "transparent", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={openDevices} title="Switch device"
      >
        <Monitor size={12} style={{ color: showDevices ? "var(--foreground)" : "var(--muted-foreground)" }} />
      </button>
      {showDevices && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: 6, minWidth: 200, zIndex: 50 }}>
          {devices.length === 0 && <div style={{ fontSize: 11, color: "var(--subtle)", padding: "4px 8px" }}>No devices found</div>}
          {devices.map(d => (
            <button key={d.id} onClick={() => { control("transfer", d.id); setShowDevices(false); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7, background: d.active ? "#1DB95418" : "transparent", border: "none", cursor: "pointer", textAlign: "left", color: d.active ? "#1DB954" : "var(--foreground)" }}>
              <span style={{ fontSize: 11, fontWeight: d.active ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              {d.active && <span style={{ fontSize: 10, color: "#1DB954", marginLeft: "auto" }}>active</span>}
            </button>
          ))}
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
            <button onClick={handleDisconnect} style={{ width: "100%", padding: "5px 8px", borderRadius: 7, background: "transparent", border: "none", cursor: "pointer", fontSize: 11, color: "var(--subtle)", textAlign: "left" }}>
              Disconnect Spotify
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const progressBar = track ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ height: 3, borderRadius: 2, background: "var(--raised)", overflow: "hidden" }}>
        <div style={{ width: `${progress}%`, height: "100%", background: "#1DB954", borderRadius: 2, transition: "width 1s linear" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "var(--subtle)" }}>{fmt(track.progressMs)}</span>
        <span style={{ fontSize: 10, color: "var(--subtle)" }}>{fmt(track.durationMs)}</span>
      </div>
    </div>
  ) : null;

  const shuffleVolume = (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        onClick={() => { const next = !isShuffle; setData(prev => prev ? { ...prev, shuffle: next } : prev); fetch("/api/spotify/controls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "shuffle", value: next }) }); }}
        title={isShuffle ? "Shuffle on" : "Shuffle off"}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", flexShrink: 0, color: isShuffle ? "#1DB954" : "var(--muted-foreground)" }}
      >
        <Shuffle size={14} />
      </button>
      {volume === 0 ? <VolumeX size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} /> : volume < 50 ? <Volume1 size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} /> : <Volume2 size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />}
      <input type="range" min={0} max={100} value={volume} onChange={e => handleVolume(Number(e.target.value))}
        className="spotify-vol"
        style={{ flex: 1, cursor: "pointer", background: `linear-gradient(to right, #1DB954 ${volume}%, var(--raised) ${volume}%)`, transition: "background 0.05s linear" }}
      />
      <span style={{ fontSize: 10, color: "var(--muted-foreground)", width: 22, textAlign: "right", flexShrink: 0, fontWeight: 600 }}>{volume}</span>
    </div>
  );

  // ── TABLET / PHONE: compact card — same position as desktop (bottom-right anchor)
  // Layout mirrors iOS lock screen music widget: art left, info right, progress + controls below
  if (isMini) {
    return (
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "12px 14px",
        display: "flex", flexDirection: "column", gap: 10,
        width: 280,
      }}>
        {/* Top row: small art + track info + pickers */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Album art — small square */}
          {track?.albumArt
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={track.albumArt} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            : <div style={{ width: 48, height: 48, borderRadius: 8, background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Music size={20} style={{ color: "#1DB954", opacity: 0.4 }} />
              </div>
          }
          {/* Track name + artist */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {track ? (
              <>
                <a href={track.url ?? undefined} target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--foreground)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {track.name}
                </a>
                <span style={{ display: "block", fontSize: 12, color: "var(--subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                  {track.artists}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: "var(--subtle)" }}>Nothing playing</span>
            )}
          </div>
          {/* Pickers */}
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {playlistDropdown}
            {deviceDropdown}
          </div>
        </div>

        {/* Progress bar */}
        {progressBar}

        {/* Controls row: shuffle — prev / play / next — (spacer to balance) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={() => { const next = !isShuffle; setData(prev => prev ? { ...prev, shuffle: next } : prev); fetch("/api/spotify/controls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "shuffle", value: next }) }); }}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", color: isShuffle ? "#1DB954" : "var(--muted-foreground)", flexShrink: 0 }}
          >
            <Shuffle size={16} />
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--subtle)", display: "flex", padding: 6 }} onClick={() => control("previous")}><SkipBack size={22} /></button>
            <button
              style={{ width: 44, height: 44, borderRadius: "50%", background: "#1DB954", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#000", flexShrink: 0 }}
              onClick={() => control(isPlaying ? "pause" : "play")}
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ transform: "translateX(1px)" }} />}
            </button>
            <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--subtle)", display: "flex", padding: 6 }} onClick={() => control("next")}><SkipForward size={22} /></button>
          </div>

          {/* Spacer to keep controls centred */}
          <div style={{ width: 24, flexShrink: 0 }} />
        </div>

        {/* Volume row — icon + slider together so they're visually connected */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {volume === 0
            ? <VolumeX size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
            : volume < 50
              ? <Volume1 size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
              : <Volume2 size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
          }
          <input type="range" min={0} max={100} value={volume} onChange={e => handleVolume(Number(e.target.value))}
            className="spotify-vol"
            style={{ flex: 1, cursor: "pointer", background: `linear-gradient(to right, #1DB954 ${volume}%, var(--raised) ${volume}%)`, transition: "background 0.05s linear" }}
          />
          <span style={{ fontSize: 10, color: "var(--muted-foreground)", width: 20, textAlign: "right", flexShrink: 0, fontWeight: 600 }}>{volume}</span>
        </div>
      </div>
    );
  }

  // ── DESKTOP: full vertical card ────────────────────────────────────────────
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
      padding: 14, display: "flex", flexDirection: "column", gap: 12,
      width: 260,
    }}>
      {/* Full square album art */}
      {track?.albumArt
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={track.albumArt} alt="" style={{ width: "100%", aspectRatio: "1", borderRadius: 10, objectFit: "cover", display: "block" }} />
        : <div style={{ width: "100%", aspectRatio: "1", borderRadius: 10, background: "var(--raised)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Music size={40} style={{ color: "#1DB954", opacity: 0.4 }} />
          </div>
      }
      {/* Track name + artist + pickers */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {track ? (
            <>
              <a href={track.url ?? undefined} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--foreground)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {track.name}
              </a>
              <span style={{ display: "block", fontSize: 12, color: "var(--subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                {track.artists}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 12, color: "var(--subtle)" }}>Nothing playing</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {playlistDropdown}
          {deviceDropdown}
        </div>
      </div>
      {progressBar}
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--subtle)", display: "flex", padding: 4 }} onClick={() => control("previous")} title="Previous"><SkipBack size={22} /></button>
        <button
          style={{ width: 52, height: 52, borderRadius: "50%", background: "#1DB954", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#000" }}
          onClick={() => control(isPlaying ? "pause" : "play")} title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={22} /> : <Play size={22} style={{ transform: "translateX(2px)" }} />}
        </button>
        <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--subtle)", display: "flex", padding: 4 }} onClick={() => control("next")} title="Next"><SkipForward size={22} /></button>
      </div>
      {shuffleVolume}
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 13, color: "var(--subtle)" }}>
        {label}
      </span>
      <span style={{
        fontSize: 14, fontWeight: 600,
        fontFamily: MONO,
        color: color ?? "var(--foreground)",
      }}>
        {value}
      </span>
    </div>
  );
}
