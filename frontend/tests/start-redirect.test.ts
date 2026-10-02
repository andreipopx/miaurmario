// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { launchWaitsFor } from '@/lib/native/launch';

const APP_UA = 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/140.0 Mobile Safari/537.36 MiaurmarioApp/1';
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36';

function hit(headers: Record<string, string>) {
  return middleware(new NextRequest('http://frontend:3000/', { headers }));
}

describe('opening "/"', () => {
  it('a visitor gets the landing page', () => {
    const res = hit({ 'user-agent': BROWSER_UA });
    expect(res.headers.get('location')).toBeNull();
  });

  it('the app never gets a redirect (it opens on /dashboard by itself)', () => {
    const res = hit({ 'user-agent': APP_UA, cookie: '__Secure-next-auth.session-token=x' });
    expect(res.headers.get('location')).toBeNull();
  });

  it('anyone signed in goes straight to the wardrobe, whatever the cookie is called', () => {
    for (const name of [
      '__Secure-next-auth.session-token',
      'next-auth.session-token',
      '__Secure-next-auth.session-token.0',
    ]) {
      const res = hit({ 'user-agent': BROWSER_UA, cookie: `${name}=x` });
      expect(res.status).toBe(307);
      // Relative, so the proxies' internal host never leaks into the redirect.
      expect(res.headers.get('location')).toBe('/dashboard');
    }
  });

  it('other next-auth cookies are not a session', () => {
    const res = hit({ 'user-agent': BROWSER_UA, cookie: '__Host-next-auth.csrf-token=x' });
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('the launch screen', () => {
  it('waits only on the screens the app passes through', () => {
    expect(launchWaitsFor('/')).toBe(true);
    expect(launchWaitsFor('/dashboard')).toBe(true);
    expect(launchWaitsFor('/dashboard/wardrobe')).toBe(true);
    expect(launchWaitsFor('/login')).toBe(false);
    expect(launchWaitsFor('/auth/callback')).toBe(false);
    expect(launchWaitsFor('/onboarding')).toBe(false);
  });
});
