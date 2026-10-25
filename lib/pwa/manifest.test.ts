import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { APP_DESCRIPTION, THEME_COLOR } from "@/lib/pwa/brand";

const root = path.resolve(__dirname, "../..");
const publicFile = (src: string) => path.join(root, "public", src.replace(/^\//, ""));

describe("web app manifest (app/manifest.ts)", () => {
  const m = manifest();

  it("has the fields an installable app needs, per the spec's decision 8", () => {
    expect(m).toMatchObject({
      id: "/",
      name: "Forma",
      short_name: "Forma",
      description: APP_DESCRIPTION,
      start_url: "/today",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      theme_color: "#1D1B19",
      background_color: "#1D1B19",
      categories: ["productivity"],
    });
  });

  it("uses the background token's value for the theme colour", () => {
    const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
    const token = css.match(/--background:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];
    expect(token?.toUpperCase()).toBe(THEME_COLOR.toUpperCase());
  });

  it("lists 192 and 512 'any' icons and a 512 maskable icon", () => {
    const icons = (m.icons ?? []).map(({ src, sizes, purpose }) => ({ src, sizes, purpose }));
    expect(icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", purpose: "maskable" },
    ]);
  });

  it.each((m.icons ?? []).map((icon) => [icon.src, icon] as const))(
    "%s exists in public/ as a PNG of the stated size",
    async (_src, icon) => {
      const file = publicFile(icon.src);
      expect(fs.existsSync(file)).toBe(true);
      const meta = await sharp(file).metadata();
      expect(icon.type).toBe("image/png");
      expect(meta.format).toBe("png");
      expect(`${meta.width}x${meta.height}`).toBe(icon.sizes);
    },
  );

  it("has Today, Quick add and Calendar shortcuts, each with a 96x96 icon", () => {
    expect(
      (m.shortcuts ?? []).map(({ name, url, icons }) => ({
        name,
        url,
        icons: icons?.map(({ src, sizes, type }) => ({ src, sizes, type })),
      })),
    ).toEqual([
      { name: "Today", url: "/today", icons: [{ src: "/icons/shortcut-today.png", sizes: "96x96", type: "image/png" }] },
      { name: "Quick add", url: "/today?capture=1", icons: [{ src: "/icons/shortcut-add.png", sizes: "96x96", type: "image/png" }] },
      { name: "Calendar", url: "/calendar", icons: [{ src: "/icons/shortcut-calendar.png", sizes: "96x96", type: "image/png" }] },
    ]);
  });

  it("keeps every shortcut inside the app's scope", () => {
    for (const { url } of m.shortcuts ?? []) expect(url.startsWith(m.scope ?? "/")).toBe(true);
  });

  it.each((m.shortcuts ?? []).flatMap((s) => s.icons ?? []).map((icon) => [icon.src, icon] as const))(
    "shortcut icon %s exists in public/ as a PNG of the stated size",
    async (_src, icon) => {
      const file = publicFile(icon.src);
      expect(fs.existsSync(file)).toBe(true);
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe("png");
      expect(`${meta.width}x${meta.height}`).toBe(icon.sizes);
    },
  );

  it("makes the maskable icon full-bleed (no transparency)", async () => {
    const meta = await sharp(publicFile("/icons/maskable-512.png")).metadata();
    expect(meta.hasAlpha).toBe(false);
  });

  it("ships a 180x180 apple-touch icon with no transparency", async () => {
    const meta = await sharp(publicFile("/icons/apple-touch-icon.png")).metadata();
    expect(meta).toMatchObject({ format: "png", width: 180, height: 180, hasAlpha: false });
  });
});
