import { describe, expect, it, vi } from "vitest";
import { APP_DESCRIPTION, THEME_COLOR } from "@/lib/pwa/brand";

// next/font/google only works inside Next's compiler; the layout's exports
// don't depend on it.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "", className: "", style: {} });
  return { Instrument_Sans: font, JetBrains_Mono: font };
});

const { metadata, viewport } = await import("@/app/layout");

// app/layout.tsx metadata and viewport (docs/mobile-pwa/SPEC.md, P1).
describe("root layout metadata", () => {
  it("links the web app manifest", () => {
    expect(metadata.manifest).toBe("/manifest.webmanifest");
  });

  it("keeps the description in step with the manifest", () => {
    expect(metadata.description).toBe(APP_DESCRIPTION);
  });

  it("opens full screen from the iOS home screen, titled Forma, with a translucent status bar", () => {
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      title: "Forma",
      statusBarStyle: "black-translucent",
    });
  });

  it("points iOS at the 180x180 apple-touch icon", () => {
    const icons = metadata.icons as { apple?: unknown };
    expect(icons.apple).toEqual([
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ]);
  });

  it("keeps the existing favicons", () => {
    const icons = metadata.icons as { icon?: { url: string }[] };
    expect(icons.icon?.map((i) => i.url)).toEqual(["/favicon.svg", "/favicon.ico"]);
  });

  it("turns off phone-number detection", () => {
    expect(metadata.formatDetection).toEqual({ telephone: false });
  });
});

describe("root layout viewport", () => {
  it("keeps the theme colour and dark colour scheme", () => {
    expect(viewport.themeColor).toBe(THEME_COLOR);
    expect(viewport.colorScheme).toBe("dark");
  });

  it("draws under the notch (viewport-fit=cover)", () => {
    expect(viewport.viewportFit).toBe("cover");
  });

  it("doesn't disable pinch zoom", () => {
    expect(viewport).not.toHaveProperty("maximumScale");
    expect(viewport).not.toHaveProperty("minimumScale");
    expect(viewport.userScalable).not.toBe(false);
  });
});
