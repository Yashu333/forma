"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { useLocalClock } from "@/lib/frog/clock";
import { addDays } from "@/lib/frog/dates";
import { weekdayOf } from "@/lib/recurrence/rule";
import type { HabitDTO } from "./api";
import { useHabits } from "./useHabits";

function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// The last seven days of one habit: ticked, missed (scheduled, not ticked) or
// not scheduled. Colour is never the only signal: each square carries a label.
function WeekStrip({ habit, today }: { habit: HabitDTO; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return (
    <div className="flex gap-1 max-sm:gap-0.5" aria-hidden="true">
      {days.map((d) => {
        const ticked = habit.checks.includes(d);
        const scheduled = habit.weekdays.includes(weekdayOf(d));
        const isToday = d === today;
        return (
          <span
            key={d}
            title={`${format(keyToDate(d), "EEE d MMM")}: ${ticked ? "done" : scheduled ? (isToday ? "not yet" : "missed") : "not scheduled"}`}
            className={`w-3.5 h-3.5 rounded-sm border ${
              ticked ? "bg-success border-success" : scheduled ? (isToday ? "border-muted-foreground" : "border-border") : "bg-raised border-transparent"
            }`}
          />
        );
      })}
    </div>
  );
}

function Row({ habit, today, onToggle }: { habit: HabitDTO; today: string; onToggle: () => void }) {
  const ticked = habit.checks.includes(today);
  return (
    <li className="flex items-center gap-3 max-sm:gap-2.5 py-2.5">
      {/* Under lg the button is a 44x40 hit area around the same 20px box (negative
          margins keep the layout; 10px above and below stays inside the row's padding,
          so neighbouring habits never overlap), and the focus ring moves to the box. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={ticked}
        aria-label={`${habit.name}, today`}
        onClick={onToggle}
        className="group/cb w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 max-lg:w-11 max-lg:h-10 max-lg:-mx-3 max-lg:-my-2.5 max-lg:focus-visible:outline-none"
      >
        <span
          className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors max-lg:group-focus-visible/cb:outline-2 max-lg:group-focus-visible/cb:outline-offset-2 max-lg:group-focus-visible/cb:outline-ring"
          style={ticked ? { background: "var(--success)", border: "1px solid var(--success)" } : { background: "transparent", border: "1px solid var(--input)" }}
        >
          {ticked && <Check className="w-3.5 h-3.5 text-primary-foreground" aria-hidden="true" />}
        </span>
      </button>
      {/* One line; a long name is cut, with the full name in the tooltip (and on /habits). */}
      <span title={habit.name} className={`text-sm flex-1 min-w-0 truncate ${ticked ? "text-muted-foreground" : "text-foreground"}`}>{habit.name}</span>
      <WeekStrip habit={habit} today={today} />
      <span className="font-mono text-xs tabular text-subtle w-7 text-right" aria-label={`${habit.streak.current}-day streak`} title="Current streak">
        {habit.streak.current}
      </span>
    </li>
  );
}

// Today's habits, on /today. Only habits scheduled for today are listed.
export default function HabitsCard() {
  const clock = useLocalClock();
  if (!clock) return null;
  return <HabitsCardInner today={clock.date} tz={clock.tz} />;
}

function HabitsCardInner({ today, tz }: { today: string; tz: string }) {
  const { data, error, notice, toggle, refresh } = useHabits(today, tz);

  if (error && !data) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4 flex items-center gap-3" aria-label="Habits" role="alert">
        <p className="text-sm text-danger flex-1">{error}</p>
        <button className="btn-secondary" onClick={() => void refresh()}>Retry</button>
      </section>
    );
  }
  if (!data) return null;

  const scheduled = data.habits.filter((h) => h.scheduledToday);
  const done = scheduled.filter((h) => h.checks.includes(today)).length;

  return (
    <section className="rounded-lg border border-border bg-surface p-4" aria-labelledby="habits-card-title">
      <div className="flex items-center gap-2">
        <h2 id="habits-card-title" className="text-sm font-semibold text-foreground">Habits</h2>
        {scheduled.length > 0 && <span className="text-xs text-subtle tabular">{done} of {scheduled.length} today</span>}
        <Link href="/habits" className="btn-ghost ml-auto !py-1 max-lg:!py-2.5 max-lg:-my-1.5">Manage</Link>
      </div>

      {data.habits.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-2">
          <Link href="/habits" className="underline text-foreground">Track a daily habit</Link>, like reading or a walk.
        </p>
      ) : scheduled.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-2">None of your habits are scheduled today.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {scheduled.map((h) => (
            <Row key={h.id} habit={h} today={today} onToggle={() => void toggle(h, today)} />
          ))}
        </ul>
      )}
      {notice && <p className="text-xs text-danger mt-2" role="alert">{notice}</p>}
    </section>
  );
}
