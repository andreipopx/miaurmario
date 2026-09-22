import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import es from '@/messages/es.json';
import en from '@/messages/en.json';
import { ALL_SECTIONS, MAIN_SECTIONS, SETTINGS, isTabRoot, resolveNav } from '@/components/nav-items';
import { profileHref } from '@/components/profile-menu';

function where(pathname: string) {
  const r = resolveNav(pathname);
  return r ? `${r.section.key}/${r.tab?.key ?? '-'}` : null;
}

describe('information architecture', () => {
  it('keeps the dock/sidebar at five areas', () => {
    expect(MAIN_SECTIONS.map((s) => s.key)).toEqual(['today', 'wardrobe', 'stylist', 'inspo', 'stinky']);
    expect(MAIN_SECTIONS.length).toBeLessThanOrEqual(5);
    expect(MAIN_SECTIONS.find((s) => s.key === 'inspo')?.socialBadge).toBe(true);
  });

  it('never lists a page twice across areas', () => {
    const hrefs = ALL_SECTIONS.flatMap((s) => (s.tabs.length ? s.tabs.map((t) => t.href) : [s.href]));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('keeps every dashboard page reachable from the nav', () => {
    const root = join(__dirname, '..', 'app', 'dashboard');
    const pages: string[] = [];
    const walk = (dir: string, route: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, `${route}/${name}`);
        else if (name === 'page.tsx') pages.push(route);
      }
    };
    walk(root, '/dashboard');
    // Detail pages ([id], new, integration sub-pages, AI setup) are reached from their parent screen;
    // Admin is in the profile menu.
    const top = pages.filter((p) => !/\[|\/new$|\/integrations\/|\/settings\/ai$|\/admin$/.test(p));
    for (const p of top) expect(where(p), p).not.toBeNull();
  });

  it('lights up the right area and tab for sub-pages and deep links', () => {
    expect(where('/dashboard')).toBe('today/-');
    expect(where('/dashboard/wardrobe')).toBe('wardrobe/garments');
    expect(where('/dashboard/outfits')).toBe('wardrobe/looks');
    expect(where('/dashboard/outfits/abc')).toBe('wardrobe/looks');
    expect(where('/dashboard/outfits/new')).toBe('wardrobe/looks');
    expect(where('/dashboard/learning')).toBe('wardrobe/learning');
    expect(where('/dashboard/suggest')).toBe('stylist/-');
    expect(where('/dashboard/friends/ana')).toBe('inspo/friends');
    expect(where('/dashboard/family/feed')).toBe('inspo/family');
    expect(where('/dashboard/music')).toBe('inspo/music');
    expect(where('/dashboard/stinky')).toBe('stinky/-');
    expect(where('/dashboard/family')).toBe('settings/familySettings');
    expect(where('/dashboard/settings/integrations/spotify')).toBe('settings/integrations');
    expect(where('/dashboard/settings/ai')).toBe('settings/general');
    expect(where('/dashboard/notifications')).toBe('settings/notifications');
    expect(where('/dashboard/admin')).toBeNull();
    expect(where('/dashboardx')).toBeNull();
  });

  it('shows the tab strip only on tab roots, not on detail pages', () => {
    expect(isTabRoot('/dashboard/outfits', resolveNav('/dashboard/outfits')!.section)).toBe(true);
    expect(isTabRoot('/dashboard/outfits/abc', resolveNav('/dashboard/outfits/abc')!.section)).toBe(false);
    expect(isTabRoot('/dashboard/settings/integrations', SETTINGS)).toBe(true);
  });

  it('has a label for every entry in both languages', () => {
    const keys = ALL_SECTIONS.flatMap((s) => [s.key, ...(s.shortKey ? [s.shortKey] : []), ...s.tabs.map((t) => t.key)]);
    for (const k of keys) {
      expect((es.nav as Record<string, string>)[k], `es nav.${k}`).toBeTruthy();
      expect((en.nav as Record<string, string>)[k], `en nav.${k}`).toBeTruthy();
    }
  });

  it('profile link goes to your own profile, or Ajustes without a handle', () => {
    expect(profileHref('ana')).toBe('/dashboard/friends/ana');
    expect(profileHref(null)).toBe('/dashboard/settings');
  });
});
