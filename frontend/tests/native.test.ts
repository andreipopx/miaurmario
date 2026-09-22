import { describe, expect, it } from 'vitest';
import { canGoBackInApp, needsAppBack, parentPath, recordPop, recordRoute } from '@/lib/native/navigation';

describe('native navigation', () => {
  it('shows the in-app back button everywhere except the dock tabs and screens with their own', () => {
    expect(needsAppBack('/dashboard')).toBe(false);
    expect(needsAppBack('/dashboard/wardrobe')).toBe(false);
    expect(needsAppBack('/dashboard/suggest')).toBe(false);
    expect(needsAppBack('/dashboard/friends')).toBe(false);
    expect(needsAppBack('/dashboard/outfits/new')).toBe(false);
    expect(needsAppBack('/dashboard/music')).toBe(true);
    expect(needsAppBack('/dashboard/outfits/abc')).toBe(true);
    expect(needsAppBack('/dashboard/friends/stinky')).toBe(true);
    expect(needsAppBack('/dashboard/settings/integrations/spotify')).toBe(true);
    expect(needsAppBack('/login')).toBe(false);
  });

  it('falls back to the parent route', () => {
    expect(parentPath('/dashboard/music')).toBe('/dashboard');
    expect(parentPath('/dashboard/outfits/abc')).toBe('/dashboard/outfits');
    expect(parentPath('/dashboard/settings/integrations/spotify')).toBe('/dashboard/settings/integrations');
    expect(parentPath('/dashboard/family/feed')).toBe('/dashboard');
  });

  it('only goes back through history after an in-app navigation', () => {
    recordRoute('/dashboard/music'); // cold start / deep link
    expect(canGoBackInApp()).toBe(false);
    recordRoute('/dashboard/settings');
    expect(canGoBackInApp()).toBe(true);
    recordPop();
    recordRoute('/dashboard/music');
    expect(canGoBackInApp()).toBe(false);
  });
});
