import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NOTIFICATION_HAPTIC_CLOSE_MS,
  NOTIFICATION_HAPTIC_MAX_PER_HOUR,
  NOTIFICATION_HAPTIC_MIN_GAP_MS,
  NOTIFICATION_HAPTIC_TAG,
  closeNotificationHaptics,
  currentNotificationHapticAvailability,
  isNotificationHapticEnabled,
  notificationHaptic,
  notificationHapticAvailability,
  resetNotificationHaptic,
  setNotificationHapticEnabled,
  throttleAllows,
} from '@/lib/native/notification-haptic';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/122 Mobile Safari/537.36';

/** A stand-in for ServiceWorkerRegistration: one live notification per tag, like the real thing. */
function fakeRegistration() {
  const live = new Map<string, { tag: string; close: ReturnType<typeof vi.fn> }>();
  const closed: string[] = [];
  const showNotification = vi.fn(async (_title: string, options?: NotificationOptions) => {
    const tag = options?.tag ?? '';
    // A second notification with the same tag replaces the first one.
    live.set(tag, {
      tag,
      close: vi.fn(() => {
        closed.push(tag);
        live.delete(tag);
      }),
    });
  });
  const getNotifications = vi.fn(async (filter?: { tag?: string }) =>
    Array.from(live.values()).filter((n) => !filter?.tag || n.tag === filter.tag),
  );
  return { registration: { showNotification, getNotifications }, live, closed };
}

function installServiceWorker(registration: unknown | null) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: { getRegistration: vi.fn(async () => registration ?? undefined) },
  });
}

function removeServiceWorker() {
  // @ts-expect-error -- jsdom lets us drop the property again
  delete navigator.serviceWorker;
}

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, writable: true, value: ua });
}

function setPermission(permission: NotificationPermission | null) {
  if (permission === null) {
    vi.stubGlobal('Notification', undefined);
    return;
  }
  vi.stubGlobal('Notification', { permission });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    writable: true,
    value: state,
  });
}

function removeVibrate() {
  // @ts-expect-error -- jsdom has no vibrate, but other specs may have installed one
  delete navigator.vibrate;
}

const originalUA = navigator.userAgent;

describe('notificationHapticAvailability', () => {
  const ios = { hasVibrate: false, isIOS: true, hasServiceWorkerRegistration: true, permission: 'granted' as const };

  it('offers the toggle on an iPhone with notifications granted', () => {
    expect(notificationHapticAvailability(ios)).toBe('available');
  });

  it('leaves Android alone: the Vibration API already works there', () => {
    expect(notificationHapticAvailability({ ...ios, hasVibrate: true, isIOS: false })).toBe('unsupported');
    // Even a (hypothetical) iOS browser with vibrate support stays out of the experiment.
    expect(notificationHapticAvailability({ ...ios, hasVibrate: true })).toBe('unsupported');
  });

  it('hides everything off iOS, without a service worker, or without the Notification API', () => {
    expect(notificationHapticAvailability({ ...ios, isIOS: false })).toBe('unsupported');
    expect(notificationHapticAvailability({ ...ios, hasServiceWorkerRegistration: false })).toBe('unsupported');
    expect(notificationHapticAvailability({ ...ios, permission: null })).toBe('unsupported');
  });

  it('asks for notification permission first when it is not granted', () => {
    expect(notificationHapticAvailability({ ...ios, permission: 'default' })).toBe('needs-permission');
    expect(notificationHapticAvailability({ ...ios, permission: 'denied' })).toBe('needs-permission');
  });
});

