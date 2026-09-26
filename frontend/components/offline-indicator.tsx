'use client';

import { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);
  const t = useTranslations('common');

  useEffect(() => {
    setIsOffline(!navigator.onLine);
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    // Sits above the floating mobile dock (24px inset + 64px dock + safe area) on < lg.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-float-1 left-1/2 z-float -translate-x-1/2 lg:bottom-6"
    >
      <div className="flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-primary-foreground shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pop-amber text-pop-foreground">
          <WifiOff className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span className="text-sm font-bold">{t('offline')}</span>
      </div>
    </div>
  );
}
