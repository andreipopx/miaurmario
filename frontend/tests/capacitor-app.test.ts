import { afterEach, describe, expect, it, vi } from 'vitest';

const impact = vi.fn(() => Promise.resolve());
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: (...args: unknown[]) => impact(...(args as [])) },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM' },
}));

import { appPlatformFromUserAgent, isAppUserAgent, nativePlatform } from '@/lib/native/app-shell';
import { androidBackAction, inAppPath } from '@/lib/native/app-links';
import {
  APP_LINK_PREFIXES,
  appleAppSiteAssociation,
  assetLinks,
  parseFingerprints,
} from '@/lib/native/app-links-manifest';
import { haptic, hapticSupport, nativePulses, resetHaptics } from '@/lib/native/haptics';
import { OFFLINE_QUERY_ROOTS, shouldPersistQuery } from '@/lib/offline/persist';
import { supportsShareTarget } from '@/lib/pwa/platform';
import { STINKY_PET_VIBRATION } from '@/components/stinky/stinky-pet';

const ANDROID_APP =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36 MiaurmarioApp/1';
const IOS_APP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MiaurmarioApp/1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

type CapGlobal = { isNativePlatform: () => boolean; getPlatform: () => string };
function withBridge(platform: 'android' | 'ios') {
  (window as unknown as { Capacitor?: CapGlobal }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  };
}