describe('throttleAllows', () => {
  it('allows the first buzz', () => {
    expect(throttleAllows(1_000, [])).toBe(true);
  });

  it('blocks a second buzz inside the minimum gap', () => {
    expect(throttleAllows(1_000 + NOTIFICATION_HAPTIC_MIN_GAP_MS - 1, [1_000])).toBe(false);
    expect(throttleAllows(1_000 + NOTIFICATION_HAPTIC_MIN_GAP_MS, [1_000])).toBe(true);
  });

  it('caps the hour', () => {
    const spaced = Array.from({ length: NOTIFICATION_HAPTIC_MAX_PER_HOUR }, (_, i) => i * 60_000);
    const at = NOTIFICATION_HAPTIC_MAX_PER_HOUR * 60_000;
    expect(throttleAllows(at, spaced)).toBe(false);
    // ...but the window rolls: once the oldest one is over an hour old there is room again.
    expect(throttleAllows(spaced[0] + 60 * 60 * 1000 + 1, spaced)).toBe(true);
  });
});

describe('the per-device setting', () => {
  beforeEach(() => {
    window.localStorage.clear();
    installServiceWorker(fakeRegistration().registration);
  });
  afterEach(() => {
    window.localStorage.clear();
    removeServiceWorker();
  });

  it('is off by default and survives a round trip', () => {
    expect(isNotificationHapticEnabled()).toBe(false);
    setNotificationHapticEnabled(true);
    expect(isNotificationHapticEnabled()).toBe(true);
    setNotificationHapticEnabled(false);
    expect(isNotificationHapticEnabled()).toBe(false);
  });

  it('closes anything left over when it is switched off', async () => {
    const { registration, live } = fakeRegistration();
    installServiceWorker(registration);
    await registration.showNotification('Stinky', { tag: NOTIFICATION_HAPTIC_TAG });
    expect(live.size).toBe(1);

    setNotificationHapticEnabled(false);
    await vi.waitFor(() => expect(live.size).toBe(0));
    expect(registration.getNotifications).toHaveBeenCalledWith({ tag: NOTIFICATION_HAPTIC_TAG });
  });
});

describe('currentNotificationHapticAvailability', () => {
  beforeEach(() => {
    removeVibrate();
    setPermission('granted');
  });
  afterEach(() => {
    setUserAgent(originalUA);
    vi.unstubAllGlobals();
    removeServiceWorker();
  });

  it('is available on an installed iPhone with a registration and permission', async () => {
    setUserAgent(IPHONE_UA);
    installServiceWorker(fakeRegistration().registration);
    await expect(currentNotificationHapticAvailability()).resolves.toBe('available');
  });

  it('is unsupported without a service worker registration', async () => {
    setUserAgent(IPHONE_UA);
    installServiceWorker(null);
    await expect(currentNotificationHapticAvailability()).resolves.toBe('unsupported');
  });

  it('is unsupported on Android', async () => {
    setUserAgent(ANDROID_UA);
    installServiceWorker(fakeRegistration().registration);
    await expect(currentNotificationHapticAvailability()).resolves.toBe('unsupported');
  });

  it('asks for permission when it has not been granted', async () => {
    setUserAgent(IPHONE_UA);
    setPermission('default');
    installServiceWorker(fakeRegistration().registration);
    await expect(currentNotificationHapticAvailability()).resolves.toBe('needs-permission');
  });
});

