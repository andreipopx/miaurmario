'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { api, setAccessToken } from '@/lib/api';
import type { NotificationPreferences } from '@/lib/hooks/use-notifications';
import { getCurrentPushSubscription, resyncPushSubscription } from '@/lib/pwa/push';

const SYNCED_KEY = 'mm-push-synced';

/**
 * Once per app session, re-send this device's push subscription if it has one:
 * browsers rotate subscriptions (pushsubscriptionchange) and the server prunes
 * dead ones. No permission prompt, no request at all when push isn't granted.
 */
export function PushSync() {
  const { data: session } = useSession();
  const token = session?.accessToken as string | undefined;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        setAccessToken(token);
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        if (window.sessionStorage.getItem(SYNCED_KEY)) return;
        const sub = await getCurrentPushSubscription();
        if (!sub || cancelled) return;
        const prefs = await api.get<NotificationPreferences>('/notifications/preferences');
        if (cancelled || !prefs.vapid_public_key) return;
        await resyncPushSubscription(prefs.vapid_public_key);
        window.sessionStorage.setItem(SYNCED_KEY, '1');
      } catch {
        /* best effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);
  return null;
}
