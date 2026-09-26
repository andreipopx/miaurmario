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
  { name: 'eraser-360', scene: 'eraser', width: 360, paint: true },
  { name: 'eraser-360-dark', scene: 'eraser', width: 360, dark: true, paint: true },
  { name: 'eraser-320', scene: 'eraser', width: 320, paint: true },
  { name: 'eraser-360-125pct', scene: 'eraser', width: 360, font: 125, paint: true },
  { name: 'framing-before-360', scene: 'framing-before', width: 360 },
  { name: 'framing-after-360', scene: 'framing-after', width: 360 },
  { name: 'framing-after-360-dark', scene: 'framing-after', width: 360, dark: true },
  { name: 'framing-after-320', scene: 'framing-before', width: 320 },
];

/** Paint a few strokes over the neck opening and down one side, as a thumb would. */
async function paintStrokes(page) {
  const box = await page.locator('canvas').boundingBox();
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
    if (shot.paint) await paintStrokes(page);
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
