'use client';

/**
 * iPhone haptics through a self-dismissing local notification (opt-in experiment).
 *
 * iOS Safari has no Vibration API, and the `<input type="checkbox" switch>` trick in
 * `lib/native/haptics.ts` does nothing on the devices we could test. What *does* buzz an iPhone is
 * the system itself: when iOS renders a notification it plays its own haptic. So, only if the owner
 * asks for it, we show a notification through the service worker and close it again a few hundred
 * milliseconds later — long enough for the system haptic, short enough that nothing is really read.
 *
 * This is a hack and it behaves like one: iOS may still leave a trace in the notification centre,
 * it needs notification permission, and Focus modes or the Lock Screen can swallow it. Hence:
 * off by default, per device (localStorage, not the account), and throttled hard.
 *
 * `haptic()` from `./haptics` stays the primary path; this only ever runs on top of it.
 */

import { prefersReducedMotion } from '@/lib/native/haptics';
import { isIOSUserAgent } from '@/lib/pwa/platform';

/** Fixed tag: every buzz replaces the previous one, so at most one of ours ever exists. */
export const NOTIFICATION_HAPTIC_TAG = 'stinky-haptic';

/** Per-device switch. Deliberately not synced to the account: it is about *this* phone. */
const STORAGE_KEY = 'miaurmario:notification-haptic';

/** At most one buzz every 5 s... */
export const NOTIFICATION_HAPTIC_MIN_GAP_MS = 5_000;
/** ...and never more than this many in a rolling hour. */
export const NOTIFICATION_HAPTIC_MAX_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;
/** How long the notification stays up: enough for the system haptic, short enough to go unread. */
export const NOTIFICATION_HAPTIC_CLOSE_MS = 500;

/** Same assets the push handler in `public/sw.js` uses. */
const ICON = '/icon-192.png';
const BADGE = '/brand/stinky/badge-96.png';
const TITLE = 'Stinky';
const BODY = 'prrr';

/** Whether the toggle should be offered on this device, and in what shape. */
export type NotificationHapticAvailability =
  /** Show the toggle. */
  | 'available'
  /** iPhone, but notifications are not granted: point at Ajustes → Notificaciones instead. */
  | 'needs-permission'
  /** Not an iPhone, or the phone already vibrates properly: show nothing at all. */
  | 'unsupported';

/** What a `notificationHaptic()` call did. */
export type NotificationHapticOutcome =
  | 'shown'
  | 'off'
  | 'hidden'
  | 'throttled'
  | 'reduced-motion'
  | 'unavailable';

// ---- Availability -------------------------------------------------------------

/**
 * Pure decision over the environment. Android (and anything else with the Vibration API) is left
 * strictly alone: `navigator.vibrate` already works there and this hack would only add noise.
 */
export function notificationHapticAvailability(env: {
  hasVibrate: boolean;
  isIOS: boolean;
  hasServiceWorkerRegistration: boolean;
  permission: NotificationPermission | null;
}): NotificationHapticAvailability {
  if (env.hasVibrate) return 'unsupported';
  if (!env.isIOS) return 'unsupported';
  if (!env.hasServiceWorkerRegistration) return 'unsupported';
  if (env.permission === null) return 'unsupported';
  return env.permission === 'granted' ? 'available' : 'needs-permission';
}

/** The app's service worker registration, or null (never throws, never waits on `ready`). */
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    return (await navigator.serviceWorker.getRegistration('/')) ?? null;
  } catch {
    return null;
  }
}

/** `notificationHapticAvailability` for the current browser. */
export async function currentNotificationHapticAvailability(): Promise<NotificationHapticAvailability> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  const registration = await getRegistration();
  return notificationHapticAvailability({
    hasVibrate: typeof navigator.vibrate === 'function',
    isIOS: isIOSUserAgent(navigator.userAgent, navigator.maxTouchPoints || 0),
    hasServiceWorkerRegistration: !!registration,
    permission: typeof Notification !== 'undefined' ? Notification.permission : null,
  });
}