afterEach(() => {
  delete (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
  resetHaptics();
  impact.mockClear();
  vi.useRealTimers();
});

describe('telling the app from a browser', () => {
  it('reads the user agent the shell appends', () => {
    expect(isAppUserAgent(ANDROID_APP)).toBe(true);
    expect(isAppUserAgent(IOS_APP)).toBe(true);
    expect(isAppUserAgent(ANDROID_CHROME)).toBe(false);
    expect(appPlatformFromUserAgent(ANDROID_APP)).toBe('android');
    expect(appPlatformFromUserAgent(IOS_APP)).toBe('ios');
    expect(appPlatformFromUserAgent(ANDROID_CHROME)).toBeNull();
  });

  it('trusts the injected bridge first', () => {
    expect(nativePlatform()).toBeNull(); // jsdom: a plain browser
    withBridge('ios');
    expect(nativePlatform()).toBe('ios');
  });

  it('never offers the PWA share target inside the app', () => {
    expect(supportsShareTarget(ANDROID_CHROME)).toBe(true);
    expect(supportsShareTarget(ANDROID_APP)).toBe(false);
  });
});

describe('links the OS hands the app', () => {
  const host = 'miaurmario.andreipop.org';

  it('opens our own links on their screen', () => {
    expect(inAppPath(`https://${host}/auth/callback?token=abc`, host)).toBe('/auth/callback?token=abc');
    expect(inAppPath(`https://${host}/u/andrei#top`, host)).toBe('/u/andrei#top');
    expect(inAppPath('/dashboard/friends', host)).toBe('/dashboard/friends');
  });

  it('leaves everything else alone', () => {
    expect(inAppPath('https://evil.example/auth/callback?token=abc', host)).toBeNull();
    expect(inAppPath('//evil.example/x', host)).toBeNull();
    expect(inAppPath('javascript:alert(1)', host)).toBeNull();
    expect(inAppPath(undefined, host)).toBeNull();
    expect(inAppPath('not a url', host)).toBeNull();
  });
});

describe("Android's back button", () => {
  const at = (pathname: string, extra: Partial<{ overlayOpen: boolean; canGoBack: boolean }> = {}) =>
    androidBackAction({ pathname, overlayOpen: false, canGoBack: false, ...extra });

  it('closes what is on top first', () => {
    expect(at('/dashboard', { overlayOpen: true, canGoBack: true })).toEqual({ kind: 'dismiss' });
  });

  it('leaves the app from Hoy, whatever history is behind it', () => {
    expect(at('/dashboard', { canGoBack: true })).toEqual({ kind: 'minimize' });
    expect(at('/login', { canGoBack: true })).toEqual({ kind: 'minimize' });
  });

  it('goes to Hoy from any other tab', () => {
    expect(at('/dashboard/wardrobe', { canGoBack: true })).toEqual({ kind: 'navigate', to: '/dashboard' });
  });

  it('inside a section walks back, or up a level when opened from a link', () => {
    expect(at('/dashboard/outfits/123', { canGoBack: true })).toEqual({ kind: 'history' });
    expect(at('/dashboard/outfits/123')).toEqual({ kind: 'navigate', to: '/dashboard/outfits' });
  });
});

describe('App Links / Universal Links files', () => {
  const fp = 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99';

  it('normalises fingerprints and drops junk', () => {
    expect(parseFingerprints(`${fp}, nonsense ${fp.replace(/:/g, '')}`)).toEqual([
      fp.toUpperCase(),
      fp.toUpperCase(),
    ]);
    expect(parseFingerprints(undefined)).toEqual([]);
  });

  it('assetlinks.json names the package and its keys', () => {
    expect(assetLinks([])).toBeNull();
    const [entry] = assetLinks([fp.toUpperCase()])!;
    expect(entry.target.package_name).toBe('org.andreipop.miaurmario');
    expect(entry.relation).toEqual(['delegate_permission/common.handle_all_urls']);
  });

  it('apple-app-site-association claims the same paths as Android', () => {
    expect(appleAppSiteAssociation('nope')).toBeNull();
    const aasa = appleAppSiteAssociation('abcde12345')!;
    expect(aasa.applinks.details[0].appIDs).toEqual(['ABCDE12345.org.andreipop.miaurmario']);
    expect(aasa.applinks.details[0].components.map((c) => c['/'])).toEqual(
      APP_LINK_PREFIXES.map((p) => `${p}*`)
    );
    expect(aasa.webcredentials.apps).toEqual(['ABCDE12345.org.andreipop.miaurmario']);
  });
});

describe('haptics inside the app', () => {
  it('splits a pattern into its pulses', () => {
    expect(nativePulses([15, 30, 15])).toEqual([
      { at: 0, ms: 15 },
      { at: 45, ms: 15 },
    ]);
    expect(nativePulses(40)).toEqual([{ at: 0, ms: 40 }]);
  });

  it("purrs on the phone's own engine, iPhone included", () => {
    vi.useFakeTimers();
    withBridge('ios');
    expect(hapticSupport()).toBe('native');
    expect(haptic(STINKY_PET_VIBRATION.purr)).toBe('native');
    vi.runAllTimers();
    expect(impact).toHaveBeenCalledTimes(4);
  });
});

describe('what is kept for offline use', () => {
  const q = (root: string, status: 'success' | 'error' = 'success') => ({
    queryKey: [root, { page: 1 }],
    state: { status, data: status === 'success' ? { ok: true } : undefined } as never,
  });

  it('keeps the wardrobe, looks and who you are', () => {
    for (const root of ['items', 'item', 'outfits', 'auth-user', 'wear-history']) {
      expect(shouldPersistQuery(q(root))).toBe(true);
    }
  });

  it('not the things that only make sense live, nor failures', () => {
    for (const root of ['weather', 'stinky-conversation', 'admin-users', 'music']) {
      expect(OFFLINE_QUERY_ROOTS.has(root)).toBe(false);
      expect(shouldPersistQuery(q(root))).toBe(false);
    }
    expect(shouldPersistQuery(q('items', 'error'))).toBe(false);
  });
});

describe('offline warm-up', () => {
  it('keeps each photo once, garments and the pieces of looks alike', async () => {
    const { photosToKeep } = await import('@/lib/offline/warmup');
    expect(
      photosToKeep(
        [{ thumbnail_url: '/api/v1/images/u/a.webp' }, { image_url: '/api/v1/images/u/b.webp' }, {}],
        [{ items: [{ thumbnail_url: '/api/v1/images/u/a.webp' }, { thumbnail_url: '/api/v1/images/u/c.webp' }] }, {}]
      )
    ).toEqual(['/api/v1/images/u/a.webp', '/api/v1/images/u/b.webp', '/api/v1/images/u/c.webp']);
  });

  it('runs again only after a while', async () => {
    const { warmupDue, WARMUP_EVERY_MS } = await import('@/lib/offline/warmup');
    localStorage.removeItem('miaurmario.offlineWarmedAt');
    expect(warmupDue()).toBe(true);
    const now = Date.now();
    localStorage.setItem('miaurmario.offlineWarmedAt', String(now));
    expect(warmupDue(now + 1000)).toBe(false);
    expect(warmupDue(now + WARMUP_EVERY_MS + 1)).toBe(true);
  });

  it('asks for the wardrobe exactly as the wardrobe screen does', async () => {
    const { WARDROBE_DEFAULT_FILTERS, WARDROBE_PAGE_SIZE } = await import('@/lib/offline/warmup');
    const { itemsQueryOptions } = await import('@/lib/hooks/use-items');
    const { hashKey } = await import('@tanstack/react-query');
    // What app/dashboard/wardrobe/page.tsx builds with nothing touched.
    const screen = {
      search: undefined,
      type: undefined,
      needs_wash: undefined,
      favorite: undefined,
      is_archived: false,
      sort_by: 'created_at',
      sort_order: 'desc' as const,
    };
    expect(hashKey(itemsQueryOptions(WARDROBE_DEFAULT_FILTERS, 1, WARDROBE_PAGE_SIZE).queryKey)).toBe(
      hashKey(itemsQueryOptions(screen, 1, 20).queryKey)
    );
  });
});

