"use client";

import { useCallback, useSyncExternalStore } from "react";

// Whether a media query matches, kept up to date. False on the server and where
// matchMedia doesn't exist (jsdom), so phrase queries as the mobile case (for
// example "(width < 64rem)") and the desktop markup is the default.
export function useMediaQuery(query: string): boolean {
  // Stable per query, so React subscribes once (not on every render, mid-drag
  // included) and again only when the query changes.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => typeof window.matchMedia === "function" && window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

function serverSnapshot(): boolean {
  return false;
}
