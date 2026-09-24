#!/usr/bin/env node
/**
 * Generates the 1200×630 share card used as og:image / twitter:image for `/`
 * (pasting the link into WhatsApp, Telegram or Instagram DMs shows this).
 *
 *   npm run og            # writes public/og/miaurmario-og.png
 *
 * Everything is drawn here: a pink card, Stinky's head on a white circle
 * (public/brand/stinky/head/stinky-head-512.png) and the wordmark + one-line
 * pitch as SVG text. The output PNG is committed, so this only needs running
 * when the pitch or the brand changes.
 *
 * The two brand fonts (Bagel Fat One for the wordmark, Figtree for the text)
 * are not installed system-wide, so they are downloaded from Google Fonts into
 * a cache directory and handed to librsvg through a temporary fontconfig file —
 * librsvg ignores @font-face, it only matches installed families. Needs network
 * access the first time; after that the cache is reused.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'og/miaurmario-og.png');
const HEAD_PNG = path.join(PUB, 'brand/stinky/head/stinky-head-512.png');
const FONT_CACHE = path.join(os.tmpdir(), 'miaurmario-og-fonts');

const W = 1200;
const H = 630;
const PINK = '#FF7EB6';
const INK = '#111111';

// Hand-broken so the pitch reads as three balanced lines; auto-fitted below.
const WORDMARK = 'miaurmario';
const PITCH = ['Tu armario en el móvil: haz fotos', 'de tu ropa y Stinky te dice', 'qué ponerte'];
const KICKER = 'Nada que descargar · se abre en el navegador';

// ---------------------------------------------------------------- fonts
// Google Fonts serves plain TrueType to a bare "Mozilla/5.0" user agent; every
// modern browser UA gets woff2, which fontconfig cannot use.
async function downloadFont(family, weight, filename) {
  const dest = path.join(FONT_CACHE, filename);
  try {
    await access(dest);
    return;
  } catch {
    /* not cached yet */
  }
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!css.ok) throw new Error(`Google Fonts CSS for ${family}: HTTP ${css.status}`);
  const url = (await css.text()).match(/url\((https:[^)]+)\)/)?.[1];
  if (!url) throw new Error(`No font file in the CSS for ${family}`);
  const font = await fetch(url);
  if (!font.ok) throw new Error(`${family}: HTTP ${font.status}`);
  await writeFile(dest, Buffer.from(await font.arrayBuffer()));
}

async function setUpFonts() {
  await mkdir(FONT_CACHE, { recursive: true });
  await downloadFont('Bagel+Fat+One', 400, 'BagelFatOne-Regular.ttf');
  await downloadFont('Figtree', 800, 'Figtree-ExtraBold.ttf');
  await downloadFont('Figtree', 600, 'Figtree-SemiBold.ttf');
  const conf = path.join(FONT_CACHE, 'fonts.conf');
  await writeFile(
    conf,
    '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>' +
      '<include ignore_missing="yes">/etc/fonts/fonts.conf</include>' +
      `<dir>${FONT_CACHE}</dir><cachedir>${path.join(FONT_CACHE, 'cache')}</cachedir></fontconfig>`
  );
  // Must be set before sharp (and therefore librsvg) is loaded.
  process.env.FONTCONFIG_FILE = conf;
}

await setUpFonts();
const sharp = (await import('sharp')).default;

// ---------------------------------------------------------------- text fitting
const REF = 100; // measure at 100px, then scale linearly

const escapeXml = (s) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

/** Ink width of one line at REF px, measured by rasterising and trimming. */
async function inkWidth(text, family, weight) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="300"><text x="10" y="200" font-family="${family}" font-weight="${weight}" font-size="${REF}" fill="#000">${escapeXml(text)}</text></svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let min = Infinity;
  let max = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  if (max < 0) throw new Error(`Nothing rendered for "${text}" in ${family} — is the font cached?`);
  return max - min + 1;
}

/** Largest size ≤ `max` at which every line fits in `maxWidth`. */
async function fitSize(lines, family, weight, maxWidth, max) {
  const widths = await Promise.all(lines.map((l) => inkWidth(l, family, weight)));
  const worst = Math.max(...widths.map((w) => w / REF));
  return Math.min(max, Math.floor(maxWidth / worst));
}

// ---------------------------------------------------------------- compose
const CIRCLE = { cx: 268, cy: H / 2, r: 186 };
const TEXT_X = 512;
const TEXT_MAX = W - TEXT_X - 72;

const wordmarkSize = await fitSize([WORDMARK], 'Bagel Fat One', 400, TEXT_MAX, 88);
const pitchSize = await fitSize(PITCH, 'Figtree', 800, TEXT_MAX, 46);
const kickerSize = await fitSize([KICKER], 'Figtree', 600, TEXT_MAX, 25);

const pitchLead = Math.round(pitchSize * 1.24);
const pitchTop = 296;
const pitchLines = PITCH.map(
  (line, i) =>
    `<text x="${TEXT_X}" y="${pitchTop + i * pitchLead}" font-family="Figtree" font-weight="800" font-size="${pitchSize}" letter-spacing="-0.6" fill="${INK}">${escapeXml(line)}</text>`
).join('');

const card = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${PINK}"/>
  <circle cx="${CIRCLE.cx}" cy="${CIRCLE.cy}" r="${CIRCLE.r}" fill="#FFFFFF"/>
  <text x="${TEXT_X}" y="208" font-family="Bagel Fat One" font-size="${wordmarkSize}" fill="${INK}">${WORDMARK}</text>
  ${pitchLines}
  <text x="${TEXT_X}" y="${pitchTop + PITCH.length * pitchLead + 26}" font-family="Figtree" font-weight="600" font-size="${kickerSize}" fill="${INK}" fill-opacity="0.72">${escapeXml(KICKER)}</text>
</svg>`;

const headSize = Math.round(CIRCLE.r * 1.84);
const head = await sharp(await readFile(HEAD_PNG))
  .resize(headSize, headSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

await mkdir(path.dirname(OUT), { recursive: true });
await sharp(Buffer.from(card))
  .composite([
    {
      input: head,
      left: Math.round(CIRCLE.cx - headSize / 2),
      // Stinky's ears reach higher than his chin drops; nudge down to centre optically.
      top: Math.round(CIRCLE.cy - headSize / 2 + CIRCLE.r * 0.04),
    },
  ])
  .png({ compressionLevel: 9, palette: true, quality: 92 })
  .toFile(OUT);

const { size } = await sharp(OUT).metadata().then(async (m) => ({ ...m, size: (await readFile(OUT)).length }));
console.log(`og: ${path.relative(ROOT, OUT)} — ${W}×${H}, ${(size / 1024).toFixed(0)} KB`);
console.log(`    wordmark ${wordmarkSize}px · pitch ${pitchSize}px · kicker ${kickerSize}px`);
