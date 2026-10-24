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
  const [time, setTime]     = useState(() => {
    if (selected) return timeStr(selected);
    const now = new Date();
    now.setHours(now.getHours() + 1, 0, 0, 0);
    return timeStr(now);
  });
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

  const overdue = !!selected && selected < new Date();

  // Build calendar grid
  const monthStart = startOfMonth(cursor);
  const gridStart  = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd    = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  const days: Date[] = [];
  let d = gridStart;
  while (d <= gridEnd) { days.push(d); d = addDays(d, 1); }

  function selectDay(day: Date) {
    let t = time;
    if (!t) {
      const now = new Date();
      now.setHours(now.getHours() + 1, 0, 0, 0);
      t = timeStr(now);
      setTime(t);
    }
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
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          const willOpen = !open;
          if (willOpen && !value) {
            const now = new Date();
            now.setHours(now.getHours() + 1, 0, 0, 0);
            const t = timeStr(now);
            setTime(t);
            setCursor(now);
            onChange(format(now, "yyyy-MM-dd'T'HH:mm"));
          }
          setOpen(willOpen);
        }}
        style={{ ...pillStyle, cursor: "pointer", color: overdue ? "var(--danger)" : selected ? "var(--foreground)" : "var(--muted-foreground)" }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
      >
        <Calendar className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
        {pillLabel}
        {overdue && <span className="sr-only">, overdue</span>}
      </button>

      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="btn-icon w-7 h-7 flex-shrink-0 hover:!text-danger"
          title="Clear due date"
          aria-label="Clear due date"
        >
          <X className="w-3 h-3" aria-hidden="true" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Choose due date"
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200, width: 252 }}
          className="animate-in-up rounded-lg border border-border-strong bg-surface p-3.5"
        >
          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setCursor(c => subMonths(c, 1))}
              className="btn-icon w-6 h-6"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <span className="text-[13px] font-semibold text-foreground">
              {format(cursor, "MMMM yyyy")}
            </span>
            <button
              type="button"
              onClick={() => setCursor(c => addMonths(c, 1))}
              className="btn-icon w-6 h-6"
              aria-label="Next month"
            >
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {["Mo","Tu","We","Th","Fr","Sa","Su"].map((l, i) => (
              <div key={i} className="text-center text-[11px] font-medium text-subtle py-0.5">
                {l}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day, i) => {
              const isSelected  = selected ? isSameDay(day, selected) : false;
              const isCurMonth  = isSameMonth(day, cursor);
              const isDayToday  = isToday(day);
              const isPast      = isBefore(day, today);

              const tone = isSelected
                ? "bg-primary text-primary-foreground font-semibold"
                : !isCurMonth
                ? "text-subtle hover:bg-raised"
                : isPast
                ? "text-subtle hover:bg-raised hover:text-foreground"
                : "text-foreground hover:bg-raised";

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDay(day)}
                  aria-label={format(day, "EEEE, MMMM d, yyyy")}
                  aria-pressed={isSelected}
                  aria-current={isDayToday ? "date" : undefined}
                  className={`w-full aspect-square rounded-md text-xs tabular transition-colors border ${tone} ${
                    isDayToday && !isSelected ? "border-border-strong" : "border-transparent"
                  }`}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>

          {/* Time input */}
          <div className="border-t border-border mt-3 pt-2.5">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 flex-shrink-0 text-subtle" aria-hidden="true" />
              <label htmlFor="due-time" className="text-xs text-subtle flex-shrink-0">Time</label>
              <input
                id="due-time"
                type="time"
                value={time}
                onChange={e => handleTimeChange(e.target.value)}
                className="forma-input flex-1 !py-1 !px-2 !text-xs"
                style={{ colorScheme: "dark" }}
              />
            </div>
          </div>

          {/* Now shortcut */}
          <div className="mt-2">
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                const t = format(now, "HH:mm");
                setTime(t);
                onChange(format(now, "yyyy-MM-dd'T'HH:mm"));
                setCursor(now);
              }}
              className="w-full text-center text-xs py-1 rounded-md text-muted-foreground transition-colors hover:bg-raised hover:text-foreground"
            >
              Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
