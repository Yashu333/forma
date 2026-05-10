"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronLeft, ChevronRight, X, Clock } from "lucide-react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, isSameMonth, isSameDay, isToday, isBefore,
} from "date-fns";

interface Props {
  value: string; // "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD" or ""
  onChange: (val: string) => void;
  pillStyle: React.CSSProperties;
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  // Parse as local time: "YYYY-MM-DDTHH:MM" would be treated as UTC by new Date(),
  // so we split and construct manually to get local time.
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart ? timePart.split(":").map(Number) : [0, 0];
  const d = new Date(year, month - 1, day, hour, minute, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function dateStr(d: Date) { return format(d, "yyyy-MM-dd"); }
function timeStr(d: Date) { return format(d, "HH:mm"); }

export default function DatePicker({ value, onChange, pillStyle }: Props) {
  const selected = parseDate(value);
  const [open, setOpen]     = useState(false);
  const [cursor, setCursor] = useState(() => selected ?? new Date());
  const [time, setTime]     = useState(() => selected ? timeStr(selected) : "");
  const ref = useRef<HTMLDivElement>(null);

  // Keep time in sync when value changes externally
  useEffect(() => {
    const d = parseDate(value);
    setTime(d ? timeStr(d) : "");
    if (d) setCursor(d);
  }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const dueDateColor = (() => {
    if (!selected) return "var(--text-muted)";
    const now = new Date();
    if (selected < now) return "#F87171";
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    if (selected <= todayEnd) return "#EAB308";
    return "#34D399";
  })();

  // Build calendar grid
  const monthStart = startOfMonth(cursor);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  const days: Date[] = [];
  let d = gridStart;
  while (d <= gridEnd) { days.push(d); d = addDays(d, 1); }

  function selectDay(day: Date) {
    const t = time || "00:00";
    const [h, m] = t.split(":").map(Number);
    const result = new Date(day);
    result.setHours(h, m, 0, 0);
    onChange(format(result, "yyyy-MM-dd'T'HH:mm"));
    // keep picker open so user can adjust time
  }

  function handleTimeChange(t: string) {
    setTime(t);
    if (selected) {
      const [h, m] = t.split(":").map(Number);
      const result = new Date(selected);
      result.setHours(h, m, 0, 0);
      onChange(format(result, "yyyy-MM-dd'T'HH:mm"));
    }
  }

  function handleClear() {
    onChange("");
    setTime("");
    setOpen(false);
  }

  const pillLabel = (() => {
    if (!selected) return "Due date";
    const hasTime = time && time !== "00:00";
    return hasTime
      ? format(selected, "MMM d, yyyy") + " · " + format(selected, "h:mm a")
      : format(selected, "MMM d, yyyy");
  })();

  return (
    <div className="flex items-center gap-1" ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{ ...pillStyle, cursor: "pointer", color: selected ? "var(--text-primary)" : "var(--text-secondary)" }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.color = selected ? "var(--text-primary)" : "var(--text-secondary)"; }}
      >
        <Calendar className="w-3 h-3 flex-shrink-0" style={{ color: dueDateColor }} />
        {pillLabel}
      </button>

      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="btn-icon w-5 h-5"
          style={{ color: "var(--text-disabled)", flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#F87171"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-disabled)"}
          title="Clear due date"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 200,
            background: "var(--elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "0.75rem",
            padding: "14px",
            width: 252,
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
          className="animate-in-up"
        >
          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setCursor(c => subMonths(c, 1))}
              className="btn-icon w-6 h-6"
              style={{ color: "var(--text-muted)" }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              {format(cursor, "MMMM yyyy")}
            </span>
            <button
              type="button"
              onClick={() => setCursor(c => addMonths(c, 1))}
              className="btn-icon w-6 h-6"
              style={{ color: "var(--text-muted)" }}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {["Mo","Tu","We","Th","Fr","Sa","Su"].map((l, i) => (
              <div key={i} style={{ textAlign: "center", fontSize: 10, color: "var(--text-muted)", fontWeight: 700, padding: "2px 0", letterSpacing: "0.03em" }}>
                {l}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7" style={{ gap: 2 }}>
            {days.map((day, i) => {
              const isSelected  = selected ? isSameDay(day, selected) : false;
              const isCurMonth  = isSameMonth(day, cursor);
              const isDayToday  = isToday(day);
              const isPast      = isBefore(day, today);

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDay(day)}
                  style={{
                    width: "100%",
                    aspectRatio: "1",
                    borderRadius: "6px",
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 400,
                    background: isSelected ? "#7C6EF8" : "transparent",
                    color: isSelected
                      ? "#FFFFFF"
                      : !isCurMonth
                      ? "var(--text-disabled)"
                      : isDayToday
                      ? "#A99FF8"
                      : isPast
                      ? "var(--text-muted)"
                      : "#ECEEFF",
                    border: isDayToday && !isSelected
                      ? "1px solid rgba(124,110,248,0.5)"
                      : "1px solid transparent",
                    cursor: "pointer",
                    transition: "background 0.1s, color 0.1s",
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.background = "var(--hover)";
                      (e.currentTarget as HTMLElement).style.color = "#ECEEFF";
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = isSelected
                        ? "#FFFFFF"
                        : !isCurMonth
                        ? "var(--text-disabled)"
                        : isDayToday
                        ? "#A99FF8"
                        : isPast
                        ? "var(--text-muted)"
                        : "#ECEEFF";
                    }
                  }}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>

          {/* Time input */}
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 10 }}>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
              <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>Time</span>
              <input
                type="time"
                value={time}
                onChange={e => handleTimeChange(e.target.value)}
                style={{
                  flex: 1,
                  background: "var(--card)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "6px",
                  color: "#ECEEFF",
                  fontSize: 12,
                  padding: "4px 8px",
                  outline: "none",
                  colorScheme: "dark",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = "var(--border-accent)")}
                onBlur={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
              />
            </div>
          </div>

          {/* Today shortcut */}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const t = format(now, "HH:mm");
                setTime(t);
                onChange(format(now, "yyyy-MM-dd'T'HH:mm"));
                setCursor(now);
              }}
              style={{
                fontSize: 12, color: "var(--accent)", background: "none",
                border: "none", cursor: "pointer", width: "100%",
                textAlign: "center", padding: "4px 0",
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#A99FF8"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--accent)"}
            >
              Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
