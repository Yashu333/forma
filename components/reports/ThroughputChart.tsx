"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CHART } from "./types";

interface Props {
  days: { date: string; completed: number; created: number }[];
}

const H = 220;
const PAD = { top: 16, right: 16, bottom: 26, left: 30 };

export default function ThroughputChart({ days }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(720);

  const maxVal = Math.max(1, ...days.map(d => Math.max(d.completed, d.created)));
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / maxVal) * innerH;

  const linePath = (key: "completed" | "created") =>
    days.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(" ");
  const areaPath =
    days.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d.completed).toFixed(1)}`).join(" ") +
    ` L ${x(days.length - 1).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`;

  // Rounded y ticks
  const ticks = niceTicks(maxVal, 4);

  return (
    <div style={{ width: "100%", position: "relative" }}
         ref={el => { if (el && Math.abs(el.clientWidth - width) > 2) setWidth(el.clientWidth); }}>
      <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img"
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
             const px = ((e.clientX - rect.left) / rect.width) * width;
             const i = Math.round(((px - PAD.left) / innerW) * (days.length - 1));
             setHover(Math.max(0, Math.min(days.length - 1, i)));
           }}>
        {/* Gridlines + y ticks */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)}
                  stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end"
                  style={{ fontSize: 10, fill: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{t}</text>
          </g>
        ))}

        {/* Created line (context, muted) */}
        <path d={linePath("created")} fill="none" stroke={CHART.created} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />

        {/* Completed area + line (accent) */}
        <path d={areaPath} fill={CHART.completed} opacity={0.10} />
        <path d={linePath("completed")} fill="none" stroke={CHART.completed} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" />

        {/* x labels — first, middle, last */}
        {[0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle"
                style={{ fontSize: 10, fill: "var(--text-secondary)" }}>
            {days[i] ? format(parseISO(days[i].date), "MMM d") : ""}
          </text>
        ))}

        {/* Hover crosshair + markers */}
        {hover !== null && days[hover] && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH}
                  stroke="var(--border-strong)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(days[hover].completed)} r={4}
                    fill={CHART.completed} stroke="var(--card)" strokeWidth={2} />
            <circle cx={x(hover)} cy={y(days[hover].created)} r={4}
                    fill={CHART.created} stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>

      {/* Tooltip */}
      {hover !== null && days[hover] && (
        <div style={{
          position: "absolute", top: 8,
          left: `${Math.min(Math.max((x(hover) / width) * 100, 2), 100 - (160 / width) * 100)}%`,
          width: 150, pointerEvents: "none",
          background: "var(--elevated)", border: "1px solid var(--border-strong)",
          borderRadius: 8, padding: "8px 10px", fontSize: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>
            {format(parseISO(days[hover].date), "EEE, MMM d")}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: CHART.completed, marginRight: 6 }} />Completed</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-primary)" }}>{days[hover].completed}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)", marginTop: 2 }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: CHART.created, marginRight: 6 }} />Created</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-primary)" }}>{days[hover].created}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function niceTicks(max: number, count: number): number[] {
  const step = Math.max(1, Math.ceil(max / count));
  const out: number[] = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}
