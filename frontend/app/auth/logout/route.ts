import { NextResponse } from 'next/server';
import { getRequestOrigin } from '@/lib/request-origin';

export async function GET(request: Request) {
  // Use the origin the browser is on (LAN or public), not a fixed NEXTAUTH_URL,
  // so logging out never bounces the user to the other hostname.
  const appUrl = getRequestOrigin(request.headers);
  const endSessionUrl = process.env.OIDC_END_SESSION_URL;
  const tinyAuthUrl = process.env.TINYAUTH_URL;

  let logoutUrl: string;

  if (endSessionUrl) {
    logoutUrl = `${endSessionUrl}?post_logout_redirect_uri=${encodeURIComponent(appUrl + '/login')}`;
  } else if (tinyAuthUrl) {
    logoutUrl = `${tinyAuthUrl}/logout?redirect_uri=${encodeURIComponent(appUrl)}`;
  } else {
    logoutUrl = `${appUrl}/login`;
  }

  const signOutUrl = `${appUrl}/api/auth/signout?callbackUrl=${encodeURIComponent(logoutUrl)}`;

  return NextResponse.redirect(signOutUrl);
}
