'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOnline } from '@/lib/hooks/use-online';
import { isStandalone } from '@/lib/pwa/platform';
import { warmOfflineData, warmupDue } from '@/lib/offline/warmup';

let running = false;

/**
 * Installed app, online and signed in: every few hours, keep the wardrobe,
 * the looks and their photos on the phone for when there's no connection.
 * A browser tab doesn't (see lib/offline/warmup.ts).
 */
export function OfflineWarmup({ signedIn }: { signedIn: boolean }) {
  const queryClient = useQueryClient();
  const online = useOnline();

  useEffect(() => {
    if (!signedIn || !online || running || !isStandalone() || !warmupDue()) return;
    running = true;
    // Let the screen the user opened load first.
    const timer = window.setTimeout(() => {
      void warmOfflineData(queryClient)
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      running = false;
    };
  }, [signedIn, online, queryClient]);

  return null;
}