// ---- The per-device setting ---------------------------------------------------

/** Is the experiment on for this device? Off by default, and SSR-safe. */
export function isNotificationHapticEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Turn the experiment on/off for this device. Turning it off closes anything left behind. */
export function setNotificationHapticEnabled(on: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      if (on) window.localStorage.setItem(STORAGE_KEY, '1');
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* private mode / storage disabled: the setting just doesn't stick */
  }
  if (!on) void closeNotificationHaptics();
}

// ---- Throttling ---------------------------------------------------------------

/** Timestamps of the buzzes we fired in the last hour. */
let history: number[] = [];

/** Pure throttle rule: one every {@link NOTIFICATION_HAPTIC_MIN_GAP_MS}, capped per hour. */
export function throttleAllows(at: number, fired: readonly number[]): boolean {
  const recent = fired.filter((t) => at - t < HOUR_MS);
  if (recent.length >= NOTIFICATION_HAPTIC_MAX_PER_HOUR) return false;
  const last = recent[recent.length - 1];
  return last === undefined || at - last >= NOTIFICATION_HAPTIC_MIN_GAP_MS;
}

// ---- Firing and closing -------------------------------------------------------

let closeTimer: ReturnType<typeof setTimeout> | null = null;
let onHidden: (() => void) | null = null;

/** Close on the way out too: a notification must never outlive the tab going to the background. */
function bindVisibility() {
  if (onHidden || typeof document === 'undefined') return;
  onHidden = () => {
    if (document.visibilityState === 'hidden') void closeNotificationHaptics();
  };
  document.addEventListener('visibilitychange', onHidden);
}

function scheduleClose() {
  bindVisibility();
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    void closeNotificationHaptics();
  }, NOTIFICATION_HAPTIC_CLOSE_MS);
}

/** Close every notification carrying our tag. Returns how many there were. */
export async function closeNotificationHaptics(): Promise<number> {
  const registration = await getRegistration();
  if (!registration || typeof registration.getNotifications !== 'function') return 0;
  try {
    const open = await registration.getNotifications({ tag: NOTIFICATION_HAPTIC_TAG });
    for (const notification of open) {
      try {
        notification.close();
      } catch {
        /* already gone */
      }
    }
    return open.length;
  } catch {
    return 0;
  }
}

/**
 * Buzz the phone by flashing a notification, if the owner opted in on this device.
 *
 * Silent and throttled, never while the page is hidden, never with Reduce Motion on, and always
 * under the same tag so it replaces itself instead of stacking. Best-effort: it never throws.
 */
export async function notificationHaptic(
  text: { title?: string; body?: string } = {},
): Promise<NotificationHapticOutcome> {
  if (!isNotificationHapticEnabled()) return 'off';
  if (prefersReducedMotion()) return 'reduced-motion';
  // A notification fired while the app is in the background is just a notification: don't.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'hidden';

  const at = Date.now();
  if (!throttleAllows(at, history)) return 'throttled';
  // Booked before the first await, so two quick pets can't both slip through.
  history = [...history.filter((t) => at - t < HOUR_MS), at];

  const registration = await getRegistration();
  if (!registration || typeof registration.showNotification !== 'function') return 'unavailable';
  try {
    await registration.showNotification(text.title ?? TITLE, {
      body: text.body ?? BODY,
      tag: NOTIFICATION_HAPTIC_TAG,
      silent: true,
      // Never re-alert: the point is the haptic iOS plays when it renders, nothing more.
      renotify: false,
      icon: ICON,
      badge: BADGE,
      data: { url: '/dashboard' },
      // `renotify` is not in every lib.dom NotificationOptions yet.
    } as NotificationOptions & { renotify: boolean });
  } catch {
    return 'unavailable';
  }
  scheduleClose();
  return 'shown';
}

/** Drops the throttle history, the pending close and the listener (tests, teardown). */
export function resetNotificationHaptic(): void {
  history = [];
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  if (onHidden && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onHidden);
  }
  onHidden = null;
}
