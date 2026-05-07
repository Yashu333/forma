"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Settings, X, Music } from "lucide-react";

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

const MODE_COLORS: Record<Mode, string> = {
  focus: "#7C6EF8",
  short: "#34D399",
  long:  "#60A5FA",
};
const MODE_LABELS: Record<Mode, string> = {
  focus: "FOCUS",
  short: "SHORT BREAK",
  long:  "LONG BREAK",
};

// Digit card dimensions — tweak here to scale up/down
const W = 172;   // card width  px
const H = 224;   // card height px
const FONT = 164; // font size   px

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
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', 'Roboto Mono', monospace",
    fontWeight: 700,
    fontSize: FONT,
    lineHeight: 1,
    color: "var(--text-primary)",
    userSelect: "none",
    position: "absolute",
    width: "100%",
    textAlign: "center",
  };

  return (
    <div style={{ position: "relative", width: W, height: H }}>
      {/* Card shadow */}
      <div style={{
        position: "absolute", inset: 0,
        borderRadius: 14,
        background: "var(--card)",
        border: "1px solid var(--border-strong)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.35)",
      }} />

      {/* Static top half — always shows `shown` (old during flip) */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        height: "50%", overflow: "hidden",
        borderRadius: "14px 14px 0 0",
        background: "linear-gradient(180deg, var(--elevated) 0%, var(--card) 100%)",
        borderBottom: "1px solid rgba(0,0,0,0.4)",
      }}>
        <div style={{ ...numStyle, bottom: 0, transform: "translateY(50%)" }}>
          {shown}
        </div>
      </div>

      {/* Static bottom half — always shows `shown` (old during flip) */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: "50%", overflow: "hidden",
        borderRadius: "0 0 14px 14px",
        background: "linear-gradient(180deg, var(--card) 0%, var(--surface) 100%)",
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
          borderRadius: "14px 14px 0 0",
          background: "linear-gradient(180deg, var(--elevated) 0%, var(--card) 100%)",
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
            background: "linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.55) 100%)",
            animation: "flapShade 0.34s ease forwards",
          }} />
        </div>
      )}

      {/* Center seam */}
      <div style={{
        position: "absolute", left: 0, right: 0,
        top: "calc(50% - 1px)", height: 2,
        background: "rgba(0,0,0,0.6)", zIndex: 5,
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
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <FlipDigit digit={mins[0]} prev={prev.mins[0]} />
        <FlipDigit digit={mins[1]} prev={prev.mins[1]} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 6 }}>
        {[0, 1].map(i => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: "50%",
            background: "var(--text-secondary)",
            boxShadow: "0 0 10px var(--text-muted)",
          }} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
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
        background: "rgba(10,11,22,0.88)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: 16,
          padding: "28px 32px 24px",
          width: 480,
          fontSize: 13,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.3)",
          display: "flex", flexDirection: "column", gap: 0,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: 15 }}>Timer Settings</div>
            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>Changes apply on save</div>
          </div>
          <button onClick={onClose} style={{ background: "var(--elevated)", border: "1px solid var(--border)", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 6, borderRadius: 8 }}>
            <X size={14} />
          </button>
        </div>

        {/* Section label */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text-disabled)", textTransform: "uppercase", marginBottom: 10 }}>Durations</div>

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
                <label style={{ color: "var(--text-secondary)", fontSize: 13 }}>{label}</label>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
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
                      background: "var(--elevated)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 6, padding: "3px 0",
                      color: "var(--text-primary)", fontSize: 13, fontWeight: 700,
                      fontFamily: "monospace", outline: "none",
                      display: "block",
                    }}
                  />
                  {unit && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{unit.trim()}</span>}
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
                className="forma-range"
              />
            </div>
          ))}
        </div>

        {/* Section label */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text-disabled)", textTransform: "uppercase", marginBottom: 10 }}>Auto-start</div>

        {/* Toggles */}
        <div style={{
          display: "flex", flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 10, overflow: "hidden",
          marginBottom: 20,
        }}>
          {([
            ["autoStartBreaks", "Auto-start breaks", "Break starts automatically after focus"],
            ["autoStartFocus",  "Auto-start focus",  "Focus starts automatically after break"],
          ] as [keyof TimerConfig, string, string][]).map(([key, label, desc], i) => (
            <div
              key={key}
              onClick={() => setDraft(d => ({ ...d, [key]: !d[key] }))}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                padding: "11px 14px",
                background: i === 0 ? "var(--card)" : "var(--elevated)",
                cursor: "pointer",
                borderBottom: i === 0 ? "1px solid var(--border)" : "none",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{desc}</span>
              </div>
              <div style={{
                width: 44, height: 26, borderRadius: 999, flexShrink: 0,
                background: draft[key] ? "#7C6EF8" : "#1A1B2E",
                border: `2px solid ${draft[key] ? "#7C6EF8" : "#4A4D6E"}`,
                position: "relative",
                transition: "background 0.18s, border-color 0.18s",
              }}>
                <div style={{
                  position: "absolute",
                  top: 2, left: draft[key] ? 18 : 2,
                  width: 18, height: 18, borderRadius: "50%",
                  background: draft[key] ? "#fff" : "#7E82A8",
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
          style={{
            background: "#7C6EF8",
            color: "#fff",
            border: "none", borderRadius: 9, padding: "10px 0",
            fontWeight: 600, fontSize: 13, cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
            boxShadow: "0 2px 10px rgba(124,110,248,0.4)",
            transition: "opacity 0.15s",
            letterSpacing: "0.02em",
          }}
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
          background: var(--elevated);
          outline: none;
          border: none;
        }
        .forma-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px; height: 16px;
          border-radius: 50%;
          background: var(--accent);
          cursor: pointer;
          border: 2px solid var(--surface);
          box-shadow: 0 0 0 1px var(--accent);
          margin-top: -6px;
          transition: transform 0.1s;
        }
        .forma-range::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        .forma-range::-moz-range-thumb {
          width: 16px; height: 16px;
          border-radius: 50%;
          background: var(--accent);
          cursor: pointer;
          border: 2px solid var(--surface);
          box-shadow: 0 0 0 1px var(--accent);
        }
        .forma-range::-webkit-slider-runnable-track {
          background: var(--elevated);
          border-radius: 2px;
          height: 4px;
          transition: background 0.15s;
        }
        .forma-range:hover::-webkit-slider-runnable-track {
          background: rgba(124,110,248,0.25);
        }
        .forma-range:active::-webkit-slider-runnable-track {
          background: rgba(124,110,248,0.45);
        }
        .forma-range::-moz-range-track {
          background: var(--elevated);
          border-radius: 2px;
          height: 4px;
          transition: background 0.15s;
        }
        .forma-range:hover::-moz-range-track {
          background: rgba(124,110,248,0.25);
        }
        .forma-range:active::-moz-range-track {
          background: rgba(124,110,248,0.45);
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

  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const stopAlarmRef = useRef<(() => void) | null>(null);
  const pendingRef   = useRef<Pending | null>(null);

  useEffect(() => {
    fetch("/api/user-settings")
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((s: TimerConfig) => { setConfig(s); setLeft(s.focusMins * 60); })
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

  const stopInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  // Dismiss looping alarm → apply pending transition
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
    setRunning(false); // will be set true below if autoStart
    if (p.autoStart) {
      // tiny delay so setMode/setLeft flush first
      setTimeout(() => setRunning(true), 50);
    }
  }, [config, dur]);

  const stop = useCallback(() => {
    stopInterval();
    setRunning(false);
    // If alarm is ringing when user hits stop/reset, dismiss it too
    if (stopAlarmRef.current) {
      stopAlarmRef.current();
      stopAlarmRef.current = null;
      setAlarmRinging(false);
      pendingRef.current = null;
      setPending(null);
    }
  }, [stopInterval]);

  const reset = useCallback(() => { stop(); setLeft(dur(mode, config)); }, [mode, config, stop, dur]);
  const switchMode = useCallback((m: Mode) => {
    stop();
    setMode(m);
    setLeft(dur(m, config));
  }, [config, stop, dur]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setLeft(prev => {
        if (prev > 1) return prev - 1;

        stopInterval();
        setRunning(false);

        // Compute next mode & whether to auto-start, using functional updater for sessions
        setSessions(s => {
          const nextSessions = mode === "focus" ? s + 1 : s;

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
          setAlarmRinging(true);

          return nextSessions;
        });

        return 0;
      });
    }, 1000);
    return () => stopInterval();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, muted, mode, config]);

  const saveConfig = useCallback(async (c: TimerConfig) => {
    setSaving(true);
    try {
      const res = await fetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
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

  const color = MODE_COLORS[mode];
  const dotsInCycle = sessions % config.sessionsBeforeLong;
  const completedCycles = Math.floor(sessions / config.sessionsBeforeLong);

  return (
    <div style={{ height: "100vh", width: "100vw", overflow: "hidden", background: "var(--bg)", display: "flex", flexDirection: "column", position: "relative" }}>

      {/* Ambient glow */}
      <div style={{
        position: "absolute", top: "38%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 560, height: 560, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}18 0%, transparent 65%)`,
        transition: "background 0.5s ease", pointerEvents: "none",
      }} />

      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 28px", borderBottom: "1px solid var(--border)",
        background: "var(--surface)", position: "relative", zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <StatChip label="Total sessions" value={String(sessions)} />
          <StatChip label="Cycles done" value={String(completedCycles)} />
          <div style={{ width: 1, height: 28, background: "var(--border)" }} />
          <StatChip label="Focus" value={`${config.focusMins}m`} color={MODE_COLORS.focus} />
          <StatChip label="Short break" value={`${config.shortMins}m`} color={MODE_COLORS.short} />
          <StatChip label="Long break" value={`${config.longMins}m`} color={MODE_COLORS.long} />
          <StatChip label="Per cycle" value={String(config.sessionsBeforeLong)} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => { stop(); setMode("focus"); setLeft(dur("focus", config)); setSessions(0); }}
            title="Reset full cycle"
            style={{ width: 34, height: 34, borderRadius: 8, background: "transparent", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <RotateCcw size={15} style={{ transform: "scaleX(-1)" }} />
          </button>
          <button onClick={() => setMuted(m => !m)} title={muted ? "Unmute" : "Mute"}
            style={{ width: 34, height: 34, borderRadius: 8, background: "transparent", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: muted ? "var(--text-disabled)" : "var(--text-muted)" }}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button onClick={() => setShowSettings(true)} title="Settings"
            style={{ width: 34, height: 34, borderRadius: 8, background: "transparent", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, position: "relative", zIndex: 1 }}>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["focus", "short", "long"] as Mode[]).map(m => (
            <button key={m} onClick={() => switchMode(m)} style={{
              padding: "8px 21px", borderRadius: 999,
              border: `1px solid ${mode === m ? color + "50" : "var(--border)"}`,
              background: mode === m ? color + "18" : "transparent",
              color: mode === m ? color : "var(--text-muted)",
              fontSize: 15, fontWeight: 600, letterSpacing: "0.1em",
              cursor: "pointer", transition: "all 0.15s ease",
            }}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Flip clock */}
        <FlipClock seconds={secondsLeft} />

        {/* Alarm dismiss banner */}
        {alarmRinging && (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 20px", borderRadius: 12,
            background: color + "22", border: `1px solid ${color}55`,
            animation: "pulse 1.2s ease-in-out infinite",
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: color }}>
              {pending?.nextMode === "focus" ? "Break's over!" : "Time's up!"}
              {" "}
              <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>
                {pending?.autoStart
                  ? `${pending.nextMode === "focus" ? "Focus" : pending.nextMode === "long" ? "Long break" : "Short break"} starting after you stop the alarm.`
                  : "Stop the alarm when you're ready."}
              </span>
            </span>
            <button onClick={dismissAlarm} style={{
              padding: "5px 14px", borderRadius: 8, border: "none",
              background: color, color: "#fff", fontSize: 12, fontWeight: 600,
              cursor: "pointer",
            }}>
              Stop alarm
            </button>
          </div>
        )}

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: alarmRinging ? 0 : 4 }}>
          {/* Reset current timer */}
          <button onClick={reset} title="Reset timer"
            style={{ width: 50, height: 50, borderRadius: 13, background: "var(--card)", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
            <RotateCcw size={22} />
          </button>

          {/* Play / Pause */}
          <button
            onClick={() => { if (!running && !alarmRinging) getAudio(); setRunning(r => !r); }}
            disabled={alarmRinging}
            style={{
              width: 76, height: 76, borderRadius: 20,
              background: alarmRinging ? "var(--elevated)" : `linear-gradient(135deg, ${color}, ${color}cc)`,
              border: "none", cursor: alarmRinging ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
              boxShadow: alarmRinging ? "none" : `0 0 32px ${color}40, 0 8px 24px rgba(0,0,0,0.4)`,
              transition: "transform 0.12s ease, background 0.2s",
              opacity: alarmRinging ? 0.4 : 1,
            }}
            onMouseEnter={e => { if (!alarmRinging) (e.currentTarget as HTMLElement).style.transform = "scale(1.06)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}>
            {running ? <Pause size={34} /> : <Play size={34} style={{ transform: "translateX(2px)" }} />}
          </button>

        </div>

        {/* Session dots */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {Array.from({ length: config.sessionsBeforeLong }, (_, i) => (
              <div key={i} style={{
                height: 12, borderRadius: 999,
                width: i < dotsInCycle ? 28 : 12,
                background: i < dotsInCycle ? color : "var(--elevated)",
                border: `1px solid ${i < dotsInCycle ? color + "80" : "var(--border-strong)"}`,
                boxShadow: i < dotsInCycle ? `0 0 8px ${color}60` : "none",
                transition: "all 0.3s ease",
              }} />
            ))}
          </div>
          <span style={{ fontSize: 15, letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 500 }}>
            {dotsInCycle} / {config.sessionsBeforeLong} SESSIONS
          </span>
        </div>

        {/* Spotify */}
        <Suspense>
          <SpotifyWidget />
        </Suspense>
      </div>

      {showSettings && (
        <SettingsModal config={config} saving={savingSettings} onSave={saveConfig} onClose={() => setShowSettings(false)} />
      )}

      <style>{`
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
      `}</style>
    </div>
  );
}

// ── Spotify widget ────────────────────────────────────────────────────────────

interface NowPlaying {
  connected: boolean;
  playing?: boolean;
  track?: {
    name: string;
    artists: string;
    albumArt: string | null;
    url: string | null;
    progressMs: number;
    durationMs: number;
  };
}

function SpotifyWidget() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<NowPlaying | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchNowPlaying = async () => {
      try {
        const res = await fetch("/api/spotify/now-playing");
        if (res.ok && !cancelled) setData(await res.json());
      } catch {}
    };
    const id = setInterval(fetchNowPlaying, 5000);
    fetchNowPlaying();
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Clear ?spotify= param from URL after landing from OAuth
  useEffect(() => {
    if (searchParams.get("spotify")) {
      router.replace("/pomodoro");
    }
  }, [searchParams, router]);

  const handleConnect = () => {
    setConnecting(true);
    window.location.href = "/api/spotify/auth";
  };

  const handleDisconnect = async () => {
    await fetch("/api/spotify/now-playing", { method: "DELETE" });
    setData({ connected: false });
  };

  const progress = data?.track
    ? Math.round((data.track.progressMs / data.track.durationMs) * 100)
    : 0;

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  return (
    <div style={{
      width: 340,
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Music size={13} style={{ color: "#1DB954" }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", textTransform: "uppercase" }}>
            Spotify
          </span>
        </div>
        {data?.connected && (
          <button
            onClick={handleDisconnect}
            style={{ fontSize: 10, color: "var(--text-disabled)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Disconnect
          </button>
        )}
      </div>

      {/* Not connected */}
      {(!data || !data.connected) && (
        <button
          onClick={handleConnect}
          disabled={connecting}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "9px 0", borderRadius: 9,
            background: connecting ? "var(--elevated)" : "#1DB954",
            border: "none", cursor: connecting ? "default" : "pointer",
            color: connecting ? "var(--text-muted)" : "#000",
            fontWeight: 700, fontSize: 12,
            transition: "opacity 0.15s",
            opacity: connecting ? 0.6 : 1,
          }}
        >
          <Music size={14} />
          {connecting ? "Connecting…" : "Connect Spotify"}
        </button>
      )}

      {/* Connected, nothing playing */}
      {data?.connected && !data.playing && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "4px 0" }}>
          Nothing playing right now
        </div>
      )}

      {/* Connected and playing */}
      {data?.connected && data.playing && data.track && (
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {data.track.albumArt ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={data.track.albumArt}
              alt="Album art"
              width={48}
              height={48}
              style={{ borderRadius: 6, flexShrink: 0, objectFit: "cover" }}
            />
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: 6, background: "var(--elevated)", flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <a
              href={data.track.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                textDecoration: "none", overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {data.track.name}
            </a>
            <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {data.track.artists}
            </span>
            {/* Progress bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: "var(--elevated)", overflow: "hidden" }}>
                <div style={{ width: `${progress}%`, height: "100%", background: "#1DB954", borderRadius: 2, transition: "width 1s linear" }} />
              </div>
              <span style={{ fontSize: 10, color: "var(--text-disabled)", flexShrink: 0 }}>
                {fmt(data.track.progressMs)} / {fmt(data.track.durationMs)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 13, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
        {label}
      </span>
      <span style={{
        fontSize: 14, fontWeight: 700,
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        color: color ?? "var(--text-primary)",
      }}>
        {value}
      </span>
    </div>
  );
}
