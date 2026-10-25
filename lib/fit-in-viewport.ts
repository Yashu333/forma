import { useLayoutEffect, type RefObject } from "react";

// Keeps a popover (a menu or picker positioned `absolute` under its trigger)
// inside the screen on phones and tablets (docs/mobile-pwa/SPEC.md, P4). A menu
// that opens under a pill near the right edge would otherwise stick out past
// it. Desktop (lg and up) is left exactly as it was.

/** Default gutter between a popover and the screen edge, in CSS px. */
export const VIEWPORT_GUTTER = 16;

/** Under `lg` (Tailwind's 64rem): where popovers are pulled back on screen. */
export const FIT_MEDIA = "(width < 64rem)";

/**
 * How far to move a box horizontally (px, negative = left) so that it sits
 * inside [gutter, viewportWidth - gutter]. A box wider than that space is
 * lined up with the left gutter (its own max-width should stop that). Returns
 * 0 when it already fits.
 */
export function horizontalShift(
  box: { left: number; right: number },
  viewportWidth: number,
  gutter: number = VIEWPORT_GUTTER,
): number {
  const min = gutter;
  const max = viewportWidth - gutter;
  if (box.right - box.left >= max - min) return min - box.left;
  if (box.right > max) return max - box.right;
  if (box.left < min) return min - box.left;
  return 0;
}

/**
 * While `open`, nudges the element in `ref` sideways (with the CSS `translate`
 * property, so it composes with any `transform` animation) until it fits the
 * viewport. Only under `lg`: at `lg` and up any earlier shift is cleared and
 * the element is otherwise left alone. The shift is measured from the
 * untranslated position each time, again on resize while open, and cleared on
 * close (a popover that stays mounted carries no old shift).
 */
export function useFitInViewport(ref: RefObject<HTMLElement | null>, open: boolean, gutter: number = VIEWPORT_GUTTER) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el || typeof window === "undefined") return;

    function fit() {
      if (!el) return;
      el.style.translate = "";
      if (typeof window.matchMedia !== "function" || !window.matchMedia(FIT_MEDIA).matches) return;
      const r = el.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth;
      const dx = horizontalShift({ left: r.left, right: r.right }, width, gutter);
      if (dx !== 0) el.style.translate = `${Math.round(dx)}px 0`;
    }

    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      el.style.translate = "";
    };
  }, [ref, open, gutter]);
}
