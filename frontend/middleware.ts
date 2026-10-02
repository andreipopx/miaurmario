import { NextResponse, type NextRequest } from 'next/server';
import { isAppUserAgent } from '@/lib/native/app-shell';

/**
 * "/" is the landing page for visitors. Anyone already signed in goes straight
 * to their wardrobe, decided here before any HTML is sent, so the landing never
 * flashes by on the way (the client-side LandingRedirect stays as the fallback).
 *
 * Not for the Android/iOS app: it opens on /dashboard itself (appStartPath in
 * mobile/capacitor.config.ts) and must never get a redirect for "/", because
 * Android's WebView proxy follows it and serves /dashboard's page as "/".
 *
 * The session cookie is only looked for, not verified: a stale one lands on
 * the dashboard, which sends to login as usual.
 */
const SESSION_COOKIE = /^(__Secure-)?next-auth\.session-token(\.\d+)?$/;

export function middleware(req: NextRequest) {
  if (isAppUserAgent(req.headers.get('user-agent') ?? '')) return NextResponse.next();
  const signedIn = req.cookies.getAll().some((c) => SESSION_COOKIE.test(c.name));
  if (!signedIn) return NextResponse.next();
  const res = NextResponse.redirect(new URL('/dashboard', publicOrigin(req)), 307);
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

/**
 * The origin the visitor used. Next only accepts absolute redirects here, and
 * behind Cloudflare → Caddy → nginx the request URL is the internal one
 * (http://frontend:3000), so take what the proxies forward.
 */
export function publicOrigin(req: NextRequest): string {
  const first = (v: string | null) => v?.split(',')[0]?.trim() || null;
  const host = first(req.headers.get('x-forwarded-host')) ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto = first(req.headers.get('x-forwarded-proto')) ?? req.nextUrl.protocol.replace(/:$/, '');
  return `${proto}://${host}`;
}

export const config = { matcher: '/' };
