'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { startKeyboardTracking } from '@/lib/native/keyboard';
import { recordPop, recordRoute } from '@/lib/native/navigation';
import { routeRendered } from '@/lib/native/view-transition';

/**
 * Renders nothing. Wires the app-wide native-feel plumbing once:
 * keyboard tracking (html[data-keyboard]), in-app history depth for the back
 * button, the "route rendered" signal for view transitions, and
 * html[data-standalone] when running as an installed app.
 */
export function NativeShell() {
  const pathname = usePathname();

  useEffect(() => startKeyboardTracking(), []);

  useEffect(() => {
    const onPop = () => recordPop();
    window.addEventListener('popstate', onPop);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) document.documentElement.dataset.standalone = 'true';

    // Status bar (iOS 'default' style, Android) follows theme-color. The metas are keyed on
    // the *system* scheme; keep them on the app's own theme (next-themes toggles html.dark).
    const root = document.documentElement;
    const syncThemeColor = () => {
      const bg = getComputedStyle(root).getPropertyValue('--background').trim();
      if (!bg) return;
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
        if (m.content !== bg) m.content = bg;
      });
    };
    syncThemeColor();
    const mo = new MutationObserver(syncThemeColor);
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => {
      window.removeEventListener('popstate', onPop);
      mo.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!pathname) return;
    recordRoute(pathname);
    const frame = requestAnimationFrame(() => routeRendered());
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
