"use client";

interface Row {
  label: string;
  color: string;
  total: number;
  done: number;
}

interface Props {
  rows: Row[];
}

// Horizontal bars: magnitude comparison across a handful of named categories.
// Each bar shows total (track) with the done portion filled darker, value at the
// tip. The category's own color carries identity; text stays in text tokens.
export default function BreakdownBars({ rows }: Props) {
  const max = Math.max(1, ...rows.map(r => r.total));

  if (rows.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--subtle)" }}>No tasks in this range.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map(r => {
        const pct = (r.total / max) * 100;
        const donePct = r.total ? (r.done / r.total) * 100 : 0;
        return (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 76, flexShrink: 0, display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: r.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.label}
              </span>
            </div>

            {/* Track: reserved width so the fill can never push the label out */}
            <div style={{ flex: 1, height: 20, position: "relative", minWidth: 0 }}>
              <div style={{
                position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`,
                minWidth: 4, background: `${r.color}22`, borderRadius: 4,
              }}>
                {/* Done fill */}
                <div style={{
                  position: "absolute", left: 0, top: 0, height: "100%", width: `${donePct}%`,
                  background: r.color, borderRadius: 4,
                }} />
              </div>
            </div>

            {/* Value label: fixed column, never overlaps or clips */}
            <span style={{
              width: 52, flexShrink: 0, textAlign: "right",
              fontSize: 12, color: "var(--foreground)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
            }}>
              {r.done}<span style={{ color: "var(--subtle)" }}>/{r.total}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
