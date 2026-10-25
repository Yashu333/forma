"use client";

import { useEffect } from "react";

/** Wait this long after the `online` event, so a flapping connection settles. */
export const RELOAD_DELAY_MS = 1000;

// On the offline page: reload once the browser reports it's back online. The
// page is served in place of whatever URL failed, so a reload retries it.
// The short delay also means a navigation the user already started wins (the
// timer dies with this page).
export default function ReloadWhenOnline() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onOnline() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (navigator.onLine) window.location.reload();
      }, RELOAD_DELAY_MS);
    }
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      clearTimeout(timer);
    };
  }, []);
  return null;
}
