/**
 * Are we running inside the Android/iOS app (the Capacitor shell in /mobile)?
 *
 * The shell loads this same site in a WebView and injects `window.Capacitor`
 * before any page script runs. It also appends `MiaurmarioApp/<n>` to the user
 * agent, which is what the pure, unit-tested helpers here look at, so the
 * answer is the same on the server, in tests and before the bridge is ready.
 */

export type NativePlatform = 'android' | 'ios';

const APP_UA = /MiaurmarioApp\/\d+/;

export function isAppUserAgent(ua: string): boolean {
  return APP_UA.test(ua);
}

export function appPlatformFromUserAgent(ua: string): NativePlatform | null {
  if (!isAppUserAgent(ua)) return null;
  if (/iPhone|iPad|iPod|Macintosh/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return null;
}

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function bridge(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** The current platform when running in the app, null in a browser. */
export function nativePlatform(): NativePlatform | null {
  const cap = bridge();
  if (cap?.isNativePlatform?.()) {
    const p = cap.getPlatform?.();
    if (p === 'android' || p === 'ios') return p;
  }
  if (typeof navigator === 'undefined') return null;
  return appPlatformFromUserAgent(navigator.userAgent);
}

export function isNativeApp(): boolean {
  return nativePlatform() !== null;
}

/** True once the native bridge is there to take plugin calls (not just the UA). */
export function hasNativeBridge(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}
