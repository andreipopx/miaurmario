'use client';

/**
 * Push notifications inside the Android/iOS app.
 *
 * The app's WebView has no Web Push, so here the OS issues a token (FCM on
 * Android, APNs on iPhone) through @capacitor/push-notifications and the
 * server pushes to that instead. Same toggles, same "Este dispositivo" card.
 */

import { App } from '@capacitor/app';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from '@/lib/api';
import { nativePlatform, type NativePlatform } from '@/lib/native/app-shell';

const TOKEN_KEY = 'miaurmario.nativePushToken';
// Set when the user turns this device off, so the silent resync on the next
// launch doesn't quietly turn it back on while the OS permission stays granted.
const OPT_OUT_KEY = 'miaurmario.nativePushOff';
const REGISTER_TIMEOUT_MS = 15_000;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: we just re-register next time */
  }
}

function setOptedOut(off: boolean) {
  try {
    if (off) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* see writeToken */
  }
}

function optedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

/** This install is registered with the server (as far as this phone knows). */
export function nativePushRegistered(): boolean {
  return !!readToken() && !optedOut();
}

/** The token this install last handed to the server, if any. */
export function storedNativePushToken(): string | null {
  return readToken();
}

/** Can the server reach this install? (Its platform's credentials are configured.) */
export function nativePushDeliverable(platforms: readonly string[] | undefined): boolean {
  const platform = nativePlatform();
  return !!platform && !!platforms?.includes(platform);
}

/** The OS permission, in the Notification API's words. */
export async function nativePushPermission(): Promise<NotificationPermission> {
  const { receive } = await PushNotifications.checkPermissions();
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'default';
}

/** Ask the OS for a token and wait for it (it arrives as an event). */
function obtainToken(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const handles: Promise<{ remove: () => Promise<void> }>[] = [];
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handles.forEach((h) => void h.then((l) => l.remove()).catch(() => {}));
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('push registration timed out'))),
      REGISTER_TIMEOUT_MS
    );
    handles.push(
      PushNotifications.addListener('registration', (t) => finish(() => resolve(t.value))),
      PushNotifications.addListener('registrationError', (e) =>
        finish(() => reject(new Error(e.error)))
      )
    );
    PushNotifications.register().catch((err) => finish(() => reject(err)));
  });
}

async function appVersion(): Promise<string | undefined> {
  try {
    const info = await App.getInfo();
    return `${info.version} (${info.build})`.slice(0, 40);
  } catch {
    return undefined;
  }
}

async function sendToken(platform: NativePlatform, token: string) {
  await api.post('/notifications/push/native/register', {
    platform,
    token,
    app_version: await appVersion(),
  });
  writeToken(token);
}

/**
 * Ask permission (if not decided yet) and register this install. Call it from
 * a tap: Android 13+ and iOS show their prompt only once, so it should mean
 * something when it appears.
 */
export async function enableNativePush(): Promise<NotificationPermission> {
  const platform = nativePlatform();
  if (!platform) return 'denied';
  let { receive } = await PushNotifications.checkPermissions();
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive !== 'granted') return 'denied';
  await sendToken(platform, await obtainToken());
  setOptedOut(false);
  return 'granted';
}

/**
 * Stop pushes to this install (server first, so a failed OS call can't leave
 * it subscribed). `optOut` remembers that the user chose this; signing out
 * doesn't, so the next account to sign in gets alerts without asking again.
 */
export async function disableNativePush({ optOut = true }: { optOut?: boolean } = {}): Promise<void> {
  if (optOut) setOptedOut(true);
  const token = readToken();
  if (token) {
    await api.post('/notifications/push/native/unregister', { token }).catch(() => {});
  }
  writeToken(null);
  await PushNotifications.unregister().catch(() => {});
}

/**
 * Re-send this install's token without prompting (the OS may have rotated it,
 * or another account signed in on this phone). Only when already granted.
 */
export async function resyncNativePush(): Promise<boolean> {
  const platform = nativePlatform();
  if (!platform || optedOut()) return false;
  if ((await nativePushPermission()) !== 'granted') return false;
  await sendToken(platform, await obtainToken());
  return true;
}

/** On sign-out: this phone shouldn't keep getting the previous account's alerts. */
export async function forgetNativePushDevice(): Promise<void> {
  if (!nativePlatform() || !readToken()) return;
  await Promise.race([
    disableNativePush({ optOut: false }),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
}
