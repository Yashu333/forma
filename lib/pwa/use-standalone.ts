"use client";

import { useSyncExternalStore } from "react";
import { isStandalone } from "@/lib/pwa/install";

// Whether the page runs as the installed app (home-screen icon, no browser
// bar), kept up to date with display-mode changes. False on the server and
// during hydration, so the markup always matches; also false where matchMedia
// doesn't exist (jsdom) unless iOS's navigator.standalone says so.

export const STANDALONE_QUERY = "(display-mode: standalone)";

function standaloneQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(STANDALONE_QUERY) : null;
}

function subscribe(onChange: () => void) {
  const mq = standaloneQuery();
  mq?.addEventListener?.("change", onChange);
  return () => mq?.removeEventListener?.("change", onChange);
}

function getSnapshot(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return isStandalone(nav.standalone, standaloneQuery()?.matches ?? false);
}

function getServerSnapshot(): boolean {
  return false;
}

export function useStandalone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Props for a same-origin link that opens in a new tab in the browser (with
 * `rel` when given). In the installed app it stays in the app instead: a new
 * window would leave it (on iOS for Safari, which has its own storage and
 * isn't signed in), so there's no target and no rel.
 */
export function newTabProps(standalone: boolean, rel?: string): { target?: "_blank"; rel?: string } {
  if (standalone) return {};
  return rel ? { target: "_blank", rel } : { target: "_blank" };
}
