"use client";

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
        className="flex items-center gap-3 text-left w-full sm:w-auto max-w-full rounded-lg border border-border bg-surface px-3 py-2 min-h-11 text-muted-foreground transition-colors hover:bg-raised hover:border-border-strong"
      >
        <span
          aria-hidden="true"
          className={`relative flex-shrink-0 rounded-full border transition-colors duration-150 w-9 h-5 ${
            checked ? "bg-primary border-primary" : "bg-raised border-input"
          }`}
        >
          <span
            className={`absolute top-[2px] w-3.5 h-3.5 rounded-full transition-all duration-150 ${
              checked ? "left-[18px] bg-primary-foreground" : "left-[2px] bg-muted-foreground"
            }`}
          />
        </span>
        <span className="text-xs min-w-0 break-words">Frog first: dim other tasks until the frog is eaten</span>
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs rounded-md px-3 py-2 break-words border border-border bg-surface text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
