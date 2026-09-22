#!/usr/bin/env node
/**
 * Generates the Web Push notification badge: Stinky's head silhouette in white on
 * transparent (Android paints badges as an alpha mask in the status bar).
 *
 *   node scripts/generate-push-badge.mjs   ->  public/brand/stinky/badge-96.png
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEAD_SVG = path.join(ROOT, 'public/brand/stinky/head/stinky-head.svg');
const OUT = path.join(ROOT, 'public/brand/stinky/badge-96.png');
const SIZE = 96;
const PAD = 6;

const svg = await readFile(HEAD_SVG);
const head = await sharp(svg, { density: 300 })
  .trim()
  .resize(SIZE - PAD * 2, SIZE - PAD * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .ensureAlpha()
  .extractChannel('alpha')
  .toBuffer();

const white = await sharp({
  create: { width: SIZE - PAD * 2, height: SIZE - PAD * 2, channels: 3, background: '#FFFFFF' },
})
  .joinChannel(head)
  .png()
  .toBuffer();

await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: white, left: PAD, top: PAD }])
  .png({ compressionLevel: 9 })
  .toFile(OUT);

console.log(`wrote ${path.relative(ROOT, OUT)}`);
