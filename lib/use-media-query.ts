"use client";

import { useSyncExternalStore } from "react";

// Whether a media query matches, kept up to date. False on the server and where
// matchMedia doesn't exist (jsdom), so phrase queries as the mobile case (for
// example "(width < 64rem)") and the desktop markup is the default.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}
