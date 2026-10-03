'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTimeZone } from 'next-intl';
import { TIME_ZONE_COOKIE } from '@/i18n/time-zone';

/**
 * Tells the server which zone this device is in, so dates it renders (week strip,
 * calendars, "hoy") match the ones the browser renders. When the zone was unknown
 * or has changed (travel), the page is refreshed once to pick it up.
 */
export function TimeZoneCookie() {
  const serverZone = useTimeZone();
  const router = useRouter();

  useEffect(() => {
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone || zone === serverZone) return;
    // IANA names (Europe/Madrid, America/Argentina/Buenos_Aires) are cookie-safe as they are.
    document.cookie = `${TIME_ZONE_COOKIE}=${zone}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [serverZone, router]);

  return null;
}
