"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import AddMode from "./AddMode";
import SearchMode from "./SearchMode";
import { fetchProjects, type PaletteProject } from "./api";

export type PaletteMode = "add" | "search";

export const OPEN_PALETTE_EVENT = "open-command-palette";

/** Opens the palette from anywhere (the sidebar rows and the bottom tab bar's Add use this). */
export function openCommandPalette(mode: PaletteMode, text = "") {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: { mode, text } }));
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
              {(["add", "search"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => { setSeed(""); setMode(m); }}
                  className={`rounded-md px-2.5 py-1 text-sm font-medium transition-colors ${mode === m ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "add" ? "Add task" : "Search"}
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
