import type { Abcde } from "@/types";
import { ABCDE_META, formatAbcde } from "@/lib/frog/abcde";

// Frog green: the "eaten" colour, not a theme token (the app has no success token).
export const FROG = "#34D399";

// The brand purple. Not `var(--accent)`: globals.css redefines that token to the
// neutral `--elevated` surface colour for shadcn-style components.
export const ACCENT = "#7C6EF8";

/** "A-1" / "B" pill in the letter's colour; renders nothing without a letter. */
export function AbcdeBadge({ abcde, abcdeRank }: { abcde?: Abcde | null; abcdeRank?: number | null }) {
  if (!abcde) return null;
  const color = ABCDE_META[abcde].color;
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 h-5 text-[10px] font-bold flex-shrink-0"
      style={{ color, background: `${color}1F`, border: `1px solid ${color}55`, letterSpacing: "0.04em" }}
      title={`${ABCDE_META[abcde].label}: ${ABCDE_META[abcde].description}`}
    >
      {formatAbcde({ abcde, abcdeRank })}
    </span>
  );
}

/** The project's colour dot and name. `min-w-0` + truncate keep it inside a 375px screen. */
export function ProjectChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 h-5 text-[10px] font-medium min-w-0 max-w-full"
      style={{ color: "var(--text-secondary)", background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)" }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A small neutral tag such as "Delegate" or "Done". */
export function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 h-5 text-[10px] font-semibold flex-shrink-0"
      style={{ color, background: `${color}1F`, border: `1px solid ${color}44` }}
    >
      {children}
    </span>
  );
}
