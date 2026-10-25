import { useSyncExternalStore } from "react";

// Open state of the sidebar drawer under `lg` (docs/mobile-pwa/SPEC.md, P3):
// the bottom tab bar's More opens it, the sidebar closes it on navigation and
// on a backdrop tap. A tiny module store, so any component can open it the way
// `openCommandPalette` opens the palette. Desktop ignores it (the sidebar is
// always in flow at `lg`).

let open = false;
const listeners = new Set<() => void>();

export function setSidebarOpen(next: boolean) {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}

export function openSidebar() { setSidebarOpen(true); }
export function closeSidebar() { setSidebarOpen(false); }

export function isSidebarOpen(): boolean { return open; }

export function subscribeSidebar(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The drawer's open state; closed on the server and on first render. */
export function useSidebarOpen(): boolean {
  return useSyncExternalStore(subscribeSidebar, isSidebarOpen, () => false);
}
