"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Repeat } from "lucide-react";
import { formatRepeat, weekdayOf, type RepeatRule } from "@/lib/recurrence/rule";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

type Unit = "day" | "week" | "month" | "year";

interface Props {
  value: RepeatRule | null;
  /** The task's due date key, "YYYY-MM-DD" (today when it has none): the presets are built around it. */
  anchorKey: string;
  onChange: (rule: RepeatRule | null) => void;
  pillStyle: React.CSSProperties;
}

export default function RepeatPicker({ value, anchorKey, onChange, pillStyle }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [n, setN] = useState("1");
  const [unit, setUnit] = useState<Unit>("week");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [monthDay, setMonthDay] = useState<string>("1");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const dow = weekdayOf(anchorKey);
  const dom = Number(anchorKey.slice(8, 10));

  const presets: { label: string; rule: RepeatRule }[] = [
    { label: "Every day", rule: { freq: "day", interval: 1 } },
    { label: "Weekdays", rule: { freq: "week", interval: 1, weekdays: [1, 2, 3, 4, 5] } },
    { label: `Every week on ${LONG_DAYS[dow]}`, rule: { freq: "week", interval: 1, weekdays: [dow] } },
    { label: `Every month on the ${ordinal(dom)}`, rule: { freq: "month", interval: 1, day: dom } },
    { label: "Every year", rule: { freq: "year", interval: 1 } },
  ];

  function pick(rule: RepeatRule | null) {
    onChange(rule);
    setOpen(false);
    setCustom(false);
  }

  function startCustom() {
    if (value) {
      setN(String(value.interval));
      setUnit(value.freq);
      setWeekdays(value.freq === "week" ? value.weekdays : [dow]);
      setMonthDay(value.freq === "month" ? String(value.day) : String(dom));
    } else {
      setN("1");
      setUnit("week");
      setWeekdays([dow]);
      setMonthDay(String(dom));
    }
    setCustom(true);
  }

  function applyCustom() {
    const interval = Math.min(365, Math.max(1, Math.floor(Number(n)) || 1));
    if (unit === "day") pick({ freq: "day", interval });
    else if (unit === "year") pick({ freq: "year", interval });
    else if (unit === "week") pick({ freq: "week", interval, weekdays: (weekdays.length ? weekdays : [dow]).slice().sort((a, b) => a - b) });
    else {
      const day = monthDay === "last" ? "last" : Math.min(31, Math.max(1, Math.floor(Number(monthDay)) || 1));
      pick({ freq: "month", interval, day });
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        style={value ? { ...pillStyle, color: "var(--foreground)" } : pillStyle}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Repeat className="w-3 h-3" aria-hidden="true" />
        {value ? formatRepeat(value) : "Repeat"}
        <ChevronDown className="w-3 h-3 ml-0.5 text-subtle" aria-hidden="true" />
      </button>

      {open && (
        <div className="dropdown-menu absolute top-full mt-1 left-0 w-[260px] max-w-[calc(100vw-2rem)] animate-in-up">
          {!custom ? (
            <>
              {value && (
                <button type="button" onClick={() => pick(null)} className="dropdown-item first:pt-2">Doesn&apos;t repeat</button>
              )}
              {presets.map((p) => (
                <button key={p.label} type="button" onClick={() => pick(p.rule)} className="dropdown-item first:pt-2">
                  {p.label}
                </button>
              ))}
              <button type="button" onClick={startCustom} className="dropdown-item last:pb-2">Custom…</button>
            </>
          ) : (
            <div className="p-3 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Every</span>
                <input
                  type="number" min={1} max={365} value={n}
                  onChange={(e) => setN(e.target.value)}
                  aria-label="Repeat interval"
                  className="forma-input !w-16 !py-1 !px-2 !text-sm"
                />
                <select
                  value={unit} onChange={(e) => setUnit(e.target.value as Unit)}
                  aria-label="Repeat unit"
                  className="forma-input !w-auto !py-1 !px-2 !text-sm"
                >
                  <option value="day">days</option>
                  <option value="week">weeks</option>
                  <option value="month">months</option>
                  <option value="year">years</option>
                </select>
              </div>
              {unit === "week" && (
                <div className="flex flex-wrap gap-1" role="group" aria-label="Repeat on">
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const on = weekdays.includes(d);
                    return (
                      <button
                        key={d} type="button" aria-pressed={on}
                        onClick={() => setWeekdays((w) => (on ? w.filter((x) => x !== d) : [...w, d]))}
                        className={`rounded-md border px-2 py-1 text-xs ${on ? "border-primary bg-primary-soft text-foreground" : "border-border text-muted-foreground hover:border-border-strong"}`}
                      >
                        {DAY_NAMES[d]}
                      </button>
                    );
                  })}
                </div>
              )}
              {unit === "month" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>On day</span>
                  <select
                    value={monthDay} onChange={(e) => setMonthDay(e.target.value)}
                    aria-label="Day of the month"
                    className="forma-input !w-auto !py-1 !px-2 !text-sm"
                  >
                    {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    <option value="last">Last day</option>
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setCustom(false)}>Back</button>
                <button type="button" className="btn-secondary" onClick={applyCustom}>Set repeat</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
