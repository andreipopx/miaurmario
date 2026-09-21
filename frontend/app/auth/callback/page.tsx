'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSession, signIn } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { magicLinkLanding } from '@/lib/magic-link';

// Landing page for the emailed magic link (/auth/callback?token=...).
//
// The token is exchanged client-side through the NextAuth `magic-link`
// credentials provider, which creates the NextAuth JWT session the rest of the
// app relies on (session.accessToken). Doing it from the browser (instead of a
// server GET handler) also means link scanners in mail clients that merely
// fetch the URL cannot burn the single-use token.
function MagicLinkCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    // Tokens are single-use: never submit twice (React strict mode re-runs effects).
    if (started.current) return;
    started.current = true;

    const token = searchParams.get('token');
    const callbackUrl = searchParams.get('callbackUrl');

    // Drop the token from the address bar/history so it doesn't leak via
    // Referer, screenshots or browser sync.
    window.history.replaceState(null, '', '/auth/callback');

    if (!token) {
      router.replace('/login?error=MagicLinkMissing');
      return;
    }

    (async () => {
      try {
        // redirect: false -> we route with relative paths ourselves, so the
        // user stays on the origin they opened the link on.
        const result = await signIn('magic-link', { token, redirect: false });
        if (!result || result.error || !result.ok) {
          router.replace('/login?error=MagicLinkInvalid');
          return;
        }
        const session = await getSession();
        if (!session?.accessToken) {
          router.replace('/login?error=MagicLinkInvalid');
          return;
        }
        router.replace(magicLinkLanding(session, callbackUrl));
      } catch {
        router.replace('/login?error=MagicLinkInvalid');
      }
    })();
  }, [router, searchParams]);

  return null;
}

export default function MagicLinkCallbackPage() {
  const t = useTranslations('login.magicLink');
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="font-editorial italic text-muted-foreground">{t('verifying')}</p>
      </div>
      <Suspense fallback={null}>
        <MagicLinkCallback />
      </Suspense>
    </main>
  );
}
