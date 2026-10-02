'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { App } from '@capacitor/app';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { SplashScreen } from '@capacitor/splash-screen';
import { hasNativeBridge, nativePlatform } from '@/lib/native/app-shell';
import { androidBackAction, inAppPath } from '@/lib/native/app-links';
import { canGoBackInApp } from '@/lib/native/navigation';

/** Something modal is on top: a Radix dialog/sheet/menu or the photo lightbox. */
function overlayOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], .yarl__container'
  );
}

/** Radix and the lightbox both close on Escape; Android's back means the same. */
function dismissOverlay() {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
  );
}

/**
 * Glue between the site and the Android/iOS app it runs in. Renders nothing,
 * does nothing in a browser.
 *
 * - hides the launch screen once React is up;
 * - matches the status bar icons to the theme;
 * - Android back button: close the open sheet, else go back, else Hoy, else leave;
 * - links the OS hands the app (the magic link in the email, a notification
 *   tap) open on the right screen inside the app.
 */
export function AppBridge() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const { resolvedTheme } = useTheme();
  const t = useTranslations('common');
  // Listeners are registered once; they read the latest values from here.
  const latest = useRef({ router, pathname, t });
  latest.current = { router, pathname, t };

  useEffect(() => {
    if (!hasNativeBridge()) return;
    document.documentElement.dataset.app = nativePlatform() ?? 'native';
    void SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});

    const open = (link: string | null | undefined) => {
      const path = inAppPath(link, window.location.host);
      if (path) latest.current.router.push(path);
    };

    const handles = [
      App.addListener('appUrlOpen', ({ url }) => open(url)),
      App.addListener('backButton', () => {
        const action = androidBackAction({
          pathname: latest.current.pathname,
          overlayOpen: overlayOpen(),
          canGoBack: canGoBackInApp(),
        });
        if (action.kind === 'dismiss') dismissOverlay();
        else if (action.kind === 'history') latest.current.router.back();
        else if (action.kind === 'navigate') latest.current.router.push(action.to);
        else void App.minimizeApp().catch(() => {});
      }),
      // Tapped a notification (also the one that cold-started the app: the
      // plugin holds that event until this listener exists).
      PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) =>
        open((notification.data as { url?: string } | undefined)?.url)
      ),
      // Android doesn't show a notification while the app is open (iOS does,
      // per presentationOptions), so say it in the app instead.
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        if (nativePlatform() !== 'android') return;
        const url = (notification.data as { url?: string } | undefined)?.url;
        toast(notification.title ?? 'Miaurmario', {
          description: notification.body,
          action: url ? { label: latest.current.t('view'), onClick: () => open(url) } : undefined,
        });
      }),
    ];
    return () => {
      handles.forEach((h) => void h.then((l) => l.remove()).catch(() => {}));
    };
  }, []);

  useEffect(() => {
    if (!hasNativeBridge() || !resolvedTheme) return;
    // DARK = light icons on a dark background.
    void SystemBars.setStyle({
      style: resolvedTheme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }).catch(() => {});
  }, [resolvedTheme]);

  return null;
}
