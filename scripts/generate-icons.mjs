#!/usr/bin/env node
// Generates the PWA icons in public/icons/ from app/favicon.svg
// (docs/mobile-pwa/SPEC.md, P1). Run after changing the favicon:
//
//   node scripts/generate-icons.mjs
//
// The favicon is the single source: its <rect> fill is the background and its
// <path> is the F. Outputs (all PNG, committed):
//   icon-192.png, icon-512.png  purpose "any": the favicon as drawn (rounded
//                               square, transparent corners)
//   maskable-512.png            purpose "maskable": full-bleed background with
//                               the F at full size; it already sits inside the
//                               central 80% safe zone (about 30% from centre)
//   apple-touch-icon.png        180x180, full-bleed, no transparency, square
//                               corners (iOS rounds them itself)
//   shortcut-*.png              96x96 manifest shortcut icons (P6): the
//                               favicon's rounded square with the matching
//                               lucide glyph (the bottom tab bar's) in the F's
//                               colour instead of the F
//
// The shortcut glyphs come from lucide-react's `__iconNode` exports, which are
// lucide-internal (not public API): a lucide upgrade may rename or drop them.
// If an import breaks, pin the shapes here (copy the [tag, attrs] arrays from
// the old version) so the icons stay as committed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
// The tab bar's icons (components/mobile/BottomTabBar.tsx), as lucide-react
// ships them: [tag, attributes] pairs drawn on a 24x24 grid.
import { __iconNode as sunNode } from "lucide-react/dist/esm/icons/sun.mjs";
import { __iconNode as plusNode } from "lucide-react/dist/esm/icons/plus.mjs";
import { __iconNode as calendarDaysNode } from "lucide-react/dist/esm/icons/calendar-days.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "app/favicon.svg");
const outDir = path.join(root, "public/icons");

const favicon = fs.readFileSync(source, "utf8");

const viewBox = favicon.match(/viewBox="([^"]+)"/)?.[1];
const rectFill = favicon.match(/<rect\b[^>]*\bfill="([^"]+)"/)?.[1];
const rect = favicon.match(/<rect\b[^>]*\/>/)?.[0];
const glyph = favicon.match(/<path\b[^>]*\/>/)?.[0];
const glyphStroke = glyph?.match(/\bstroke="([^"]+)"/)?.[1];
if (!viewBox || !rectFill || !rect || !glyph || !glyphStroke) {
  throw new Error(`Couldn't read the viewBox, <rect> and <path> (with its stroke) from ${source}`);
}
const [, , vbWidth, vbHeight] = viewBox.split(/\s+/).map(Number);
if (vbWidth !== vbHeight) throw new Error(`${source} must be square (viewBox ${viewBox})`);
const centre = vbWidth / 2;

/** Sets the rendered pixel size on the SVG root so sharp rasterises it sharply. */
function sized(svg, size) {
  return svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
}

/** Full-bleed background with the F scaled around the centre. */
function fullBleed(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <rect width="${vbWidth}" height="${vbHeight}" fill="${rectFill}"/>
  <g transform="translate(${centre} ${centre}) scale(${scale}) translate(${-centre} ${-centre})">${glyph}</g>
</svg>`;
}

/**
 * The favicon's rounded square with a lucide glyph in place of the F. The 24
 * unit lucide grid is scaled to 20 favicon units and centred, so the glyph
 * (drawn inside 2..22) is about as big as the F; the stroke is a little
 * heavier than lucide's 2 so it reads at 96px.
 */
function withLucide(iconNode) {
  const scale = 20 / 24;
  const offset = (vbWidth - 24 * scale) / 2;
  const shapes = iconNode
    .map(([tag, attrs]) => {
      const list = Object.entries(attrs)
        .filter(([name]) => name !== "key")
        .map(([name, value]) => `${name}="${value}"`)
        .join(" ");
      return `<${tag} ${list}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  ${rect}
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${glyphStroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>
</svg>`;
}

const icons = [
  { file: "icon-192.png", size: 192, svg: favicon, opaque: false },
  { file: "icon-512.png", size: 512, svg: favicon, opaque: false },
  { file: "maskable-512.png", size: 512, svg: fullBleed(1), opaque: true },
  { file: "apple-touch-icon.png", size: 180, svg: fullBleed(1), opaque: true },
  // Manifest shortcuts (app/manifest.ts): Today, Quick add, Calendar.
  { file: "shortcut-today.png", size: 96, svg: withLucide(sunNode), opaque: false },
  { file: "shortcut-add.png", size: 96, svg: withLucide(plusNode), opaque: false },
  { file: "shortcut-calendar.png", size: 96, svg: withLucide(calendarDaysNode), opaque: false },
];

fs.mkdirSync(outDir, { recursive: true });

for (const { file, size, svg, opaque } of icons) {
  let image = sharp(Buffer.from(sized(svg, size))).resize(size, size);
  // Opaque icons drop the alpha channel entirely (iOS shows transparency as black).
  if (opaque) image = image.flatten({ background: rectFill }).removeAlpha();
  const out = path.join(outDir, file);
  await image.png({ compressionLevel: 9 }).toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`${path.relative(root, out)}  ${meta.width}x${meta.height}  alpha=${meta.hasAlpha}`);
}
