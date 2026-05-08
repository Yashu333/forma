"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Settings, X, Music, SkipBack, SkipForward, ChevronDown, PictureInPicture2 } from "lucide-react";

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
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', 'Roboto Mono', monospace",
    fontWeight: 700,
    fontSize: "var(--digit-font)",
    lineHeight: 1,
    color: "var(--text-primary)",
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
    <div style={{ display: "flex", alignItems: "center", gap: "clamp(6px,2vw,14px)" }}>
      <div style={{ display: "flex", gap: "clamp(4px,1vw,8px)" }}>
        <FlipDigit digit={mins[0]} prev={prev.mins[0]} />
        <FlipDigit digit={mins[1]} prev={prev.mins[1]} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "clamp(10px,1.5vw,18px)", marginBottom: 6 }}>
        {[0, 1].map(i => (
          <div key={i} style={{
            width: "clamp(6px,1vw,10px)", height: "clamp(6px,1vw,10px)", borderRadius: "50%",
            background: "var(--text-secondary)",
            boxShadow: "0 0 10px var(--text-muted)",
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
  const pipRef       = useRef<Window | null>(null);

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

  // Dismiss looping alarm → apply pending transition → resume Spotify on break
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
    // Resume Spotify when switching to a break
    if (p.nextMode !== "focus") spotifyCtrlRef.current?.("play");
    if (p.autoStart) {
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

  // Pause Spotify when a focus session starts
  useEffect(() => {
    if (running && mode === "focus") spotifyCtrlRef.current?.("pause");
  }, [running, mode]);

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

  const buildPiPHtml = useCallback((secs: number, m: Mode) => {
    const mins = String(Math.floor(secs / 60)).padStart(2, "0");
    const secsStr = String(secs % 60).padStart(2, "0");
    const col = MODE_COLORS[m];
    return `
      <div id="pip-root" style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100vh;gap:12px;
        background:radial-gradient(circle at 50% 45%,${col}18 0%,transparent 65%),#0a0b16;
        font-family:'SF Mono','Fira Code','Consolas',monospace;
      ">
        <div style="display:flex;align-items:center;gap:10px">
          ${["m0","m1","sep","s0","s1"].map(part => {
            if (part === "sep") return `
              <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:4px">
                <div style="width:7px;height:7px;border-radius:50%;background:#666;box-shadow:0 0 8px #666"></div>
                <div style="width:7px;height:7px;border-radius:50%;background:#666;box-shadow:0 0 8px #666"></div>
              </div>`;
            const ch = part.startsWith("m") ? mins[parseInt(part[1])] : secsStr[parseInt(part[1])];
            return `
              <div style="
                position:relative;width:72px;height:94px;
                border-radius:10px;
                background:#1a1b2e;
                border:1px solid #2a2b3e;
                box-shadow:0 8px 24px rgba(0,0,0,0.5);
                overflow:hidden;
              ">
                <div class="pip-digit" style="
                  position:absolute;top:50%;left:50%;
                  transform:translate(-50%,-50%);
                  font-size:68px;font-weight:700;line-height:1;
                  color:#e8e9f5;user-select:none;text-align:center;width:100%;
                ">${ch}</div>
              </div>`;
          }).join("")}
        </div>
        <div id="pip-mode" style="font-size:11px;letter-spacing:0.15em;color:#666;font-weight:600">${MODE_LABELS[m]}</div>
      </div>`;
  }, []);

  const openPiP = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dpip = (window as any).documentPictureInPicture;
    if (!dpip) return;
    if (pipRef.current && !pipRef.current.closed) { pipRef.current.close(); pipRef.current = null; return; }
    const pip = await dpip.requestWindow({ width: 380, height: 200 });
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
  }, [secondsLeft]);

  const color = MODE_COLORS[mode];
  const dotsInCycle = sessions % config.sessionsBeforeLong;
  const completedCycles = Math.floor(sessions / config.sessionsBeforeLong);

  return (
    <div style={{
      height: "100vh", width: "100vw", overflow: "hidden",
      background: "var(--bg)", display: "flex", flexDirection: "column", position: "relative",
      // Responsive digit card dimensions via CSS custom properties
      ["--digit-w" as string]: "clamp(88px, 12vw, 172px)",
      ["--digit-h" as string]: "clamp(114px, 16vw, 224px)",
      ["--digit-font" as string]: "clamp(84px, 11vw, 164px)",
    }}>

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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, position: "relative", zIndex: 1, padding: "16px 16px", overflowY: "auto" }}>

        {/* Spotify widget — bottom-right on large screens, inline below controls on small */}
        <div className="spotify-widget-anchor" style={{ position: "absolute", bottom: 24, right: 28, zIndex: 20 }}>
          <Suspense>
            <SpotifyWidget />
          </Suspense>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
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

          {/* Picture in Picture */}
          <button onClick={openPiP} title="Picture in Picture"
            style={{ width: 50, height: 50, borderRadius: 13, background: "var(--card)", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
            <PictureInPicture2 size={20} />
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

// ── Spotify control ref (shared between page + widget) ───────────────────────
// The page needs to pause/resume Spotify on timer events. We expose a stable
// ref so PomodoroPage can call spotifyCtrl.current?.("pause") without prop drilling.
const spotifyCtrlRef = { current: null as ((action: string) => void) | null };

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

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

function SpotifyWidget() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<NowPlaying | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [showDevices, setShowDevices] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkDeviceId, setSdkDeviceId] = useState<string | null>(null);
  const playerRef = useRef<{ getCurrentState(): Promise<{ paused: boolean } | null>; resume(): Promise<void>; pause(): Promise<void>; nextTrack(): Promise<void>; previousTrack(): Promise<void>; disconnect(): void } | null>(null);
  const devicesRef = useRef<HTMLDivElement>(null);
  // Track whether SDK has been initialized to avoid re-init on every poll
  const sdkInitialized = useRef(false);

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

  // Init Web Playback SDK once on first connect — never re-init on polls
  useEffect(() => {
    if (!data?.connected || sdkInitialized.current) return;
    sdkInitialized.current = true;

    const initSdk = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const W = window as any;
      if (!W.Spotify?.Player) return;
      console.log("[Spotify SDK] Initializing player");
      const player = new W.Spotify.Player({
        name: "Forma",
        getOAuthToken: (cb: (t: string) => void) => {
          console.log("[Spotify SDK] getOAuthToken called — fetching token");
          const t0 = Date.now();
          fetch("/api/spotify/token")
            .then(r => {
              console.log(`[Spotify SDK] token route responded in ${Date.now() - t0}ms, status=${r.status}`);
              return r.json();
            })
            .then(d => {
              if (d.token) {
                console.log("[Spotify SDK] token obtained, calling callback");
                cb(d.token);
              } else {
                console.warn("[Spotify SDK] token route returned no token:", d);
              }
            })
            .catch(err => console.error("[Spotify SDK] token fetch error:", err));
        },
        volume: 0.8,
      });
      player.addListener("ready", ({ device_id }: { device_id: string }) => {
        console.log("[Spotify SDK] ready, device_id:", device_id);
        setSdkDeviceId(device_id);
        setSdkReady(true);
        // Transfer playback to browser silently on connect
        fetch("/api/spotify/controls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "transfer", deviceId: device_id }),
        }).catch(() => {});
      });
      player.addListener("not_ready", ({ device_id }: { device_id: string }) => {
        console.warn("[Spotify SDK] not_ready — device went offline, device_id:", device_id);
        setSdkReady(false);
        setSdkDeviceId(null);
      });
      player.addListener("initialization_error", ({ message }: { message: string }) => {
        console.error("[Spotify SDK] initialization_error:", message);
      });
      player.addListener("authentication_error", ({ message }: { message: string }) => {
        console.error("[Spotify SDK] authentication_error:", message, "— this usually means getOAuthToken failed or returned an expired token");
      });
      player.addListener("account_error", ({ message }: { message: string }) => {
        console.error("[Spotify SDK] account_error:", message, "— Premium required");
      });
      player.addListener("playback_error", ({ message }: { message: string }) => {
        console.error("[Spotify SDK] playback_error:", message);
      });
      // Keep local state in sync with SDK player state changes
      player.addListener("player_state_changed", (state: { paused: boolean; track_window?: { current_track?: { name: string } } } | null) => {
        if (!state) {
          console.warn("[Spotify SDK] player_state_changed: null state — player may have been disconnected");
          return;
        }
        console.log("[Spotify SDK] player_state_changed: paused=", state.paused, "track=", state.track_window?.current_track?.name);
        setData(prev => prev ? { ...prev, playing: !state.paused } : prev);
        // Refresh full track info shortly after state change
        setTimeout(fetchNowPlaying, 300);
      });
      const connected = player.connect();
      console.log("[Spotify SDK] connect() called, promise:", connected);
      playerRef.current = player;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const W = window as any;
    if (W.Spotify?.Player) {
      initSdk();
    } else {
      W.onSpotifyWebPlaybackSDKReady = initSdk;
      if (!document.getElementById("spotify-sdk")) {
        const s = document.createElement("script");
        s.id = "spotify-sdk";
        s.src = "https://sdk.scdn.co/spotify-player.js";
        document.head.appendChild(s);
      }
    }

    return () => {
      playerRef.current?.disconnect();
      playerRef.current = null;
      setSdkReady(false);
      setSdkDeviceId(null);
      sdkInitialized.current = false;
    };
  // Only run when connection state first becomes true — not on every data poll
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.connected]);

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

  const cmdInFlight = useRef(false);
  const control = useCallback(async (action: string, deviceId?: string) => {
    if (cmdInFlight.current) return;
    cmdInFlight.current = true;
    // Optimistically update playing state for instant UI feedback
    if (action === "play") setData(prev => prev ? { ...prev, playing: true } : prev);
    if (action === "pause") setData(prev => prev ? { ...prev, playing: false } : prev);
    try {
      const p = playerRef.current;
      if (p && sdkReady && !deviceId) {
        if (action === "play") { await p.resume(); return; }
        if (action === "pause") { await p.pause(); return; }
        if (action === "next") { await p.nextTrack(); setTimeout(fetchNowPlaying, 400); return; }
        if (action === "previous") { await p.previousTrack(); setTimeout(fetchNowPlaying, 400); return; }
      }
      setActionLoading(true);
      try {
        await fetch("/api/spotify/controls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, deviceId }),
        });
        setTimeout(fetchNowPlaying, 400);
      } finally {
        setActionLoading(false);
      }
    } finally {
      // Short lock — just enough to debounce double-clicks
      setTimeout(() => { cmdInFlight.current = false; }, 300);
    }
  }, [sdkReady, fetchNowPlaying]);

  useEffect(() => { spotifyCtrlRef.current = control; }, [control]);

  const openDevices = useCallback(async () => {
    if (showDevices) { setShowDevices(false); return; }
    try {
      const res = await fetch("/api/spotify/controls");
      if (res.ok) setDevices((await res.json()).devices ?? []);
    } catch {}
    setShowDevices(true);
  }, [showDevices]);

  const handleConnect = () => { setConnecting(true); window.location.href = "/api/spotify/auth"; };
  const handleDisconnect = async () => {
    await fetch("/api/spotify/now-playing", { method: "DELETE" });
    setData({ connected: false });
  };

  const isPlaying = data?.playing ?? false;
  const track = data?.track ?? null;
  const progress = track ? Math.round((track.progressMs / track.durationMs) * 100) : 0;
  const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  if (!data || !data.connected) {
    return (
      <button
        onClick={handleConnect}
        disabled={connecting}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 14px", borderRadius: 10,
          background: "var(--card)", border: "1px solid var(--border)",
          cursor: connecting ? "default" : "pointer",
          color: connecting ? "var(--text-disabled)" : "var(--text-muted)",
          fontWeight: 600, fontSize: 12, opacity: connecting ? 0.6 : 1,
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        }}
      >
        <Music size={13} style={{ color: "#1DB954" }} />
        {connecting ? "Connecting…" : "Connect Spotify"}
      </button>
    );
  }

  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 18,
      padding: 14,
      display: "flex",
      flexDirection: "column",
      gap: 12,
      width: 260,
      boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
    }}>
      {/* Album art — square, full width */}
      {track?.albumArt ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={track.albumArt} alt="" style={{ width: "100%", aspectRatio: "1", borderRadius: 10, objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ width: "100%", aspectRatio: "1", borderRadius: 10, background: "var(--elevated)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Music size={40} style={{ color: "#1DB954", opacity: 0.4 }} />
        </div>
      )}

      {/* Track name + artist */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {track ? (
            <>
              <a
                href={track.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {track.name}
              </a>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                {track.artists}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Nothing playing</span>
          )}
        </div>
        {/* Device picker */}
        <div style={{ position: "relative", flexShrink: 0 }} ref={devicesRef}>
          <button
            style={{ width: 28, height: 28, borderRadius: 7, background: "transparent", border: "1px solid var(--border)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={openDevices}
            title="Switch device"
          >
            <ChevronDown size={12} style={{ color: "var(--text-muted)", transform: showDevices ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>
          {showDevices && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0,
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: 10, padding: 6, minWidth: 200, zIndex: 50,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}>
              {devices.length === 0 && <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 8px" }}>No devices found</div>}
              {devices.map(d => (
                <button
                  key={d.id}
                  onClick={() => { control("transfer", d.id); setShowDevices(false); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7, background: d.active ? "#1DB95418" : "transparent", border: "none", cursor: "pointer", textAlign: "left", color: d.active ? "#1DB954" : "var(--text-primary)" }}
                >
                  <span style={{ fontSize: 11, fontWeight: d.active ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                  {d.active && <span style={{ fontSize: 10, color: "#1DB954", marginLeft: "auto" }}>active</span>}
                </button>
              ))}
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4 }}>
                <button onClick={handleDisconnect} style={{ width: "100%", padding: "5px 8px", borderRadius: 7, background: "transparent", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-disabled)", textAlign: "left" }}>
                  Disconnect Spotify
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {track && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ height: 3, borderRadius: 2, background: "var(--elevated)", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#1DB954", borderRadius: 2, transition: "width 1s linear" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, color: "var(--text-disabled)" }}>{fmt(track.progressMs)}</span>
            <span style={{ fontSize: 10, color: "var(--text-disabled)" }}>{fmt(track.durationMs)}</span>
          </div>
        </div>
      )}

      {/* Controls — prev / play-pause / next */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <button
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 4 }}
          onClick={() => control("previous")} title="Previous" disabled={actionLoading}
        >
          <SkipBack size={22} />
        </button>
        <button
          style={{
            width: 52, height: 52, borderRadius: "50%",
            background: "#1DB954", border: "none", cursor: actionLoading ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#000", boxShadow: "0 4px 16px #1DB95440",
            opacity: actionLoading ? 0.6 : 1,
          }}
          onClick={() => control(isPlaying ? "pause" : "play")}
          title={isPlaying ? "Pause" : "Play"}
          disabled={actionLoading}
        >
          {isPlaying ? <Pause size={22} /> : <Play size={22} style={{ transform: "translateX(2px)" }} />}
        </button>
        <button
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 4 }}
          onClick={() => control("next")} title="Next" disabled={actionLoading}
        >
          <SkipForward size={22} />
        </button>
      </div>
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
