import type { Abcde } from "@/types";
import { ABCDE_META, formatAbcde } from "@/lib/frog/abcde";

// "Eaten" / done state uses the Ember success token.
export const FROG = "var(--success)";

// The brand accent: selection, in-progress and the primary action.
export const ACCENT = "var(--primary)";

/** The frog (hardest task of the day) glyph: a line-drawn frog face in frog green, so it needs no emoji. */
export function FrogIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke={FROG}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.5" cy="7" r="3" />
      <circle cx="16.5" cy="7" r="3" />
      <circle cx="7.5" cy="7" r="0.6" fill={FROG} />
      <circle cx="16.5" cy="7" r="0.6" fill={FROG} />
      <path d="M5 9.5c-1.5 1.5-2 4.5-1 7 1 2.5 4.2 4 8 4s7-1.5 8-4c1-2.5.5-5.5-1-7" />
      <path d="M8 15.5c2.7 1.8 5.3 1.8 8 0" />
    </svg>
  );
}

/** "A-1" / "B" pill in the letter's colour; renders nothing without a letter. */
export function AbcdeBadge({ abcde, abcdeRank }: { abcde?: Abcde | null; abcdeRank?: number | null }) {
  if (!abcde) return null;
  const color = ABCDE_META[abcde].color;
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 h-5 text-[11px] font-semibold flex-shrink-0 font-mono"
      style={{ color, background: `${color}1F`, border: `1px solid ${color}55` }}
      title={`${ABCDE_META[abcde].label}: ${ABCDE_META[abcde].description}`}
    >
      {formatAbcde({ abcde, abcdeRank })}
    </span>
  );
}

/** The project's colour dot and name. `min-w-0` + truncate keep it inside a 375px screen. */
export function ProjectChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 h-5 text-[11px] font-medium text-muted-foreground min-w-0 max-w-full">
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A small tag such as "Delegate" or "Done", in the colour it is given. */
export function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 h-5 text-[11px] font-semibold flex-shrink-0"
      style={{ color, background: `${color}1F`, border: `1px solid ${color}44` }}
    >
      {children}
    </span>
  );
}
