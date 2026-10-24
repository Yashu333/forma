"use client";

import { useSyncExternalStore } from "react";
import { localDateKey } from "./dates";

// "Today" is the browser's local date plus its IANA time zone. It is read through
// useSyncExternalStore so the server render and hydration see `null` (render a
// skeleton) and the client then switches to the real date with no mismatch and
// no setState-in-effect. The store re-reads on window focus, tab visibility and
// every minute, so a view notices midnight passing.

const SEP = "|";

/** The current local date and time zone as "YYYY-MM-DD|Zone/Name". */
export function clockSnapshot(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return `${localDateKey(new Date(), tz)}${SEP}${tz}`;
}

export function subscribeClock(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  const timer = window.setInterval(onChange, 60_000);
  return () => {
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
    window.clearInterval(timer);
  };
}

export interface LocalClock {
  date: string;
  tz: string;
  /** "date|tz": changes exactly when the date or the time zone does. */
  key: string;
}

/** Splits a snapshot string. Pure, so it can be tested without a browser. */
export function parseClock(snapshot: string): LocalClock {
  const [date, tz] = snapshot.split(SEP);
  return { date, tz, key: snapshot };
}

/** The browser's local date and tz, or null on the server and during hydration. */
export function useLocalClock(): LocalClock | null {
  const snapshot = useSyncExternalStore<string | null>(subscribeClock, clockSnapshot, () => null);
  return snapshot ? parseClock(snapshot) : null;
}
