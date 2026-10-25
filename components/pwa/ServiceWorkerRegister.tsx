"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { SW_MESSAGES } from "@/lib/pwa/sw-client";

// Registers public/sw.js and shows the update toast (docs/mobile-pwa/SPEC.md,
// P2 and decisions 5 and 6). Mounted once, in app/layout.tsx.

/** Look for a new version when the app comes back to the front, at most this often. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export const UPDATE_MESSAGE = "A new version of Forma is ready";

export default function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Read here, not at module level, so tests can stub it. Next inlines it in
    // the client bundle.
    if (process.env.NODE_ENV !== "production") {
      // Decision 5: no service worker in `next dev`, and none left over from a
      // production run on the same origin, so dev never serves stale code.
      void removeServiceWorkers();
      return;
    }

    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;
    const watched: [ServiceWorker, () => void][] = [];
    let lastCheck = Date.now(); // register() itself checks for an update

    // A new worker that finished installing while an old one controls the
    // page is an update waiting for the user. (With no controller it's the
    // first install, which activates by itself.)
    function offerIfWaiting(worker: ServiceWorker) {
      if (!cancelled && worker.state === "installed" && navigator.serviceWorker.controller) {
        setWaiting(worker);
        setDismissed(false);
      }
    }
    function watch(worker: ServiceWorker) {
      const onStateChange = () => offerIfWaiting(worker);
      worker.addEventListener("statechange", onStateChange);
      watched.push([worker, onStateChange]);
    }
    function onUpdateFound() {
      if (registration?.installing) watch(registration.installing);
    }
    function onVisibilityChange() {
      if (document.visibilityState !== "visible" || !registration) return;
      const now = Date.now();
      if (now - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheck = now;
      registration.update().catch(() => {});
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        if (reg.waiting) offerIfWaiting(reg.waiting);
        if (reg.installing) watch(reg.installing);
        reg.addEventListener("updatefound", onUpdateFound);
      })
      .catch(() => {
        // No service worker (private mode, blocked): the app works without it.
      });
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      registration?.removeEventListener("updatefound", onUpdateFound);
      for (const [worker, fn] of watched) worker.removeEventListener("statechange", fn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Decision 6: never reload on our own; only when the user asks.
  function reload() {
    if (!waiting || reloadingRef.current) return; // one reload per toast, even on a double tap
    reloadingRef.current = true;
    setReloading(true);
    if (waiting.state !== "installed") {
      // Activating/activated: another tab already switched to it. Redundant:
      // it was replaced or failed, so there is nothing to wait for.
      window.location.reload();
      return;
    }
    let done = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (done) return;
      done = true;
      window.location.reload();
    });
    waiting.postMessage({ type: SW_MESSAGES.skipWaiting });
  }

  const show = !!waiting && !dismissed;

  return (
    <>
      {/* Always mounted, so screen readers announce the text when it appears. */}
      <p role="status" aria-live="polite" className="sr-only">
        {show ? UPDATE_MESSAGE : ""}
      </p>
      {show && <UpdateToast reloading={reloading} onReload={reload} onDismiss={() => setDismissed(true)} />}
    </>
  );
}

function UpdateToast({ reloading, onReload, onDismiss }: { reloading: boolean; onReload: () => void; onDismiss: () => void }) {
  return (
    // Under lg it sits 80px up (plus the home-indicator inset) so it clears
    // the bottom tab bar (P3) and the floating add button.
    <div
      className="fixed z-50 left-4 right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:left-auto lg:right-6 lg:bottom-6 lg:max-w-sm flex items-center gap-3 rounded-lg border border-border-strong bg-surface py-2.5 pl-4 pr-2 animate-in-up"
    >
      <p className="flex-1 min-w-0 text-sm text-foreground">{UPDATE_MESSAGE}</p>
      <button type="button" onClick={onReload} disabled={reloading} className="btn-primary h-11 lg:h-9 flex-shrink-0">
        Reload
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="btn-icon flex-shrink-0">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

async function removeServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("forma-")).map((n) => caches.delete(n)));
    }
  } catch {
    // Nothing to clean up, or storage blocked.
  }
}
