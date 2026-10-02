import { NextResponse } from 'next/server';
import { appleAppSiteAssociation } from '@/lib/native/app-links-manifest';

// Served at /.well-known/apple-app-site-association (see next.config.js). Apple
// fetches it through its CDN and wants application/json with no redirect.
export const dynamic = 'force-dynamic';

export function GET() {
  const body = appleAppSiteAssociation(process.env.APPLE_TEAM_ID);
  if (!body) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
