'use client';

import { api } from '@/lib/api';

/** VAPID public key (base64url) -> the BufferSource PushManager.subscribe wants. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  return x.every((v, i) => v === b[i]);
}

/** The app's service worker registration (registers it in dev, where sw-register skips it). */
async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) {
    await navigator.serviceWorker.register('/sw.js?v=dev', { updateViaCache: 'none' });
  }
  return navigator.serviceWorker.ready;
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg || !('pushManager' in reg)) return null;
  return reg.pushManager.getSubscription();
}

async function sendToBackend(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await api.post('/notifications/push/subscribe', {
    endpoint: json.endpoint,
    keys: json.keys,
    user_agent: navigator.userAgent,
  });
}

/**
 * Ask for permission and subscribe this device. MUST be called straight from a
 * tap handler: Safari (and Chrome's quieter UI) only honour requestPermission()
 * inside a user gesture, so nothing is awaited before it.
 */
export async function enablePushOnThisDevice(
  vapidPublicKey: string,
): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;

  const key = urlBase64ToUint8Array(vapidPublicKey);
  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    // Subscribed with an older VAPID key: that subscription can't be used anymore.
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  await sendToBackend(sub);
  return permission;
}

export async function disablePushOnThisDevice(): Promise<void> {
  const sub = await getCurrentPushSubscription();
  if (!sub) return;
  await api.post('/notifications/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/**
 * Re-send this device's subscription (the browser may have rotated it, or the
 * server pruned it). Silent, no permission prompt: only runs when already granted.
 */
export async function resyncPushSubscription(vapidPublicKey: string): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const sub = await getCurrentPushSubscription();
  if (!sub) return false;
  if (!sameKey(sub.options.applicationServerKey, urlBase64ToUint8Array(vapidPublicKey))) {
    return false;
  }
  await sendToBackend(sub);
  return true;
}
