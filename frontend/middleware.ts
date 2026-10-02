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
  // Relative Location: behind the proxies the request URL isn't the public one.
  return new NextResponse(null, {
    status: 307,
    headers: { Location: '/dashboard', 'Cache-Control': 'private, no-store' },
  });
}

export const config = { matcher: '/' };
