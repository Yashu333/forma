import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The PWA icons in public/icons/ (docs/mobile-pwa/SPEC.md, P1): what they look
// like, and that they're still what scripts/generate-icons.mjs makes from
// app/favicon.svg. manifest.test.ts covers file existence, sizes and alpha.

const root = path.resolve(__dirname, "../..");
const ICONS = ["icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png"];
const ORANGE = [0xf2, 0x71, 0x1c]; // favicon <rect> fill
const DARK = [0x17, 0x0b, 0x03]; // favicon F stroke

type Raw = { data: Buffer; width: number; height: number; channels: number };

async function raw(file: string): Promise<Raw> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function pixel(img: Raw, x: number, y: number) {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

const near = (rgb: number[], target: number[], tol = 2) =>
  target.every((v, i) => Math.abs(rgb[i] - v) <= tol);

const icon = (file: string) => path.join(root, "public/icons", file);

describe("PWA icons stay in sync with app/favicon.svg", () => {
  let tmp: string;

  beforeAll(() => {
    // Run the real generator against a copy of the repo layout it expects
    // (<root>/scripts, <root>/app/favicon.svg, <root>/public/icons), so it
    // never writes into the working tree.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forma-icons-"));
    fs.mkdirSync(path.join(tmp, "scripts"));
    fs.mkdirSync(path.join(tmp, "app"));
    fs.copyFileSync(path.join(root, "scripts/generate-icons.mjs"), path.join(tmp, "scripts/generate-icons.mjs"));
    fs.copyFileSync(path.join(root, "app/favicon.svg"), path.join(tmp, "app/favicon.svg"));
    fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"), "dir");
    execFileSync(process.execPath, [path.join(tmp, "scripts/generate-icons.mjs")], { stdio: "pipe" });
  }, 30_000);

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it.each(ICONS)("re-generating %s gives the committed pixels", async (file) => {
    const fresh = await raw(path.join(tmp, "public/icons", file));
    const committed = await raw(icon(file));
    expect({ width: committed.width, height: committed.height }).toEqual({
      width: fresh.width,
      height: fresh.height,
    });
    expect(committed.data.equals(fresh.data)).toBe(true);
  });
});

describe("PWA icon artwork", () => {
  it.each(ICONS)("%s shows the dark F on the orange square", async (file) => {
    const img = await raw(icon(file));
    let orange = 0;
    let dark = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const p = pixel(img, x, y);
        if (p[3] < 255) continue;
        if (near(p, ORANGE)) orange++;
        else if (near(p, DARK)) dark++;
      }
    }
    const total = img.width * img.height;
    expect(orange / total).toBeGreaterThan(0.5);
    expect(dark / total).toBeGreaterThan(0.03);
  });

  it("keeps the maskable icon's F inside the central 80% safe zone", async () => {
    // Maskable safe zone: a circle centred on the icon with radius 40% of its
    // width. Anything outside it may be cropped, so it must be plain background.
    const img = await raw(icon("maskable-512.png"));
    const c = img.width / 2;
    const r = img.width * 0.4;
    const offenders: string[] = [];
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (Math.hypot(x + 0.5 - c, y + 0.5 - c) <= r) continue;
        const p = pixel(img, x, y);
        if (!(p[3] === 255 && near(p, ORANGE))) offenders.push(`(${x},${y})=${p.join(",")}`);
      }
    }
    expect(offenders.slice(0, 5)).toEqual([]);
  });

  it.each(["maskable-512.png", "apple-touch-icon.png"])(
    "%s is full-bleed: opaque orange right into the corners",
    async (file) => {
      const img = await raw(icon(file));
      const last = img.width - 1;
      for (const [x, y] of [[0, 0], [last, 0], [0, last], [last, last]]) {
        const p = pixel(img, x, y);
        expect(p[3]).toBe(255);
        expect(near(p, ORANGE)).toBe(true);
      }
    },
  );
});
