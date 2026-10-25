"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import AddMode from "./AddMode";
import SearchMode from "./SearchMode";
import { fetchProjects, type PaletteProject } from "./api";

export type PaletteMode = "add" | "search";

export const OPEN_PALETTE_EVENT = "open-command-palette";

/** `?capture=1` (the manifest's Quick add shortcut, `/today?capture=1`) opens the palette in add mode. */
export const CAPTURE_PARAM = "capture";

/** Opens the palette from anywhere (the sidebar rows and the bottom tab bar's Add use this). */
export function openCommandPalette(mode: PaletteMode, text = "") {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: { mode, text } }));
}

function hasCaptureParam(href: string): boolean {
  return new URL(href).searchParams.get(CAPTURE_PARAM) === "1";
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PaletteMode>("search");
  const [seed, setSeed] = useState("");
  const [projects, setProjects] = useState<PaletteProject[]>([]);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const show = useCallback((next: PaletteMode, text = "") => {
    if (!openerRef.current) openerRef.current = document.activeElement as HTMLElement | null;
    setMode(next);
    setSeed(text);
    setOpen(true);
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus?.();
    openerRef.current = null;
  }, []);

  // Quick add (app/manifest.ts shortcuts): open in add mode and drop the param,
  // so a reload or a shared link doesn't open it again. history.replaceState
  // keeps the other params and, unlike router.replace, refetches nothing and
  // cancels nothing in flight. Both happen a tick later: on the first load this
  // effect runs before the app router's own effect hooks replaceState up to the
  // router (child effects run first), and only that hooked version updates
  // usePathname/useSearchParams and keeps Next's history state.
  const pathname = usePathname();
  useEffect(() => {
    if (!hasCaptureParam(window.location.href)) return;
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      if (!hasCaptureParam(url.href)) return;
      url.searchParams.delete(CAPTURE_PARAM);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      show("add");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname, show]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show("search");
      } else if (!open && e.key.toLowerCase() === "q" && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target)) {
        e.preventDefault();
        show("add");
      }
    }
    function onOpen(e: Event) {
      const d = (e as CustomEvent<{ mode: PaletteMode; text?: string }>).detail;
      show(d?.mode ?? "search", d?.text ?? "");
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [open, show, close]);

  function onDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const target = e.target as HTMLElement;
    // Tab in the text box flips between Add and Search.
    if (target.hasAttribute("data-palette-input")) {
      e.preventDefault();
      setSeed("");
      setMode((m) => (m === "add" ? "search" : "add"));
      return;
    }
    // Anywhere else, keep focus inside the dialog.
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && target === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && target === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <>
      {/* Under lg the bottom tab bar's Add replaces this button (components/mobile/BottomTabBar).
          It was meant to be lg:hidden, but .btn-primary's display beats that utility, so
          desktop has always shown it; it stays on desktop unchanged. !hidden wins over
          .btn-primary's display under lg. */}
      <button
        type="button"
        onClick={() => show("add")}
        aria-label="Add task"
        className="btn-primary max-lg:!hidden fixed bottom-5 right-5 z-30 !w-12 !h-12 !p-0 !rounded-lg"
      >
        <Plus className="w-5 h-5" aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center sm:pt-[15vh]">
          <div className="absolute inset-0 bg-background/70" onClick={close} aria-hidden="true" />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={mode === "add" ? "Add task" : "Search"}
            onKeyDown={onDialogKeyDown}
            className="relative flex flex-col w-full max-sm:pt-safe max-sm:border-x-0 max-sm:border-t-0 sm:max-h-[70vh] sm:max-w-[640px] bg-surface border border-border-strong sm:rounded-lg animate-fade-in overflow-hidden"
          >
            <div className="flex items-center gap-1 px-4 pt-3" role="group" aria-label="Palette mode">
              {/* Under lg each button is a 44px tall hit area (negative margins keep the
                  row's height) around the same 28px pill, which carries the focus ring there. */}
              {(["add", "search"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => { setSeed(""); setMode(m); }}
                  className="group/mode rounded-md text-sm font-medium max-lg:h-11 max-lg:-my-2 max-lg:focus-visible:outline-none"
                >
                  <span className={`block rounded-md px-2.5 py-1 transition-colors max-lg:group-focus-visible/mode:outline-2 max-lg:group-focus-visible/mode:outline-offset-2 max-lg:group-focus-visible/mode:outline-ring ${mode === m ? "bg-primary-soft text-foreground" : "text-muted-foreground group-hover/mode:text-foreground"}`}>
                    {m === "add" ? "Add task" : "Search"}
                  </span>
                </button>
              ))}
              <span className="ml-auto text-xs text-subtle hidden sm:inline">Tab to switch · Esc to close</span>
              <button type="button" onClick={close} className="btn-ghost sm:hidden ml-auto">Close</button>
            </div>
            {mode === "add" ? (
              <AddMode key={`add-${seed}`} projects={projects} seed={seed} onClose={close} />
            ) : (
              <SearchMode
                projects={projects}
                onClose={close}
                onAddAsTask={(text) => { setSeed(text); setMode("add"); }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
