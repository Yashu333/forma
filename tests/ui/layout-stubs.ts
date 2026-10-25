// Layout stubs for the popover-fitting tests (lib/fit-in-viewport.ts). jsdom has
// no layout: every getBoundingClientRect() is all zeros and clientWidth is 0.
// These give chosen elements a horizontal position that follows their inline
// CSS `translate`, like a browser would, and set the viewport width.
import { vi } from "vitest";
import { UNDER_LG_QUERY } from "@/lib/use-media-query";
import { stubMatchMedia } from "./pwa-stubs";

/** The media query for "under lg" (lib/use-media-query.ts), used by the drawer, the calendar and lib/fit-in-viewport.ts. */
export const UNDER_LG = UNDER_LG_QUERY;

/** Puts the page under lg (a phone) or at lg and up (desktop). Restore with restoreBrowserStubs(). */
export function stubBreakpoint(underLg: boolean) {
  return stubMatchMedia(underLg ? [UNDER_LG] : []);
}

/** Sets the layout viewport width (document.documentElement.clientWidth and innerWidth). */
export function stubViewportWidth(width: number) {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(width);
}

function translateX(el: HTMLElement): number {
  const m = /^\s*(-?\d+(?:\.\d+)?)px/.exec(el.style.translate || "");
  return m ? Number(m[1]) : 0;
}

/**
 * Elements matching `selector` report a box `width` wide whose untranslated
 * left edge is `left`; every other element keeps jsdom's zero box. The spy is
 * returned, so a test can see whether anything was measured. `restoreAllMocks`
 * (tests/ui/setup.ts) undoes it.
 */
export function stubBox(selector: string, box: { left: number; width: number; top?: number; height?: number }) {
  const real = HTMLElement.prototype.getBoundingClientRect;
  const state = { ...box };
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.matches(selector)) return real.call(this);
    const left = state.left + translateX(this);
    const top = state.top ?? 40;
    const height = state.height ?? 200;
    return {
      left, right: left + state.width, x: left, width: state.width,
      top, bottom: top + height, y: top, height,
      toJSON() { return this; },
    } as DOMRect;
  });
  return {
    spy,
    /** Moves the box (its untranslated left edge) for the next measurement. */
    moveTo(left: number) {
      state.left = left;
    },
  };
}
