#!/usr/bin/env node
/**
 * Source images for the app icon and launch screen, drawn from the same Stinky
 * head as the web icons (frontend/scripts/generate-icons.mjs):
 *
 *   node scripts/source-assets.mjs && npm run assets
 *
 * writes assets/ (icon-only, icon-foreground, icon-background, splash, splash-dark),
 * which `capacitor-assets generate` then cuts into every Android and iOS size.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets');
const HEAD_SVG = path.join(ROOT, '../frontend/public/brand/stinky/head/stinky-head.svg');

const PINK = '#FF7EB6';
const LIGHT_BG = '#FFFFFF';
const DARK_BG = '#0F0F0F';
const VB = 420; // the head's viewBox is 0 0 420 420

const raw = await readFile(HEAD_SVG, 'utf8');
const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

// Tight bounding box of the head, so "fill" means the head itself, not its padding.
const probe = 1024;
const { data, info } = await sharp(Buffer.from(raw), { density: (72 * probe) / 512 })
  .resize(probe, probe)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 8) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
}
const k = VB / probe;
const bbox = { x: minX * k, y: minY * k, w: (maxX - minX + 1) * k, h: (maxY - minY + 1) * k };

/** Square canvas: optional background (full or circle) and the head at `fill` of the side. */
function compose({ size, bg = null, circle = null, fill }) {
  const s = (size * fill) / Math.max(bbox.w, bbox.h);
  const w = bbox.w * s;
  const h = bbox.h * s;
  const x = (size - w) / 2;
  const y = (size - h) / 2 + size * 0.01; // optical nudge for the ears
  const back = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '';
  const disc = circle
    ? `<circle cx="${size / 2}" cy="${size / 2}" r="${(size * circle.r).toFixed(1)}" fill="${circle.fill}"/>`
    : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${back}${disc}` +
      `<svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" ` +
      `viewBox="${bbox.x.toFixed(2)} ${bbox.y.toFixed(2)} ${bbox.w.toFixed(2)} ${bbox.h.toFixed(2)}" preserveAspectRatio="xMidYMid meet">${inner}</svg></svg>`
  );
}

const png = (svg, size) =>
  sharp(svg, { density: 72 * 4 }).resize(size, size).flatten(false).png({ compressionLevel: 9 }).toBuffer();
const opaque = (svg, size, bg) =>
  sharp(svg, { density: 72 * 4 }).resize(size, size).flatten({ background: bg }).png({ compressionLevel: 9 }).toBuffer();

await mkdir(OUT, { recursive: true });

// iOS icon (no transparency allowed) and the legacy Android one: pink square, head well inside.
await writeFile(path.join(OUT, 'icon-only.png'), await opaque(compose({ size: 1024, bg: PINK, fill: 0.66 }), 1024, PINK));
// Android adaptive icon: the launcher masks to a circle/squircle, so the head
// stays inside the 66% safe zone.
await writeFile(path.join(OUT, 'icon-foreground.png'), await png(compose({ size: 1024, fill: 0.5 }), 1024));
await writeFile(path.join(OUT, 'icon-background.png'), await opaque(compose({ size: 1024, bg: PINK, fill: 0 }), 1024, PINK));
// Launch screen: Stinky on a pink disc, like the web's iOS splash screens.
const splash = (bg) => compose({ size: 2732, bg, circle: { r: 0.11, fill: PINK }, fill: 0.16 });
await writeFile(path.join(OUT, 'splash.png'), await opaque(splash(LIGHT_BG), 2732, LIGHT_BG));
await writeFile(path.join(OUT, 'splash-dark.png'), await opaque(splash(DARK_BG), 2732, DARK_BG));

console.log('source assets written to', OUT);
