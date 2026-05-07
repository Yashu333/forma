"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Settings, X } from "lucide-react";

type Mode = "focus" | "short" | "long";

interface TimerConfig {
  focusMins: number;
  shortMins: number;
  longMins: number;
  sessionsBeforeLong: number;
}

const DEFAULT_CONFIG: TimerConfig = {
  focusMins: 25,
  shortMins: 5,
  longMins: 15,
  sessionsBeforeLong: 4,
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
const W = 120;   // card width  px
const H = 164;   // card height px
const FONT = 110; // font size   px

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

function playAlarm(ctx: AudioContext) {
  const src = ctx.createBufferSource();
  src.buffer = buildAlarmBuffer(ctx);
  src.connect(ctx.destination);
  src.start();
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

function FlipDigit({ digit, prev }: { digit: string; prev: string }) {
  // "shown" is what both static halves display — lags behind `digit` by one tick
  const [shown, setShown]     = useState(digit);
  const [flipping, setFlip]   = useState(false);

  useEffect(() => {
    if (digit === shown) return;
    // Start flap: both halves still show old value (shown)
    setFlip(true);
    const t = setTimeout(() => {
      setFlip(false);
      setShown(digit); // now both halves snap to new digit
    }, 340);
    return () => clearTimeout(t);
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

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(15,16,30,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: 16,
          padding: 28,
          width: 380,
          boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
          display: "flex", flexDirection: "column", gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 16 }}>
            Timer Settings
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--text-muted)", display: "flex", padding: 4, borderRadius: 6,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {([
          ["Focus duration", "focusMins", 1, 90, " min"],
          ["Short break",    "shortMins", 1, 30, " min"],
          ["Long break",     "longMins",  5, 60, " min"],
          ["Sessions before long break", "sessionsBeforeLong", 2, 8, ""],
        ] as [string, keyof TimerConfig, number, number, string][]).map(([label, key, min, max, unit]) => (
          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ color: "var(--text-secondary)", fontSize: 13 }}>{label}</label>
              <span style={{
                color: "var(--text-primary)", fontSize: 13, fontWeight: 600,
                fontFamily: "monospace",
                background: "var(--elevated)", padding: "2px 10px", borderRadius: 6,
                border: "1px solid var(--border)",
              }}>
                {draft[key]}{unit}
              </span>
            </div>
            <input
              type="range" min={min} max={max} value={draft[key]}
              onChange={e => setDraft(d => ({ ...d, [key]: Number(e.target.value) }))}
              style={{ width: "100%", accentColor: "var(--accent)" }}
            />
          </div>
        ))}

        <button
          onClick={() => onSave(draft)}
          disabled={saving}
          style={{
            background: saving ? "var(--elevated)" : "var(--accent)",
            color: saving ? "var(--text-muted)" : "#fff",
            border: "none", borderRadius: 10, padding: "10px 0",
            fontWeight: 600, fontSize: 14, cursor: saving ? "default" : "pointer",
            boxShadow: saving ? "none" : "0 4px 16px rgba(124,110,248,0.3)",
            transition: "all 0.15s",
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PomodoroPage() {
  const [config, setConfig]     = useState<TimerConfig>(DEFAULT_CONFIG);
  const [mode, setMode]         = useState<Mode>("focus");
  const [secondsLeft, setLeft]  = useState(DEFAULT_CONFIG.focusMins * 60);
  const [running, setRunning]   = useState(false);
  const [muted, setMuted]       = useState(false);
  const [sessions, setSessions] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSaving] = useState(false);
  const [mounted, setMounted]   = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Load settings from DB on mount
  useEffect(() => {
    fetch("/api/user-settings")
      .then(r => r.json())
      .then((s: TimerConfig) => {
        setConfig(s);
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
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return audioCtxRef.current;
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setRunning(false);
  }, []);

  const reset = useCallback(() => { stop(); setLeft(dur(mode, config)); }, [mode, config, stop, dur]);
  const switchMode = useCallback((m: Mode) => { stop(); setMode(m); setLeft(dur(m, config)); }, [config, stop, dur]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setLeft(prev => {
        if (prev <= 1) {
          stop();
          if (!muted) try { playAlarm(getAudio()); } catch {}
          if (mode === "focus") setSessions(s => s + 1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, muted, mode]);

  const saveConfig = useCallback(async (c: TimerConfig) => {
    setSaving(true);
    try {
      await fetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      setConfig(c);
      stop();
      setLeft(dur(mode, c));
      setShowSettings(false);
    } finally {
      setSaving(false);
    }
  }, [mode, stop, dur]);

  const color = MODE_COLORS[mode];
  const dotsInCycle = sessions % config.sessionsBeforeLong;
  const completedCycles = Math.floor(sessions / config.sessionsBeforeLong);

  if (!mounted) {
    return (
      <div style={{
        height: "100vh", width: "100vw",
        background: "var(--bg)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: W, height: H, borderRadius: 14, background: "var(--card)", border: "1px solid var(--border)" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: "100vh", width: "100vw", overflow: "hidden",
      background: "var(--bg)",
      display: "flex", flexDirection: "column",
      position: "relative",
    }}>
      {/* Ambient glow */}
      <div style={{
        position: "absolute", top: "38%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 560, height: 560, borderRadius: "50%",
        background: `radial-gradient(circle, ${color}18 0%, transparent 65%)`,
        transition: "background 0.5s ease",
        pointerEvents: "none",
      }} />

      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 28px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        position: "relative", zIndex: 10,
        flexShrink: 0,
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
            onClick={() => setMuted(m => !m)}
            title={muted ? "Unmute" : "Mute"}
            style={{
              width: 34, height: 34, borderRadius: 8,
              background: "transparent", border: "1px solid var(--border)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              color: muted ? "var(--text-disabled)" : "var(--text-muted)",
            }}
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            style={{
              width: 34, height: 34, borderRadius: 8,
              background: "transparent", border: "1px solid var(--border)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-muted)",
            }}
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 24, position: "relative", zIndex: 1,
      }}>
        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["focus", "short", "long"] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                padding: "6px 18px", borderRadius: 999,
                border: `1px solid ${mode === m ? color + "50" : "var(--border)"}`,
                background: mode === m ? color + "18" : "transparent",
                color: mode === m ? color : "var(--text-muted)",
                fontSize: 11, fontWeight: 600, letterSpacing: "0.1em",
                cursor: "pointer", transition: "all 0.15s ease",
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Flip clock */}
        <FlipClock seconds={secondsLeft} />

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 4 }}>
          <button
            onClick={reset}
            title="Reset"
            style={{
              width: 46, height: 46, borderRadius: 12,
              background: "var(--card)", border: "1px solid var(--border)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-muted)", transition: "all 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
          >
            <RotateCcw size={18} />
          </button>

          <button
            onClick={() => { if (!running) getAudio(); setRunning(r => !r); }}
            style={{
              width: 72, height: 72, borderRadius: 18,
              background: `linear-gradient(135deg, ${color}, ${color}cc)`,
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff",
              boxShadow: `0 0 32px ${color}40, 0 8px 24px rgba(0,0,0,0.4)`,
              transition: "transform 0.12s ease",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.06)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
          >
            {running
              ? <Pause size={30} />
              : <Play  size={30} style={{ transform: "translateX(2px)" }} />}
          </button>

          <div style={{ width: 46 }} />
        </div>

        {/* Session dots */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {Array.from({ length: config.sessionsBeforeLong }, (_, i) => (
              <div
                key={i}
                style={{
                  height: 8, borderRadius: 999,
                  width: i < dotsInCycle ? 24 : 8,
                  background: i < dotsInCycle ? color : "var(--elevated)",
                  border: `1px solid ${i < dotsInCycle ? color + "80" : "var(--border-strong)"}`,
                  boxShadow: i < dotsInCycle ? `0 0 8px ${color}60` : "none",
                  transition: "all 0.3s ease",
                }}
              />
            ))}
          </div>
          <span style={{
            fontSize: 11, letterSpacing: "0.12em",
            color: "var(--text-muted)", fontWeight: 500,
          }}>
            {dotsInCycle} / {config.sessionsBeforeLong} SESSIONS
          </span>
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          config={config}
          saving={savingSettings}
          onSave={saveConfig}
          onClose={() => setShowSettings(false)}
        />
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
      `}</style>
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
        {label}
      </span>
      <span style={{
        fontSize: 13, fontWeight: 700,
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        color: color ?? "var(--text-primary)",
      }}>
        {value}
      </span>
    </div>
  );
}
