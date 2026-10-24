@AGENTS.md

# Design system: Ember

Dark only. Warm charcoal neutrals plus one signal orange. Based on `~/.claude/brand/EMBER.md` (the guide now uses the same charcoal ladder and outline rule).

| Token | Hex | Use |
|---|---|---|
| `background` / `surface` / `raised` | `#1D1B19` / `#272422` / `#322F2C` | page / cards on the page and panels / cards inside panels, hover fills |
| `border` / `border-strong` / `input` | `#46423D` / `#5F5952` / `#857D75` | every outline at rest / hover edge, floating panels, text fields at rest / checkboxes, switches, text-field hover |
| `foreground` / `muted-foreground` / `subtle` / `faint` | `#F5F0EB` / `#B8AFA7` / `#A1988F` / `#857D75` | text (faint is large or disabled only) |
| `primary` / `primary-hover` / `primary-soft` / `primary-foreground` | `#F2711C` / `#FF8540` / `#3B2C21` / `#170B03` | accent, hover, selected fill, text on orange |
| `success` / `danger` | `#7DBB8A` / `#EE6A62` | done / errors and destructive |

Rules:
- Tokens live in `app/globals.css` only. Use token classes (`bg-surface`, `text-subtle`) or `var(--token)`, never raw hex.
- Orange has four jobs: the primary action (one per view), in-progress or active state, progress, focus and selection. Never white text on orange.
- Form fields use the `input` outline (`.forma-input`). Buttons: `.btn-primary`, `.btn-secondary`, `.btn-ghost`.
- Layering: a card on the page is `surface`; a card inside a column is `raised`; the column itself is a `surface` panel with no outline.
- One outline rule everywhere: cards, panels, buttons, chips and toggles are `border` at rest and `border-strong` on hover. Menus, dialogs, tooltips and dashed placeholders use `border-strong`. Text fields (`.forma-input`) are `border-strong` at rest, `input` on hover, `primary` on focus. Only checkboxes and switches use `input` at rest. Pickers and pills show neutral text with a coloured dot; chips on cards show tinted text with no dot. Never mix outline weights on one screen.
- Cards mark priority, project, A to E label or frog state with a 3px coloured left border on the card itself (`borderLeft`), which follows the rounded corner. Chips show the label text only, no dot.
- Fonts: Instrument Sans for UI, JetBrains Mono only for numeric tags, times and code.
- Banned: gradients, glows, emoji, Sparkles icons, uppercase tracked labels, `rounded-2xl`, cards in cards, hover scale. Copy is sentence case with no exclamation marks.
- **Data colours are the exception** and stay as stored: board status columns, task priority colours, A–E label colours, project colours, and the Spotify and Google brand marks. They carry meaning.
