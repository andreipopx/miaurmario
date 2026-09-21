'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
const CHECK_EVERY_MS = 30 * 60 * 1000;

export function ServiceWorkerRegister() {
  const t = useTranslations('pwa');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    let registration: ServiceWorkerRegistration | undefined;
    let reloading = false;
    let prompted = false;

    const promptUpdate = (worker: ServiceWorker) => {
      if (prompted) return;
      prompted = true;
      toast(t('updateAvailable'), {
        duration: Infinity,
        action: { label: t('update'), onClick: () => worker.postMessage('SKIP_WAITING') },
      });
    };

    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          // A controller means an older version is running: ask before swapping.
          if (next.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(next);
        });
      });
    };

    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    // Installed PWAs (iOS especially) rarely re-check on their own: check when
    // the app comes back to the foreground and every 30 min while open.
    const check = () => { registration?.update().catch(() => {}); };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };

    const register = () => {
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, { updateViaCache: 'none' })
        .then((reg) => { registration = reg; watch(reg); })
        .catch(() => {});
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      window.removeEventListener('load', register);
    };
  }, [t]);

  return null;
}
