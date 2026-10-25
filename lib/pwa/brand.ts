// Shared by app/layout.tsx (metadata, viewport) and app/manifest.ts.

export const APP_NAME = "Forma";

export const APP_DESCRIPTION =
  "Kanban boards and a daily plan that starts with your hardest task.";

// The `background` token (`--background` in app/globals.css). The web app
// manifest and the theme-color meta can't read CSS variables, so this is the
// one place a raw hex is allowed. lib/pwa/manifest.test.ts checks it still
// matches the token.
export const THEME_COLOR = "#1D1B19";
