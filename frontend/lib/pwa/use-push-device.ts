'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { currentPushSupport, type PushSupport } from '@/lib/pwa/platform';
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  getCurrentPushSubscription,
  resyncPushSubscription,
} from '@/lib/pwa/push';

export interface PushDeviceState {
  /** null until checked on the client. */
  support: PushSupport | null;
  permission: NotificationPermission | null;
  /** This browser/device holds a push subscription. */
  subscribed: boolean;
  busy: boolean;
}

/** Web Push state of *this* device. Never asks for permission by itself. */
export function usePushDevice(vapidPublicKey: string | null | undefined) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<PushDeviceState>({
    support: null,
    permission: null,
    subscribed: false,
    busy: false,
  });

  const refresh = useCallback(async () => {
    const support = currentPushSupport();
    const permission = typeof Notification !== 'undefined' ? Notification.permission : null;
    let subscribed = false;
    if (support === 'supported') {
      subscribed = !!(await getCurrentPushSubscription().catch(() => null));
    }
    setState((s) => ({ ...s, support, permission, subscribed }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the server copy of this device's subscription fresh (silent).
  useEffect(() => {
    if (!vapidPublicKey || !state.subscribed) return;
    resyncPushSubscription(vapidPublicKey)
      .then((ok) => {
        if (ok) void queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      })
      .catch(() => {});
  }, [vapidPublicKey, state.subscribed, queryClient]);

  /** Call directly from a tap handler (permission prompt needs the user gesture). */
  const enable = useCallback(async (): Promise<NotificationPermission | 'error'> => {
    if (!vapidPublicKey) return 'error';
    setState((s) => ({ ...s, busy: true }));
    try {
      const permission = await enablePushOnThisDevice(vapidPublicKey);
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      return permission;
    } catch {
      return 'error';
    } finally {
      setState((s) => ({ ...s, busy: false }));
      await refresh();
    }
  }, [vapidPublicKey, queryClient, refresh]);

  const disable = useCallback(async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      await disablePushOnThisDevice();
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    } finally {
      setState((s) => ({ ...s, busy: false }));
      await refresh();
    }
  }, [queryClient, refresh]);

  return { ...state, enable, disable, refresh };
}
