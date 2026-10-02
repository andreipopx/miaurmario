/**
 * Pure helpers for the Android/iOS app shell (see components/native/app-bridge.tsx):
 * which links belong inside the app, and what Android's back button should do.
 */

import { isTabRoute, parentPath } from '@/lib/native/navigation';

/**
 * The in-app path for a link the OS handed to the app (a magic link from the
 * email, a notification's `url`), or null when it isn't ours to open.
 * Relative paths are taken as they are; absolute ones only on `appHost`.
 */
export function inAppPath(link: string | null | undefined, appHost: string): string | null {
  if (!link || typeof link !== 'string') return null;
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.host !== appHost) return null;
    return `${url.pathname}${url.search}${url.hash}` || '/';
  } catch {
    return null;
  }
}

export type BackAction =
  | { kind: 'dismiss' }
  | { kind: 'history' }
  | { kind: 'navigate'; to: string }
  | { kind: 'minimize' };

/**
 * Android's system back, the way an app does it: close what's on top first;
 * from Hoy (or any screen outside the app proper) leave; from another tab go
 * to Hoy; inside a section walk back through the screens, or up a level when
 * the screen was opened from a link.
 */
export function androidBackAction(state: {
  pathname: string;
  overlayOpen: boolean;
  canGoBack: boolean;
}): BackAction {
  const { pathname } = state;
  if (state.overlayOpen) return { kind: 'dismiss' };
  if (pathname === '/dashboard' || !pathname.startsWith('/dashboard')) return { kind: 'minimize' };
  if (isTabRoute(pathname)) return { kind: 'navigate', to: '/dashboard' };
  if (state.canGoBack) return { kind: 'history' };
  return { kind: 'navigate', to: parentPath(pathname) };
}
