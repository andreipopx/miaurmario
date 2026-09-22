#!/usr/bin/env node
/**
 * Responsive audit: loads every screen at narrow phone widths and reports
 * anything that makes the page scroll sideways or gets cut off at the edge.
 *
 * It drives a running app (e.g. `next start` or the standalone server) that
 * talks to a backend with seeded data, logs in with a password account and then,
 * for every width, checks:
 *   - document.scrollingElement.scrollWidth > innerWidth (page scrolls sideways)
 *   - elements whose box sticks out past the left/right edge. Rows that scroll
 *     on purpose (overflow-x: auto/scroll, e.g. pill tabs and chip rows) and
 *     things clipped by their own in-viewport box (cards with overflow-hidden)
 *     are ignored; content clipped by <main>'s overflow-x-hidden is reported,
 *     because that is exactly what "the app is cut off" looks like.
 *
 * Usage:
 *   node scripts/responsive-audit.mjs --base http://127.0.0.1:3000 \
 *     --user someone@example.com --password '…' [--out dir] [--shots 320,360] \
 *     [--only /dashboard,/dashboard/wardrobe] [--profile friend_username]
 *
 * Needs `playwright-core` (or `playwright`) resolvable plus a Chromium; pass
 * --chrome /path/to/chrome or set CHROME_PATH if Playwright's is not installed.
 * Exits 1 when anything overflows.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1] ?? 'true']);
    return acc;
  }, [])
);

let pw;
for (const mod of ['playwright-core', 'playwright']) {
  try {
    pw = require(mod);
    break;
  } catch {
    /* try next */
  }
}
if (!pw) {
  console.error('playwright-core not found (NODE_PATH=… or npm i -D playwright-core)');
  process.exit(2);
}

