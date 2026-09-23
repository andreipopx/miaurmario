/**
 * Platform detection for the install guide and Web Push.
 *
 * Pure functions over the user agent (unit-tested) plus thin browser wrappers.
 */

export type InstallPlatform = 'ios' | 'android-chrome' | 'huawei' | 'android-other' | 'desktop';

export const INSTALL_PLATFORMS: InstallPlatform[] = [
  'ios',
  'android-chrome',
  'huawei',
  'android-other',
  'desktop',
];

export function isIOSUserAgent(ua: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports itself as a Mac; only real iPads have a touch screen.
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

export function detectPlatform(ua: string, maxTouchPoints = 0): InstallPlatform {
  if (isIOSUserAgent(ua, maxTouchPoints)) return 'ios';
  if (/HuaweiBrowser|HBPC\/|HMSCore/i.test(ua)) return 'huawei';
  if (/Android/i.test(ua)) {
    const otherBrowser =
      /SamsungBrowser|EdgA|OPR\/|Opera|Firefox|FxiOS|MiuiBrowser|XiaoMi|YaBrowser|UCBrowser|DuckDuckGo|; wv\)/i;
    if (/Chrome\//.test(ua) && !otherBrowser.test(ua)) return 'android-chrome';
    return 'android-other';
  }
  return 'desktop';
}

export function isMobilePlatform(platform: InstallPlatform): boolean {
  return platform !== 'desktop';
}

/** iOS major.minor from the UA ("OS 16_4 like Mac OS X"), null if not iOS / unknown. */
export function iosVersion(ua: string): [number, number] | null {
  const m = ua.match(/OS (\d+)[_.](\d+)(?:[_.]\d+)? like Mac OS X/i);
  if (!m) {
    // iPadOS desktop UA: "Version/17.4 Safari"
    const v = ua.match(/Version\/(\d+)\.(\d+)/);
    return v && /Macintosh/i.test(ua) ? [Number(v[1]), Number(v[2])] : null;
  }
  return [Number(m[1]), Number(m[2])];
}

/** Web Push on iOS needs 16.4+ and the app opened from the home-screen icon. */
export function iosSupportsWebPush(ua: string): boolean {
  const v = iosVersion(ua);
  if (!v) return true; // unknown: let feature detection decide
  return v[0] > 16 || (v[0] === 16 && v[1] >= 4);
}

/**
 * Web Share Target: can the system share sheet send a photo or a link straight
 * into the installed app? Android Chromium and installed desktop PWAs can.
 * iOS has no share target at all, and Firefox does not implement one, so there
 * the UI says to paste the link or pick the photo instead.
 */
export function supportsShareTarget(ua: string, maxTouchPoints = 0): boolean {
  if (isIOSUserAgent(ua, maxTouchPoints)) return false;
  return !/Firefox|FxiOS/i.test(ua);
}

// ---- Browser wrappers ---------------------------------------------------------

export function currentPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints || 0);
}

/** Running as an installed app (home-screen icon / installed PWA window). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const mq = typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches
    : false;
  return iosStandalone || mq;
}

export type PushSupport =
  /** Web Push works here: show the enable button. */
  | 'supported'
  /** iPhone/iPad in a normal Safari tab: must install to the home screen first. */
  | 'needs-install'
  /** iOS older than 16.4. */
  | 'ios-too-old'
  /** Browser without Push API (in-app browsers, old browsers...). */
  | 'unsupported';

export function pushSupport(
  env: {
    ua: string;
    maxTouchPoints?: number;
    standalone: boolean;
    hasServiceWorker: boolean;
    hasPushManager: boolean;
    hasNotification: boolean;
  },
): PushSupport {
  const ios = isIOSUserAgent(env.ua, env.maxTouchPoints ?? 0);
  if (ios && !iosSupportsWebPush(env.ua)) return 'ios-too-old';
  if (ios && !env.standalone) return 'needs-install';
  if (env.hasServiceWorker && env.hasPushManager && env.hasNotification) return 'supported';
  return 'unsupported';
}

export function currentPushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  return pushSupport({
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    standalone: isStandalone(),
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
  });
}