describe('notificationHaptic', () => {
  let fake: ReturnType<typeof fakeRegistration>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetNotificationHaptic();
    window.localStorage.clear();
    fake = fakeRegistration();
    installServiceWorker(fake.registration);
    setUserAgent(IPHONE_UA);
    setPermission('granted');
    setVisibility('visible');
    setNotificationHapticEnabled(true);
  });

  afterEach(() => {
    resetNotificationHaptic();
    vi.useRealTimers();
    window.localStorage.clear();
    removeServiceWorker();
    setUserAgent(originalUA);
    vi.unstubAllGlobals();
  });

  it('does nothing at all while the setting is off', async () => {
    setNotificationHapticEnabled(false);
    await expect(notificationHaptic()).resolves.toBe('off');
    expect(fake.registration.showNotification).not.toHaveBeenCalled();
  });

  it('does nothing while the page is hidden', async () => {
    setVisibility('hidden');
    await expect(notificationHaptic()).resolves.toBe('hidden');
    expect(fake.registration.showNotification).not.toHaveBeenCalled();
  });

  it('shows a silent, tagged, non-renotifying notification', async () => {
    await expect(notificationHaptic()).resolves.toBe('shown');
    expect(fake.registration.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = fake.registration.showNotification.mock.calls[0];
    expect(title).toBe('Stinky');
    expect(options).toMatchObject({
      body: 'prrr',
      tag: NOTIFICATION_HAPTIC_TAG,
      silent: true,
      renotify: false,
    });
    expect(options?.icon).toBeTruthy();
    expect(options?.badge).toBeTruthy();
  });

  it('closes it again shortly afterwards', async () => {
    await notificationHaptic();
    expect(fake.live.size).toBe(1);
    await vi.advanceTimersByTimeAsync(NOTIFICATION_HAPTIC_CLOSE_MS + 50);
    expect(fake.registration.getNotifications).toHaveBeenCalledWith({ tag: NOTIFICATION_HAPTIC_TAG });
    expect(fake.closed).toEqual([NOTIFICATION_HAPTIC_TAG]);
    expect(fake.live.size).toBe(0);
  });

  it('closes it when the page goes away', async () => {
    await notificationHaptic();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    // No timer involved: just let the close promise settle.
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.live.size).toBe(0);
  });

  it('reuses the same tag, so buzzes replace each other instead of stacking', async () => {
    await notificationHaptic();
    await vi.advanceTimersByTimeAsync(NOTIFICATION_HAPTIC_MIN_GAP_MS);
    await expect(notificationHaptic()).resolves.toBe('shown');
    const tags = fake.registration.showNotification.mock.calls.map(([, options]) => options?.tag);
    expect(tags).toEqual([NOTIFICATION_HAPTIC_TAG, NOTIFICATION_HAPTIC_TAG]);
    expect(fake.live.size).toBe(1);
  });

  it('throttles to one every few seconds', async () => {
    await expect(notificationHaptic()).resolves.toBe('shown');
    await expect(notificationHaptic()).resolves.toBe('throttled');
    await vi.advanceTimersByTimeAsync(NOTIFICATION_HAPTIC_MIN_GAP_MS - 100);
    await expect(notificationHaptic()).resolves.toBe('throttled');
    await vi.advanceTimersByTimeAsync(200);
    await expect(notificationHaptic()).resolves.toBe('shown');
    expect(fake.registration.showNotification).toHaveBeenCalledTimes(2);
  });

  it('never fires more than the hourly cap', async () => {
    for (let i = 0; i < NOTIFICATION_HAPTIC_MAX_PER_HOUR; i++) {
      await expect(notificationHaptic()).resolves.toBe('shown');
      await vi.advanceTimersByTimeAsync(NOTIFICATION_HAPTIC_MIN_GAP_MS);
    }
    await expect(notificationHaptic()).resolves.toBe('throttled');
    expect(fake.registration.showNotification).toHaveBeenCalledTimes(NOTIFICATION_HAPTIC_MAX_PER_HOUR);

    // An hour later there is room again.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await expect(notificationHaptic()).resolves.toBe('shown');
  });

  it('reports back when there is no usable registration', async () => {
    installServiceWorker(null);
    await expect(notificationHaptic()).resolves.toBe('unavailable');
  });
});

describe('closeNotificationHaptics', () => {
  afterEach(() => removeServiceWorker());

  it('is a no-op without a service worker', async () => {
    removeServiceWorker();
    await expect(closeNotificationHaptics()).resolves.toBe(0);
  });

  it('closes only our tag', async () => {
    const { registration, live } = fakeRegistration();
    installServiceWorker(registration);
    await registration.showNotification('Stinky', { tag: NOTIFICATION_HAPTIC_TAG });
    await registration.showNotification('Otra cosa', { tag: 'daily-digest' });

    await expect(closeNotificationHaptics()).resolves.toBe(1);
    expect(Array.from(live.keys())).toEqual(['daily-digest']);
  });
});