const BASE = (args.base || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = args.out || '';
const SHOT_WIDTHS = new Set((args.shots || '').split(',').filter(Boolean).map(Number));
const FRIEND = args.profile || '';
const ONLY = (args.only || '').split(',').filter(Boolean);

// Huawei Mate 50 Pro (Huawei Browser, Chromium) user agent.
const UA =
  'Mozilla/5.0 (Linux; Android 12; DCO-AL00; HMSCore 6.11.0.302) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/15.0.4.312 Mobile Safari/537.36';

const CONFIGS = [
  { name: '320', width: 320 },
  { name: '360', width: 360 },
  { name: '384', width: 384 },
  { name: '412', width: 412 },
  // Big system font / "display size": root font-size 125% at 360.
  { name: '360-font125', width: 360, fontScale: 1.25 },
];

/** Screens (path, optional action that opens a dialog/sheet before measuring). */
const SCREENS = [
  { id: 'login', path: '/login', anon: true },
  { id: 'legal', path: '/legal', anon: true },
  { id: 'unsubscribe', path: '/unsubscribe?token=abc', anon: true },
  { id: 'invite', path: '/invite?code=MIAU-PRIMA-BODA-2026', anon: true },
  ...(FRIEND ? [{ id: 'public-profile', path: `/u/${FRIEND}`, anon: true }] : []),
  { id: 'onboarding', path: '/onboarding' },
  { id: 'onboarding-username', path: '/onboarding/username' },
  { id: 'hoy', path: '/dashboard' },
  { id: 'armario', path: '/dashboard/wardrobe' },
  {
    id: 'armario-item-dialog',
    path: '/dashboard/wardrobe',
    action: async (page) => {
      await page.locator('main img').first().click();
    },
  },
  {
    id: 'armario-add-dialog',
    path: '/dashboard/wardrobe',
    action: async (page) => {
      await page.getByRole('button', { name: /añadir|add/i }).first().click();
    },
  },
  { id: 'looks', path: '/dashboard/outfits' },
  { id: 'look-detail', path: 'FIRST_OUTFIT' },
  { id: 'look-new', path: '/dashboard/outfits/new' },
  { id: 'pairings', path: '/dashboard/pairings' },
  { id: 'history', path: '/dashboard/history' },
  { id: 'analytics', path: '/dashboard/analytics' },
  { id: 'learning', path: '/dashboard/learning' },
  { id: 'estilista', path: '/dashboard/suggest' },
  { id: 'friends', path: '/dashboard/friends' },
  ...(FRIEND ? [{ id: 'friend-profile', path: `/dashboard/friends/${FRIEND}` }] : []),
  { id: 'family-feed', path: '/dashboard/family/feed' },
  { id: 'music', path: '/dashboard/music' },
  { id: 'pins', path: '/dashboard/pins' },
  { id: 'stinky', path: '/dashboard/stinky' },
  {
    id: 'stinky-conversation',
    path: '/dashboard/stinky',
    action: async (page) => {
      const history = page.getByRole('button', { name: /historial|conversaciones|history/i }).first();
      if (await history.count()) await history.click();
      await page.waitForTimeout(400);
      // First saved conversation (its main button, not the delete one).
      await page.locator('ul.overscroll-contain > li > button').first().click({ timeout: 3000 });
      await page.waitForTimeout(800);
    },
  },
  { id: 'settings', path: '/dashboard/settings' },
  { id: 'settings-ai', path: '/dashboard/settings/ai' },
  { id: 'notifications', path: '/dashboard/notifications' },
  { id: 'integrations', path: '/dashboard/settings/integrations' },
  { id: 'integrations-lastfm', path: '/dashboard/settings/integrations/lastfm' },
  { id: 'integrations-spotify', path: '/dashboard/settings/integrations/spotify' },
  { id: 'integrations-pinterest', path: '/dashboard/settings/integrations/pinterest' },
  { id: 'family-settings', path: '/dashboard/family' },
  { id: 'install', path: '/dashboard/install' },
  ...['summary', 'users', 'signup', 'inbox', 'system'].map((tab) => ({
    id: `admin-${tab}`,
    path: `/dashboard/admin?tab=${tab}`,
  })),
  {
    id: 'profile-menu',
    path: '/dashboard',
    action: async (page) => {
      await page.locator('header button').first().click();
    },
  },
].filter((s) => !ONLY.length || ONLY.includes(s.path) || ONLY.includes(s.id));

/** Runs in the page: returns the horizontal overflow report. */
function measure() {
  const W = window.innerWidth;
  const se = document.scrollingElement || document.documentElement;
  const isScroller = (el) => {
    const cs = getComputedStyle(el);
    return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
  };
  const clips = (el) => {
    const cs = getComputedStyle(el);
    return cs.overflowX === 'hidden' || cs.overflowX === 'clip';
  };
  const fits = (r) => r.right <= W + 1 && r.left >= -1;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  };
  // Hidden by an ancestor that scrolls on purpose, or clipped by a box that itself fits.
  const excused = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (isScroller(p)) return true;
      if (clips(p)) {
        if (p.tagName === 'MAIN') return false; // <main> clips page overflow: that IS the bug
        if (fits(p.getBoundingClientRect())) return true;
      }
    }
    return false;
  };
  const describe = (el) => {
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      const cls = (n.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 4);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const offending = (el) => {
    const r = el.getBoundingClientRect();
    return !fits(r) && visible(el) && !excused(el);
  };
  const offenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!offending(el)) continue;
    // Report the outermost offender; its children are usually just along for the ride.
    if (el.parentElement && el.parentElement !== document.body && offending(el.parentElement)) continue;
    const r = el.getBoundingClientRect();
    // …plus its widest descendant that sticks out, which is usually the cause.
    let cause = null;
    let widest = 0;
    for (const d of el.querySelectorAll('*')) {
      const dr = d.getBoundingClientRect();
      const over = Math.max(dr.right - W, -dr.left);
      if (over > 1 && visible(d) && dr.width >= widest) {
        widest = dr.width;
        cause = d;
      }
    }
    offenders.push({
      el: describe(el),
      left: Math.round(r.left),
      right: Math.round(r.right),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
      cause: cause ? describe(cause) : null,
    });
  }
  return { innerWidth: W, scrollWidth: se.scrollWidth, offenders };
}

