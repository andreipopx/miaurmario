'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSession, signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { magicLinkLanding } from '@/lib/magic-link';
import { Stinky } from '@/components/stinky/stinky';
import { Wordmark } from '@/components/brand/wordmark';

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
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="flex flex-col items-center gap-5 text-center" role="status" aria-live="polite">
        <Wordmark className="text-[28px]" />
        <div className="flex h-36 w-36 items-center justify-center rounded-full bg-signature-soft">
          <Stinky state="thinking" size={120} label="" />
        </div>
        <p className="text-[15px] font-semibold text-muted-foreground">{t('verifying')}</p>
      </div>
      <Suspense fallback={null}>
        <MagicLinkCallback />
      </Suspense>
    </main>
  );
}
