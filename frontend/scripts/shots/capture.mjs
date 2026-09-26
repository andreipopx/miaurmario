#!/usr/bin/env node
/**
 * Drive the scenes in a real browser and photograph them.
 *
 * The eraser scene is not just loaded but *used*: the script paints strokes on the
 * canvas with real pointer events, so the screenshot shows the tool mid-edit rather
 * than the tool sitting idle, which is the only version worth reviewing.
 *
 * Every shot is also checked for sideways scroll, because a screenshot that is
 * quietly 20px too wide looks fine and is a bug.
 *
 * Usage:
 *   npm i --no-save playwright-core        # plus a Chromium, or pass --chrome
 *   npx vite --config scripts/shots/vite.config.mjs &
 *   node scripts/shots/capture.mjs --out <dir> [--base http://127.0.0.1:5199]
 *
 * Playwright is deliberately not a dependency of the app: this is a tool for
 * writing a change up, not something the build needs.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith('--')) acc.push([arg.slice(2), all[i + 1]]);
    return acc;
  }, [])
);
const base = args.base || 'http://127.0.0.1:5199';
const outDir = args.out || path.resolve('shots');
fs.mkdirSync(outDir, { recursive: true });

const SHOTS = [
  { name: 'eraser-360', scene: 'eraser', width: 360, act: 'paint' },
  { name: 'eraser-360-dark', scene: 'eraser', width: 360, dark: true, act: 'paint' },
  { name: 'eraser-320', scene: 'eraser', width: 320, act: 'paint' },
  { name: 'eraser-360-125pct', scene: 'eraser', width: 360, font: 125, act: 'paint' },
  // Zoomed in and painting at that zoom: the whole point of the change, and the shot
  // where a coordinate bug would be obvious.
  { name: 'eraser-zoom-360', scene: 'eraser', width: 360, act: 'zoom' },
  { name: 'eraser-zoom-360-dark', scene: 'eraser', width: 360, dark: true, act: 'zoom' },
  { name: 'eraser-zoom-320', scene: 'eraser', width: 320, act: 'zoom' },
  { name: 'eraser-zoom-360-125pct', scene: 'eraser', width: 360, font: 125, act: 'zoom' },
  // A lasso mid-drag, so the red fill and the marching ants are in the picture.
  { name: 'eraser-region-360', scene: 'eraser', width: 360, act: 'region' },
  { name: 'eraser-region-360-dark', scene: 'eraser', width: 360, dark: true, act: 'region' },
  { name: 'eraser-region-320', scene: 'eraser', width: 320, act: 'region' },
  { name: 'eraser-region-360-125pct', scene: 'eraser', width: 360, font: 125, act: 'region' },
  // The garment dialog: what is on top by default, and what the overflow holds.
  { name: 'garment-360', scene: 'garment', width: 360 },
  { name: 'garment-360-dark', scene: 'garment', width: 360, dark: true },
  { name: 'garment-320', scene: 'garment', width: 320 },
  { name: 'garment-360-125pct', scene: 'garment', width: 360, font: 125 },
  { name: 'garment-overflow-360', scene: 'garment', width: 360, act: 'overflow' },
  { name: 'garment-overflow-360-dark', scene: 'garment', width: 360, dark: true, act: 'overflow' },
  { name: 'garment-overflow-320', scene: 'garment', width: 320, act: 'overflow' },
  { name: 'garment-overflow-360-125pct', scene: 'garment', width: 360, font: 125, act: 'overflow' },
  { name: 'garment-editing-360', scene: 'garment', width: 360, act: 'editing' },
  { name: 'garment-editing-320', scene: 'garment', width: 320, act: 'editing' },
  { name: 'framing-before-360', scene: 'framing-before', width: 360 },
  { name: 'framing-after-360', scene: 'framing-after', width: 360 },
  { name: 'framing-after-360-dark', scene: 'framing-after', width: 360, dark: true },
  { name: 'framing-after-320', scene: 'framing-before', width: 320 },
];

/** The eraser's stage: the box the photo is panned and zoomed inside. */
const STAGE = '[role="application"]';

