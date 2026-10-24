"use client";

import { ACCENT } from "./bits";

interface Props {
  checked: boolean;
  onToggle: () => void;
  /** Why the last save failed (the switch has already rolled back), if it did. */
  error?: string | null;
}

/**
 * The frog-first switch. A real button with role="switch" (Space/Enter toggle
 * it natively); the whole label is inside the button so the hit area is the full
 * row, and it wraps instead of overflowing at 375px.
 */
export default function FrogFirstToggle({ checked, onToggle, error }: Props) {
  return (
    <div className="mb-5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className="flex items-center gap-3 text-left w-full sm:w-auto max-w-full rounded-xl px-3 py-2 min-h-11"
        style={{ background: "var(--card)", border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}
      >
        <span
          aria-hidden="true"
          className="relative flex-shrink-0 rounded-full transition-colors duration-150"
          style={{ width: 36, height: 20, background: checked ? ACCENT : "rgba(255,255,255,0.18)" }}
        >
          <span
            className="absolute top-0.5 rounded-full bg-white transition-all duration-150"
            style={{ width: 16, height: 16, left: checked ? 18 : 2 }}
          />
        </span>
        <span className="text-xs min-w-0 break-words">Frog first: dim other tasks until the frog is eaten</span>
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs rounded-lg px-3 py-2 break-words" style={{ color: "#F87171", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.30)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
