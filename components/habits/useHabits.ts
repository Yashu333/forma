"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createHabit, deleteHabit, fetchHabits, patchHabit, setCheck,
  type HabitDTO, type HabitsPayload,
} from "./api";

// Habit state shared by the /today card and the /habits page. Ticks are
// optimistic: the square flips at once, the server answer then refreshes the
// streaks, and a failure puts the square back and shows a notice.
export function useHabits(today: string, tz: string) {
  const [data, setData] = useState<HabitsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const payload = await fetchHabits(today, tz);
      if (mine !== seq.current) return;
      setData(payload);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : "Couldn't load your habits");
    }
  }, [today, tz]);

  // The first load, and a reload when the date or zone changes.
  useEffect(() => {
    let cancelled = false;
    const mine = ++seq.current;
    fetchHabits(today, tz)
      .then((payload) => {
        if (cancelled || mine !== seq.current) return;
        setData(payload);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled && mine === seq.current) setError(e instanceof Error ? e.message : "Couldn't load your habits");
      });
    return () => {
      cancelled = true;
    };
  }, [today, tz]);

  const run = useCallback(async (action: () => Promise<void>, rollback?: () => void) => {
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      rollback?.();
      setNotice(e instanceof Error ? e.message : "Something went wrong");
    }
  }, [refresh]);

  const mapHabit = useCallback((id: string, fn: (h: HabitDTO) => HabitDTO) => {
    setData((d) => (d ? { ...d, habits: d.habits.map((h) => (h.id === id ? fn(h) : h)) } : d));
  }, []);

  const toggle = useCallback((habit: HabitDTO, date: string) => {
    const on = !habit.checks.includes(date);
    const flip = (h: HabitDTO, to: boolean): HabitDTO => ({
      ...h,
      checks: to ? [...h.checks, date].sort() : h.checks.filter((d) => d !== date),
    });
    mapHabit(habit.id, (h) => flip(h, on));
    return run(() => setCheck(habit.id, date, on, today), () => mapHabit(habit.id, (h) => flip(h, !on)));
  }, [mapHabit, run, today]);

  const add = useCallback((name: string, weekdays: number[]) => run(() => createHabit(name, weekdays)), [run]);
  const update = useCallback((id: string, body: Parameters<typeof patchHabit>[1]) => run(() => patchHabit(id, body)), [run]);
  const remove = useCallback((id: string) => run(() => deleteHabit(id)), [run]);

  /** Moves a habit to `index` in the list by giving it an order between its new neighbours. */
  const move = useCallback((id: string, index: number) => {
    const habits = data?.habits ?? [];
    const others = habits.filter((h) => h.id !== id);
    const before = others[index - 1];
    const after = others[index];
    const order = before && after ? (before.order + after.order) / 2 : before ? before.order + 1 : after ? after.order - 1 : 0;
    const moved = habits.find((h) => h.id === id);
    if (!moved) return Promise.resolve();
    setData((d) => {
      if (!d) return d;
      const next = [...others];
      next.splice(index, 0, { ...moved, order });
      return { ...d, habits: next };
    });
    return run(() => patchHabit(id, { order }), () => void refresh());
  }, [data, run, refresh]);

  return { data, error, notice, setNotice, refresh, toggle, add, update, remove, move };
}