/** Paint a few strokes over the neck opening and down one side, as a thumb would. */
async function paintStrokes(page) {
  const box = await page.locator(STAGE).boundingBox();
  if (!box) throw new Error('no canvas to paint on');
  // Over the neck opening the model left filled in, and a short wipe along the
  // hem — both on the garment, so the screenshot shows the tool doing something.
  const strokes = [
    [
      [0.5, 0.16],
      [0.53, 0.19],
      [0.5, 0.22],
      [0.47, 0.19],
      [0.5, 0.16],
    ],
    [
      [0.3, 0.86],
      [0.45, 0.88],
      [0.6, 0.87],
    ],
  ];
  for (const stroke of strokes) {
    const [sx, sy] = stroke[0];
    await page.mouse.move(box.x + box.width * sx, box.y + box.height * sy);
    await page.mouse.down();
    for (const [x, y] of stroke.slice(1)) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 8 });
    }
    await page.mouse.up();
    await page.waitForTimeout(80);
  }
}

/**
 * Zoom into the neck opening with the + button, then wipe at that zoom.
 *
 * Pressed rather than pinched because a two-finger gesture is awkward to drive and
 * the buttons go through exactly the same code. The strokes afterwards are the part
 * worth photographing: they have to land where the finger is, not where the photo
 * used to be.
 */
async function zoomAndPaint(page) {
  const zoomIn = page.getByRole('button', { name: 'Acercar' });
  await zoomIn.click();
  await zoomIn.click();
  await page.waitForTimeout(120);
  const box = await page.locator(STAGE).boundingBox();
  if (!box) throw new Error('no stage to paint on');
  // A short wipe across the middle of what is now on screen.
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.42);
  await page.mouse.down();
  for (const [x, y] of [
    [0.45, 0.45],
    [0.55, 0.43],
    [0.64, 0.46],
  ]) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 8 });
  }
  await page.mouse.up();
  // Left hovering, so the brush ring is in the picture at the size it covers.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.62);
}

/** Pick the lasso and drag a ring round the neck opening, stopping before letting go. */
async function dragRegion(page) {
  await page.getByRole('button', { name: 'Lazo' }).click();
  await page.waitForTimeout(80);
  const box = await page.locator(STAGE).boundingBox();
  if (!box) throw new Error('no stage to draw on');
  const ring = [
    [0.38, 0.1],
    [0.5, 0.07],
    [0.63, 0.11],
    [0.67, 0.2],
    [0.62, 0.3],
    [0.5, 0.33],
    [0.38, 0.3],
    [0.33, 0.2],
  ];
  const [sx, sy] = ring[0];
  await page.mouse.move(box.x + box.width * sx, box.y + box.height * sy);
  await page.mouse.down();
  for (const [x, y] of ring.slice(1)) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 6 });
  }
  // Deliberately not released: the shot is of the region being enclosed.
}

/** Unfold "Más opciones", which is where everything rare lives now. */
async function openOverflow(page) {
  await page.getByRole('button', { name: 'Más opciones' }).click();
  await page.waitForTimeout(250);
}

/** Enter edit mode, which is the only door to the tools that rewrite a photo. */
async function startEditing(page) {
  await page.getByRole('button', { name: 'Editar prenda y etiquetas' }).click();
  await page.waitForTimeout(250);
}

const ACTS = {
  paint: paintStrokes,
  zoom: zoomAndPaint,
  region: dragRegion,
  overflow: openOverflow,
  editing: startEditing,
};

async function main() {
  let playwright;
  try {
    playwright = require('playwright-core');
  } catch {
    playwright = require('playwright');
  }
  const browser = await playwright.chromium.launch({
    executablePath: args.chrome || process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--force-color-profile=srgb'],
  });

  let failed = 0;
  for (const shot of SHOTS) {
    const ctx = await browser.newContext({
      viewport: { width: shot.width, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: shot.dark ? 'dark' : 'light',
      hasTouch: true,
    });
    const page = await ctx.newPage();
    const url = `${base}/?scene=${shot.scene}&width=${shot.width}${shot.dark ? '&dark=1' : ''}${
      shot.font ? `&font=${shot.font}` : ''
    }`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('body[data-shot-ready="1"]', { timeout: 15000 });
    await page.waitForTimeout(300);
    if (shot.act) await ACTS[shot.act](page);
    await page.waitForTimeout(200);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    const file = path.join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const bad = overflow.scrollWidth > overflow.innerWidth + 1;
    if (bad) failed += 1;
    console.log(
      `${bad ? 'OVERFLOW' : 'ok      '} ${shot.name.padEnd(24)} ${overflow.scrollWidth}/${overflow.innerWidth}  ${file}`
    );
    await ctx.close();
  }
  await browser.close();
  if (failed) {
    console.error(`${failed} shot(s) scroll sideways`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