async function login(browser) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'es-ES' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.locator('#pw-identifier').fill(args.user);
  await page.locator('#pw-password').fill(args.password);
  await page.locator('form:has(#pw-password) button[type=submit]').click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30000 });
  const state = await ctx.storageState();
  // Grab one outfit id for the detail page.
  const firstOutfit = await page.evaluate(async () => {
    const s = await fetch('/api/auth/session').then((r) => r.json());
    const r = await fetch('/api/v1/outfits?page_size=1&status=accepted', {
      headers: { Authorization: `Bearer ${s.accessToken}` },
    });
    const j = await r.json().catch(() => ({}));
    return j.outfits?.[0]?.id ?? null;
  });
  await ctx.close();
  return { state, firstOutfit };
}

(async () => {
  const browser = await pw.chromium.launch({ executablePath: args.chrome || process.env.CHROME_PATH || undefined });
  const auth = args.user ? await login(browser) : null;
  let failures = 0;
  const report = {};
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  for (const cfg of CONFIGS) {
    for (const anon of [true, false]) {
      if (!anon && !auth) continue;
      const ctx = await browser.newContext({
        viewport: { width: cfg.width, height: 780 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: UA,
        locale: 'es-ES',
        colorScheme: 'light',
        storageState: anon ? undefined : auth.state,
      });
      if (cfg.fontScale) {
        await ctx.addInitScript((scale) => {
          const apply = () => document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important');
          if (document.documentElement) apply();
          document.addEventListener('DOMContentLoaded', apply);
        }, cfg.fontScale);
      }
      // Keep the PWA install hint / cookie-ish banners from being dismissed state-dependent.
      const page = await ctx.newPage();
      for (const screen of SCREENS) {
        if (!!screen.anon !== anon) continue;
        let url = screen.path;
        if (url === 'FIRST_OUTFIT') {
          if (!auth?.firstOutfit) continue;
          url = `/dashboard/outfits/${auth.firstOutfit}`;
        }
        try {
          await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 30000 });
        } catch {
          /* long-polling pages: measure anyway */
        }
        await page.waitForTimeout(700);
        if (screen.action) {
          try {
            await screen.action(page);
            await page.waitForTimeout(700);
          } catch (e) {
            console.warn(`  [${cfg.name}] ${screen.id}: action failed (${e.message.split('\n')[0]})`);
          }
        }
        const res = await page.evaluate(measure);
        const key = `${cfg.name} ${screen.id}`;
        const bad = res.scrollWidth > res.innerWidth + 1 || res.offenders.length > 0;
        if (bad) {
          failures++;
          report[key] = res;
          console.log(`✗ ${key}: scrollWidth ${res.scrollWidth}/${res.innerWidth}, ${res.offenders.length} offender(s)`);
          for (const o of res.offenders.slice(0, 6)) {
            console.log(`    ${o.left}..${o.right}  ${o.el}\n      "${o.text}"${o.cause ? `\n      cause: ${o.cause}` : ''}`);
          }
        } else {
          console.log(`✓ ${key}`);
        }
        if (OUT && SHOT_WIDTHS.has(cfg.width) && !cfg.fontScale) {
          await page.screenshot({ path: path.join(OUT, `${cfg.name}-${screen.id}.png`), fullPage: !screen.action });
        } else if (OUT && cfg.fontScale && SHOT_WIDTHS.has(cfg.width)) {
          await page.screenshot({ path: path.join(OUT, `${cfg.name}-${screen.id}.png`) });
        }
      }
      await ctx.close();
    }
  }
  if (OUT) fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(failures ? `\n${failures} screen/width combination(s) overflow` : '\nNo horizontal overflow');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
