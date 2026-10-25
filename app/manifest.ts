import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME, THEME_COLOR } from "@/lib/pwa/brand";

// Served at /manifest.webmanifest (docs/mobile-pwa/SPEC.md, P1 and decision 8).
// Icons are generated from app/favicon.svg by scripts/generate-icons.mjs.
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
  };
}
