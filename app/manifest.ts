import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME, THEME_COLOR } from "@/lib/pwa/brand";

// Served at /manifest.webmanifest (docs/mobile-pwa/SPEC.md, P1 and decision 8).
// Icons are generated from app/favicon.svg by scripts/generate-icons.mjs.
// Shortcuts (P6) show on a long press of the installed app's icon; Quick add
// opens the command palette in add mode (CommandPalette reads `capture=1`).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: THEME_COLOR,
    background_color: THEME_COLOR,
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Today", url: "/today", icons: [shortcutIcon("today")] },
      { name: "Quick add", short_name: "Add", description: "Add a task", url: "/today?capture=1", icons: [shortcutIcon("add")] },
      { name: "Calendar", url: "/calendar", icons: [shortcutIcon("calendar")] },
    ],
  };
}

/** A 96x96 shortcut icon from scripts/generate-icons.mjs. */
function shortcutIcon(name: string) {
  return { src: `/icons/shortcut-${name}.png`, sizes: "96x96", type: "image/png", purpose: "any" as const };
}
