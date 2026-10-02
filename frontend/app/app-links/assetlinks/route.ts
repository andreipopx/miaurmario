import { NextResponse } from 'next/server';
import { assetLinks, parseFingerprints } from '@/lib/native/app-links-manifest';

// Served at /.well-known/assetlinks.json (see next.config.js). Read per request:
// the fingerprints come from the runtime env, not the build.
export const dynamic = 'force-dynamic';

export function GET() {
  const body = assetLinks(parseFingerprints(process.env.ANDROID_APP_CERT_SHA256));
  if (!body) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
