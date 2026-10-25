"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

// A thin bar at the top of the app shell while the browser is offline
// (docs/mobile-pwa/SPEC.md, P2). Renders nothing while online. Mounted at the
// top of the app shell's column (app/(app)/layout.tsx), above the page row.

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true, // server render: assume online
  );
}

export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-4 py-1.5 border-b border-border bg-surface text-xs text-muted-foreground"
    >
      <WifiOff className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      <span>You&apos;re offline. Changes won&apos;t save until you reconnect.</span>
    </div>
  );
}
