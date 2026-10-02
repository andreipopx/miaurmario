'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { hasNativeBridge, isNativeApp } from '@/lib/native/app-shell';
import {
  disableNativePush,
  enableNativePush,
  nativePushDeliverable,
  nativePushPermission,
  nativePushRegistered,
  resyncNativePush,
} from '@/lib/native/push';
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
  /** Inside the Android/iOS app (native push) rather than a browser (Web Push). */
  native: boolean;
}

/**
 * Push state of *this* device. Never asks for permission by itself.
 *
 * In a browser that's Web Push (VAPID); inside the Android/iOS app it's the
 * OS's own push, which the server can only use for the platforms listed in
 * `nativePlatforms` (the ones it has credentials for).
 */
export function usePushDevice(
  vapidPublicKey: string | null | undefined,
  nativePlatforms?: readonly string[]
) {
  const queryClient = useQueryClient();
  const native = typeof window !== 'undefined' && isNativeApp();
  const deliverable = native && nativePushDeliverable(nativePlatforms);
  const [state, setState] = useState<PushDeviceState>({
    support: null,
    permission: null,
    subscribed: false,
    busy: false,
    native,
  });
  const resynced = useRef(false);

  const refresh = useCallback(async () => {
    if (native) {
      const permission = hasNativeBridge()
        ? await nativePushPermission().catch(() => null)
        : null;
      setState((s) => ({
        ...s,
        native,
        support: deliverable ? 'supported' : 'app-pending',
        permission,
        subscribed: deliverable && nativePushRegistered(),
      }));
      return;
    }
    const support = currentPushSupport();
    const permission = typeof Notification !== 'undefined' ? Notification.permission : null;
    let subscribed = false;
    if (support === 'supported') {
      subscribed = !!(await getCurrentPushSubscription().catch(() => null));
    }
    setState((s) => ({ ...s, native, support, permission, subscribed }));
  }, [native, deliverable]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the server copy of this device's subscription fresh (silent).
  useEffect(() => {
    if (native) {
      if (!deliverable || state.permission !== 'granted' || !hasNativeBridge()) return;
      if (resynced.current) return;
      resynced.current = true;
      resyncNativePush()
        .then((ok) => {
          if (!ok) return;
          void queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
          void refresh();
        })
        .catch(() => {});
      return;
    }
    if (!vapidPublicKey || !state.subscribed) return;
    resyncPushSubscription(vapidPublicKey)
      .then((ok) => {
        if (ok) void queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      })
      .catch(() => {});
    // `refresh` is stable per (native, deliverable), both already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vapidPublicKey, state.subscribed, state.permission, native, deliverable, queryClient]);

  /** Call directly from a tap handler (permission prompt needs the user gesture). */
  const enable = useCallback(async (): Promise<NotificationPermission | 'error'> => {
    if (native ? !deliverable : !vapidPublicKey) return 'error';
    setState((s) => ({ ...s, busy: true }));
    try {
      const permission = native
        ? await enableNativePush()
        : await enablePushOnThisDevice(vapidPublicKey as string);
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      return permission;
    } catch {
      return 'error';
    } finally {
      setState((s) => ({ ...s, busy: false }));
      await refresh();
    }
  }, [native, deliverable, vapidPublicKey, queryClient, refresh]);

  const disable = useCallback(async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      if (native) await disableNativePush();
      else await disablePushOnThisDevice();
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    } finally {
      setState((s) => ({ ...s, busy: false }));
      await refresh();
    }
  }, [native, queryClient, refresh]);

  return { ...state, enable, disable, refresh };
}
