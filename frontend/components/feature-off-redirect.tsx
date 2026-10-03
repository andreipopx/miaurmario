'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Stands in for a page whose feature is switched off in lib/features.ts: the
 * route keeps existing (old links, bookmarks, the native app) and quietly moves
 * you on to `to` instead of showing a screen we have hidden on purpose.
 */
export function FeatureOffRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
