"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, RotateCcw, Volume2, VolumeX, Coffee, Brain, Zap } from "lucide-react";

type Mode = "focus" | "short" | "long";

const MODES: Record<Mode, { label: string; duration: number; color: string; icon: React.ReactNode }> = {
  focus: { label: "Focus",       duration: 25 * 60, color: "#7C6EF8", icon: <Brain className="w-3.5 h-3.5" /> },
  short: { label: "Short Break", duration:  5 * 60, color: "#34D399", icon: <Coffee className="w-3.5 h-3.5" /> },
  long:  { label: "Long Break",  duration: 15 * 60, color: "#60A5FA", icon: <Zap className="w-3.5 h-3.5" />   },
};

function buildAlarmBuffer(ctx: AudioContext): AudioBuffer {
  const duration  = 1.4;
  const sampleRate = ctx.sampleRate;
  const length    = Math.floor(duration * sampleRate);
  const buffer    = ctx.createBuffer(1, length, sampleRate);
  const data      = buffer.getChannelData(0);

  const tones = [880, 1046, 1318];
  for (let i = 0; i < length; i++) {
    const t    = i / sampleRate;
    const tone = tones[Math.floor(t / (duration / tones.length)) % tones.length];
    const env  = Math.min(1, (duration - t) / 0.3);
    data[i]    = Math.sin(2 * Math.PI * tone * t) * 0.45 * env;
  }
  return buffer;
}

