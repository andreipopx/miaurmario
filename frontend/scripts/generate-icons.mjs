#!/usr/bin/env node
/**
 * Generates favicon + PWA icons from Stinky's head (public/brand/stinky/head/stinky-head.svg).
 *
 *   node scripts/generate-icons.mjs
 *
 * Outputs (public/): favicon.svg, favicon.ico (16/32/48), favicon-32.png, apple-touch-icon.png (180),
 * icon-192.png, icon-512.png (rounded pink tile, purpose "any") and icon-maskable-512.png
 * (full-bleed pink, head inside the 40% safe-zone circle).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const HEAD_SVG = path.join(PUB, 'brand/stinky/head/stinky-head.svg');

const PINK = '#FF7EB6';
const SOFT_PINK = '#FFE3EF';

const raw = await readFile(HEAD_SVG, 'utf8');
const VB = 420; // source viewBox is 0 0 420 420

// 1. Find the head's tight bounding box by rasterising and trimming transparent pixels.
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
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
const scale = VB / probe;
const bbox = {
  x: minX * scale,
  y: minY * scale,
  w: (maxX - minX + 1) * scale,
  h: (maxY - minY + 1) * scale,
};
console.log('head bbox (svg units):', Object.fromEntries(Object.entries(bbox).map(([k, v]) => [k, v.toFixed(1)])));

// Inner content of the source svg (everything between the root tags).
const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/**
 * Compose a square icon: background shape + the head scaled so its larger side
 * takes `fill` of the canvas, centred (optically nudged down a touch for the ears).
 */
function composeSvg({ size = 512, bg = null, radius = 0, fill = 0.8, circle = false }) {
  const side = Math.max(bbox.w, bbox.h);
  const target = size * fill;
  const s = target / side;
  const w = bbox.w * s;
  const h = bbox.h * s;
  const x = (size - w) / 2;
  const y = (size - h) / 2 + size * 0.01;
  const bgEl = !bg
    ? ''
    : circle
      ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${bg}"/>`
      : `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${bgEl}<svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="${bbox.x.toFixed(2)} ${bbox.y.toFixed(2)} ${bbox.w.toFixed(2)} ${bbox.h.toFixed(2)}" preserveAspectRatio="xMidYMid meet">${inner}</svg></svg>`;
}

const png = (svg, size) => sharp(Buffer.from(svg), { density: 72 * 4 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

// Favicon: tight crop on a pink rounded tile so the black cat reads on light *and* dark tabs.
const faviconSvg = composeSvg({ size: 64, bg: PINK, radius: 14, fill: 0.9 });
await writeFile(path.join(PUB, 'favicon.svg'), faviconSvg);

// Small sizes get an even tighter crop (ears to chin fill the tile).
const tinySvg = composeSvg({ size: 64, bg: PINK, radius: 12, fill: 0.94 });
const ico = await Promise.all([16, 32, 48].map((n) => png(n <= 32 ? tinySvg : faviconSvg, n)));
await writeFile(path.join(PUB, 'favicon-32.png'), ico[1]);

// ICO container with PNG-encoded entries (supported by every current browser).
function buildIco(images, sizes) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((buf, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e);
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(buf.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...images]);
}
await writeFile(path.join(PUB, 'favicon.ico'), buildIco(ico, [16, 32, 48]));

// Apple touch icon: square soft-pink (iOS applies its own mask).
await writeFile(path.join(PUB, 'apple-touch-icon.png'), await png(composeSvg({ size: 512, bg: SOFT_PINK, fill: 0.72 }), 180));

// PWA "any": pink rounded tile.
const anySvg = composeSvg({ size: 512, bg: PINK, radius: 112, fill: 0.78 });
await writeFile(path.join(PUB, 'icon-192.png'), await png(anySvg, 192));
await writeFile(path.join(PUB, 'icon-512.png'), await png(anySvg, 512));

// PWA maskable: full-bleed pink, head within the 40%-radius safe circle (≈ 0.56 of the side for a wide head).
await writeFile(path.join(PUB, 'icon-maskable-512.png'), await png(composeSvg({ size: 512, bg: PINK, fill: 0.58 }), 512));

console.log('icons written to', PUB);
