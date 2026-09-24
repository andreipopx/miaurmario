'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { isStandalone } from '@/lib/pwa/platform';

/**
 * `/` is both the marketing page and the PWA's `start_url`, so people who
 * already use Miaurmario must not land on the sales pitch every time they open
 * the icon on their home screen:
 *   - signed in  → straight to the app;
 *   - installed but signed out → the login page (an installed app showing a
 *     "¿Es una app?" section would be silly).
 * Everyone else — the visitors this page exists for — stay here. Renders
 * nothing, so the landing is fully server-rendered for search engines and link
 * previews either way.
 */
export function LandingRedirect() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
      return;
    }
    if (status === 'unauthenticated' && isStandalone()) {
      router.replace('/login');
    }
  }, [status, router]);

  return null;
}