function playAlarm(ctx: AudioContext) {
  const buf = buildAlarmBuffer(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

export default function PomodoroPage() {
  const [mode, setMode]         = useState<Mode>("focus");
  const [secondsLeft, setLeft]  = useState(MODES.focus.duration);
  const [running, setRunning]   = useState(false);
  const [muted, setMuted]       = useState(false);
  const [sessions, setSessions] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const current = MODES[mode];
  const total   = current.duration;
  const pct     = (total - secondsLeft) / total;

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    stop();
    setLeft(MODES[mode].duration);
  }, [mode, stop]);

  const switchMode = useCallback((m: Mode) => {
    stop();
    setMode(m);
    setLeft(MODES[m].duration);
  }, [stop]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setLeft(prev => {
        if (prev <= 1) {
          stop();
          if (!muted) {
            try { playAlarm(getAudioCtx()); } catch {}
          }
          if (mode === "focus") setSessions(s => s + 1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, muted, mode]);

  useEffect(() => { reset(); }, [mode]);

  // Clock face geometry
  const R = 140;
  const cx = 160;
  const cy = 160;
  const circumference = 2 * Math.PI * R;
  const strokeDash = circumference * pct;

  // Tick marks
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const angle  = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const isLong = i % 5 === 0;
    const r1     = isLong ? R - 14 : R - 8;
    const x1     = cx + r1 * Math.cos(angle);
    const y1     = cy + r1 * Math.sin(angle);
    const x2     = cx + R * Math.cos(angle);
    const y2     = cy + R * Math.sin(angle);
    return { x1, y1, x2, y2, isLong };
  });

  // Minute numbers
  const numbers = [5, 10, 15, 20, 25];
  const numEls  = numbers.map(n => {
    const angle = (n / 30) * 2 * Math.PI - Math.PI / 2;
    const nr    = R - 26;
    return {
      label: n,
      x: cx + nr * Math.cos(angle),
      y: cy + nr * Math.sin(angle),
    };
  });

  // Hand angle — maps elapsed seconds to rotation
  const handAngle = (1 - secondsLeft / total) * 360;
  const handRad   = (handAngle - 90) * (Math.PI / 180);
  const handTip   = {
    x: cx + (R - 18) * Math.cos(handRad),
    y: cy + (R - 18) * Math.sin(handRad),
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-10 px-6 py-12"
         style={{ background: "var(--bg)" }}>

      {/* ── Header ── */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Pomodoro Timer
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Stay focused, take breaks, get things done.
        </p>
      </div>

      {/* ── Mode tabs ── */}
      <div className="flex gap-2 p-1 rounded-xl" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {(Object.entries(MODES) as [Mode, typeof MODES[Mode]][]).map(([key, val]) => (
          <button
            key={key}
            onClick={() => switchMode(key)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150"
            style={{
              background: mode === key ? val.color + "22" : "transparent",
              color:      mode === key ? val.color : "var(--text-muted)",
              border:     mode === key ? `1px solid ${val.color}44` : "1px solid transparent",
            }}
          >
            {val.icon}
            {val.label}
          </button>
        ))}
      </div>

      {/* ── Clock face ── */}
      <div className="relative select-none">
        {/* Paper texture ring */}
        <div className="absolute inset-0 rounded-full pointer-events-none"
             style={{
               background: "radial-gradient(ellipse at 30% 25%, rgba(255,255,255,0.04) 0%, transparent 70%)",
               boxShadow:  `0 0 0 1px rgba(255,255,255,0.07), 0 0 60px 0 ${current.color}18, 0 20px 60px rgba(0,0,0,0.5)`,
             }} />

        <svg width="320" height="320" viewBox="0 0 320 320">
          <defs>
            {/* Paper grain filter */}
            <filter id="paper">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" result="noise" />
              <feColorMatrix type="saturate" values="0" in="noise" result="gray" />
              <feBlend in="SourceGraphic" in2="gray" mode="multiply" result="blend" />
              <feComposite in="blend" in2="SourceGraphic" operator="in" />
            </filter>
            <radialGradient id="clockBg" cx="40%" cy="35%" r="65%">
              <stop offset="0%"   stopColor="#2C2E4A" />
              <stop offset="100%" stopColor="#1E203A" />
            </radialGradient>
          </defs>

          {/* Clock background — parchment feel */}
          <circle cx={cx} cy={cy} r={R + 20} fill="url(#clockBg)" filter="url(#paper)" />
          <circle cx={cx} cy={cy} r={R + 20} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />

          {/* Progress arc (elapsed) */}
          <circle
            cx={cx} cy={cy} r={R}
            fill="none"
            stroke={current.color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${strokeDash} ${circumference}`}
            transform={`rotate(-90 ${cx} ${cy})`}
            opacity="0.85"
            style={{ transition: "stroke-dasharray 0.4s ease, stroke 0.4s ease" }}
          />

          {/* Track ring */}
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

          {/* Tick marks */}
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke={t.isLong ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.13)"}
              strokeWidth={t.isLong ? 1.5 : 1}
              strokeLinecap="round"
            />
          ))}

          {/* Minute numbers */}
          {numEls.map(n => (
            <text
              key={n.label}
              x={n.x} y={n.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="11"
              fontFamily="'Georgia', serif"
              fill="rgba(255,255,255,0.28)"
              letterSpacing="0.5"
            >
              {n.label}
            </text>
          ))}

          {/* Hand */}
          <line
            x1={cx} y1={cy}
            x2={handTip.x} y2={handTip.y}
            stroke={current.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ transition: running ? "none" : "all 0.3s ease", filter: `drop-shadow(0 0 4px ${current.color})` }}
          />

          {/* Center pivot */}
          <circle cx={cx} cy={cy} r="5" fill={current.color} />
          <circle cx={cx} cy={cy} r="2" fill="#1E203A" />

          {/* Digital time in center */}
          <text
            x={cx} y={cy + 42}
            textAnchor="middle"
            fontSize="34"
            fontFamily="'Georgia', 'Times New Roman', serif"
            fontWeight="normal"
            letterSpacing="4"
            fill="rgba(255,255,255,0.90)"
          >
            {mins}:{secs}
          </text>

          {/* Mode label */}
          <text
            x={cx} y={cy + 66}
            textAnchor="middle"
            fontSize="11"
            fontFamily="'Georgia', serif"
            letterSpacing="2"
            fill={current.color}
            opacity="0.8"
          >
            {current.label.toUpperCase()}
          </text>
        </svg>
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center gap-4">
        <button
          onClick={reset}
          className="w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--card)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
          title="Reset"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={() => {
            if (!running) getAudioCtx(); // unlock audio on first interaction
            setRunning(r => !r);
          }}
          className="w-16 h-16 rounded-full flex items-center justify-center font-semibold transition-all duration-200"
          style={{
            background: `linear-gradient(135deg, ${current.color}, ${current.color}cc)`,
            boxShadow:  `0 0 24px ${current.color}55, 0 4px 16px rgba(0,0,0,0.4)`,
            color: "#fff",
          }}
        >
          {running
            ? <Pause  className="w-7 h-7" />
            : <Play   className="w-7 h-7 translate-x-0.5" />}
        </button>

        <button
          onClick={() => setMuted(m => !m)}
          className="w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: muted ? "var(--text-disabled)" : "var(--text-muted)",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--hover)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--card)"; (e.currentTarget as HTMLElement).style.color = muted ? "var(--text-disabled)" : "var(--text-muted)"; }}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>

      {/* ── Session counter ── */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Sessions completed today
        </span>
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="w-3 h-3 rounded-full transition-all duration-300"
              style={{
                background:  i < sessions % 4   ? "#7C6EF8" : "var(--card)",
                border:      `1px solid ${i < sessions % 4 ? "#7C6EF8" : "var(--border-strong)"}`,
                boxShadow:   i < sessions % 4   ? "0 0 8px #7C6EF888" : "none",
              }}
            />
          ))}
        </div>
        {sessions > 0 && (
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            {sessions} session{sessions !== 1 ? "s" : ""} — {Math.floor(sessions / 4)} long break{Math.floor(sessions / 4) !== 1 ? "s" : ""} earned
          </span>
        )}
      </div>

      {/* ── Tip ── */}
      <p className="text-xs text-center max-w-xs" style={{ color: "var(--text-disabled)" }}>
        Every 4 focus sessions, take a long break to recharge.
      </p>
    </div>
  );
}
