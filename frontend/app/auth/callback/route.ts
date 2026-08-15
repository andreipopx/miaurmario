import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://wardrobe_nginx:80';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing_token', request.url));
  }

  const backendUrl = `${BACKEND_URL.replace(/\/$/, '')}/api/v1/auth/magic-link/consume?token=${encodeURIComponent(token)}`;

  let upstream: Response;
  try {
    upstream = await fetch(backendUrl, { redirect: 'manual' });
  } catch (err) {
    return NextResponse.redirect(new URL('/login?error=backend_unreachable', request.url));
  }

  if (upstream.status !== 302) {
    return NextResponse.redirect(new URL('/login?error=invalid_link', request.url));
  }

  const location = upstream.headers.get('location') || '/dashboard';
  const setCookie = upstream.headers.get('set-cookie');

  const dest = location.startsWith('http') ? location : new URL(location, request.url).toString();
  const resp = NextResponse.redirect(dest);
  if (setCookie) {
    resp.headers.append('set-cookie', setCookie);
  }
  return resp;
}
