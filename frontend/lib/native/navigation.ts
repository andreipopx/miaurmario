'use client';

import { TOP_LEVEL_PATHS } from '@/components/nav-items';

/**
 * In-app navigation helpers for the installed PWA. iOS standalone has no browser
 * back button, so every non-tab screen gets an in-app one (see Header); it goes
 * back through history when we got here from inside the app, otherwise up to
 * the parent route (deep link / cold start / reload).
 */

let inAppDepth = 0;
let popPending = false;
let lastPath: string | null = null;

/** Called by NativeShell on every pathname change. */
export function recordRoute(pathname: string) {
  if (lastPath !== null && pathname !== lastPath) {
    inAppDepth = popPending ? Math.max(0, inAppDepth - 1) : inAppDepth + 1;
  }
  popPending = false;
  lastPath = pathname;
}

/** Called on `popstate` (browser/system back or forward). */
export function recordPop() {
  popPending = true;
}

export function canGoBackInApp(): boolean {
  return inAppDepth > 0;
}

/** Dock sections and their in-section tabs (Looks, Música…) are top level: no back button. */
export function isTabRoute(pathname: string): boolean {
  return TOP_LEVEL_PATHS.has(pathname);
}

/** Screens that draw their own back/cancel control in-page. */
const OWN_BACK = [/^\/dashboard\/outfits\/new$/];

export function needsAppBack(pathname: string): boolean {
  if (!pathname.startsWith('/dashboard')) return false;
  return !isTabRoute(pathname) && !OWN_BACK.some((re) => re.test(pathname));
}

const PARENT_OVERRIDES: Record<string, string> = {
  '/dashboard/family/feed': '/dashboard/friends',
};

/** Where "back" goes when there is no in-app history. */
export function parentPath(pathname: string): string {
  if (PARENT_OVERRIDES[pathname]) return PARENT_OVERRIDES[pathname];
  const parts = pathname.replace(/\/+$/, '').split('/');
  parts.pop();
  const parent = parts.join('/') || '/';
  return parent.startsWith('/dashboard') ? parent : '/dashboard';
}
