import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fallback for the Web Share Target.
 *
 * Normally the service worker answers this POST itself, keeps the shared photo
 * or link in a cache and redirects. This handler only runs when no worker is
 * controlling the page (a freshly installed app, or a browser with the worker
 * unregistered): the payload is gone, so we open the add-garment flow and let
 * the UI say the share did not come through.
 */
export async function POST(request: NextRequest) {
  return NextResponse.redirect(
    new URL('/dashboard/wardrobe?add=1&share_failed=1', request.url),
    303
  );
}

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/dashboard/wardrobe?add=1', request.url), 303);
}
