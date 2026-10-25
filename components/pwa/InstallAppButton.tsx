"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { isIosSafari, isStandalone } from "@/lib/pwa/install";

// The quiet "Install app" row in the sidebar footer (docs/mobile-pwa/SPEC.md,
// decision 7). Shown only when the browser offered `beforeinstallprompt`, or
// on iOS Safari (which never does) where it opens a short how-to dialog.
// Never shown when the app already runs installed. No pop-up banners.

/** Chromium's install prompt event (not in the TypeScript DOM lib). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type InstallMode = "none" | "prompt" | "ios";

const STANDALONE_QUERY = "(display-mode: standalone)";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

// Listen from module load, not from an effect: the browser can fire
// `beforeinstallprompt` before React hydrates the sidebar, and only once.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's own mini-infobar away; the row offers it
    deferredPrompt = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });
}

function standaloneQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(STANDALONE_QUERY) : null;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mq = standaloneQuery();
  mq?.addEventListener?.("change", onChange);
  return () => {
    listeners.delete(onChange);
    mq?.removeEventListener?.("change", onChange);
  };
}

function getMode(): InstallMode {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (installed || isStandalone(nav.standalone, standaloneQuery()?.matches ?? false)) return "none";
  if (deferredPrompt) return "prompt";
  if (isIosSafari(nav.userAgent, nav.maxTouchPoints ?? 0)) return "ios";
  return "none";
}

// Server render and hydration: nothing, so the markup always matches.
const getServerMode = (): InstallMode => "none";

export default function InstallAppButton() {
  const mode = useSyncExternalStore(subscribe, getMode, getServerMode);
  const [iosOpen, setIosOpen] = useState(false);

  if (mode === "none") return null;

  async function onClick() {
    if (mode === "ios") {
      setIosOpen(true);
      return;
    }
    const evt = deferredPrompt;
    if (!evt) return;
    try {
      await evt.prompt();
      await evt.userChoice;
    } catch {
      // The prompt can only be shown once per event; nothing else to do.
    } finally {
      // Spent either way. If the user said no, Chrome offers a fresh event later.
      if (deferredPrompt === evt) {
        deferredPrompt = null;
        emit();
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-haspopup={mode === "ios" ? "dialog" : undefined}
        className="w-full mb-1 flex items-center gap-2.5 px-2.5 py-1.5 max-lg:min-h-11 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-raised hover:text-foreground"
      >
        <Download className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        Install app
      </button>
      {iosOpen && <IosInstallDialog onClose={() => setIosOpen(false)} />}
    </>
  );
}

const FOCUSABLE = "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

function IosInstallDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  // Focus moves in on open and back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    doneRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // Portalled to <body>: the drawer it opens from is transformed, which would
  // otherwise trap `position: fixed` inside it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        className="w-80 max-w-full rounded-lg border border-border-strong bg-surface p-5 flex flex-col gap-4 animate-in-up"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-foreground">Install Forma</h2>
            <p id={descId} className="text-xs leading-relaxed text-muted-foreground">
              Add Forma to your home screen and it opens full screen, like an app.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-icon -mt-1 -mr-1 flex-shrink-0">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <ol className="flex flex-col gap-3 text-sm text-foreground">
          <li className="flex items-center gap-3">
            <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md border border-border bg-raised text-foreground">
              <Share className="w-4 h-4" aria-hidden="true" />
            </span>
            <span>Tap <span className="font-semibold">Share</span> in Safari&apos;s toolbar.</span>
          </li>
          <li className="flex items-center gap-3">
            <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md border border-border bg-raised text-foreground">
              <SquarePlus className="w-4 h-4" aria-hidden="true" />
            </span>
            <span>Choose <span className="font-semibold">Add to Home Screen</span>.</span>
          </li>
        </ol>

        <div className="flex justify-end">
          <button ref={doneRef} type="button" onClick={onClose} className="btn-secondary h-11 lg:h-8">
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
