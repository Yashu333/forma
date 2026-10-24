"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CHART } from "./types";

interface Props {
  cfd: { date: string; done: number; inProgress: number }[];
}

const H = 220;
const PAD = { top: 16, right: 16, bottom: 26, left: 30 };

export default function CumulativeFlowChart({ cfd }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(720);

  const totals = cfd.map(d => d.done + d.inProgress);
  const maxVal = Math.max(1, ...totals);
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (cfd.length <= 1 ? innerW / 2 : (i / (cfd.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / maxVal) * innerH;

  // Bottom band = done; top band = done+inProgress (stacked).
  const bandPath = (lower: (d: Props["cfd"][number]) => number, upper: (d: Props["cfd"][number]) => number) => {
    const top = cfd.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(upper(d)).toFixed(1)}`).join(" ");
    const bottom = [...cfd].reverse().map((d, ri) => {
      const i = cfd.length - 1 - ri;
      return `L ${x(i).toFixed(1)} ${y(lower(d)).toFixed(1)}`;
    }).join(" ");
    return `${top} ${bottom} Z`;
  };

  const doneBand = bandPath(() => 0, d => d.done);
  const wipBand = bandPath(d => d.done, d => d.done + d.inProgress);
  const ticks = niceTicks(maxVal, 4);

  return (
    <div style={{ width: "100%", position: "relative" }}
         ref={el => { if (el && Math.abs(el.clientWidth - width) > 2) setWidth(el.clientWidth); }}>
      <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img"
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
             const px = ((e.clientX - rect.left) / rect.width) * width;
             const i = Math.round(((px - PAD.left) / innerW) * (cfd.length - 1));
             setHover(Math.max(0, Math.min(cfd.length - 1, i)));
           }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end"
                  style={{ fontSize: 10, fill: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>{t}</text>
          </g>
        ))}

        {/* In-progress band (orange wash) */}
        <path d={wipBand} fill={CHART.inProgress} opacity={0.18} />
        <path d={cfd.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d.done + d.inProgress).toFixed(1)}`).join(" ")}
              fill="none" stroke={CHART.inProgress} strokeWidth={2} strokeLinejoin="round" />

        {/* Done band (green wash) */}
        <path d={doneBand} fill={CHART.done} opacity={0.22} />
        <path d={cfd.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d.done).toFixed(1)}`).join(" ")}
              fill="none" stroke={CHART.done} strokeWidth={2} strokeLinejoin="round" />

        {[0, Math.floor((cfd.length - 1) / 2), cfd.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" style={{ fontSize: 10, fill: "var(--muted-foreground)" }}>
            {cfd[i] ? format(parseISO(cfd[i].date), "MMM d") : ""}
          </text>
        ))}

        {hover !== null && cfd[hover] && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--border-strong)" strokeWidth={1} />
        )}
      </svg>

      {hover !== null && cfd[hover] && (
        <div style={{
          position: "absolute", top: 8,
          left: `${Math.min(Math.max((x(hover) / width) * 100, 2), 100 - (170 / width) * 100)}%`,
          width: 160, pointerEvents: "none",
          background: "var(--raised)", border: "1px solid var(--border-strong)",
          borderRadius: 8, padding: "8px 10px", fontSize: 12,
        }}>
          <div style={{ color: "var(--subtle)", fontSize: 11, marginBottom: 4 }}>
            {format(parseISO(cfd[hover].date), "EEE, MMM d")}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted-foreground)" }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: CHART.inProgress, marginRight: 6 }} />In progress</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--foreground)" }}>{cfd[hover].inProgress}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted-foreground)", marginTop: 2 }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: CHART.done, marginRight: 6 }} />Done</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--foreground)" }}>{cfd[hover].done}</span>
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
