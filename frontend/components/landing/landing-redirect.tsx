'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { isStandalone } from '@/lib/pwa/platform';

/**
 * `/` is both the marketing page and the PWA's `start_url`, so people who
 * already use Miaurmario must not land on the sales pitch every time they open
 * the icon on their home screen:
 *   - installed (home-screen PWA or the Android/iOS app) → straight to the
 *     app, which sends anyone signed out to the login page itself (an
 *     installed app showing a "¿Es una app?" section would be silly). Not
 *     waiting for the session also means it works offline, where the session
 *     can't be checked but the saved wardrobe can still be shown;
 *   - signed in → straight to the app.
 * Everyone else — the visitors this page exists for — stay here. Renders
 * nothing, so the landing is fully server-rendered for search engines and link
 * previews either way.
 */
export function LandingRedirect() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated' || isStandalone()) router.replace('/dashboard');
  }, [status, router]);

  return null;
}
