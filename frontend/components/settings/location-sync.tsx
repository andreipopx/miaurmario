'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { TravelPromptCard } from '@/components/settings/travel-prompt-card';
import { geoLang } from '@/lib/geo';
import { useAuth } from '@/lib/hooks/use-auth';
import {
  type DeviceLocationResult,
  useAutoTimezone,
  useDeviceLocation,
} from '@/lib/hooks/use-location';
import { geolocationPermissionState, readDevicePosition } from '@/lib/location-detect';
import { getBrowserTimezone } from '@/lib/timezones';

/**
 * The two things that happen by themselves when the app opens.
 *
 * **The timezone**, silently: the device's zone is offered once per load, and
 * the backend keeps it only if the user never chose one by hand. This is what
 * makes a morning-look notification arrive in the morning without anyone
 * touching Ajustes.
 *
 * **The travel question**, only if it is already welcome: we look at the
 * geolocation permission, and read a position *only* when the browser says it
 * was already granted — so opening the app never raises a permission prompt.
 * A reading far from the saved city surfaces "¿Estás en Lisboa?", which the
 * backend caps at once a day; nothing moves until the user says so.
 *
 * Every failure here is silent. Nothing on this path is worth a toast, and
 * nothing on it blocks the app.
 */
export function LocationSync() {
  const { user, isAuthenticated } = useAuth();
  const locale = useLocale();
  const autoTimezone = useAutoTimezone();
  const deviceLocation = useDeviceLocation();
  const [travel, setTravel] = useState<DeviceLocationResult | null>(null);
  const syncedTimezone = useRef(false);
  const checkedTravel = useRef(false);

  // The zone the device is in, saved unless the user picked one.
  useEffect(() => {
    if (!isAuthenticated || !user || syncedTimezone.current) return;
    // Absent on an old backend: say nothing rather than risk clobbering a choice.
    if (user.timezone_source === undefined || user.timezone_source === 'manual') return;
    const browserTimezone = getBrowserTimezone();
    if (!browserTimezone || browserTimezone === user.timezone) return;
    syncedTimezone.current = true;
    autoTimezone.mutate(browserTimezone, { onError: () => undefined });
    // autoTimezone is a stable mutation object; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user]);

  // "¿Estás en Lisboa?", but only on a permission the browser already granted.
  useEffect(() => {
    if (!isAuthenticated || !user || checkedTravel.current) return;
    // Nothing to travel away from yet, and no city is ever set from here.
    if (user.location_lat == null || user.location_lon == null) return;
    checkedTravel.current = true;

    let cancelled = false;
    (async () => {
      if ((await geolocationPermissionState()) !== 'granted') return;
      const reading = await readDevicePosition();
      if (cancelled || !reading.ok) return;
      try {
        const result = await deviceLocation.mutateAsync({
          latitude: reading.latitude,
          longitude: reading.longitude,
          lang: geoLang(locale),
          trigger: 'open',
        });
        if (!cancelled && result.status === 'travel_suspected') setTravel(result);
      } catch {
        // A quiet background check stays quiet when it fails.
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user, locale]);

  if (!travel?.detected) return null;

  return (
    <TravelPromptCard
      className="mb-3"
      detected={travel.detected}
      currentCity={travel.current_city ?? null}
      onConfirmed={() => setTravel(null)}
      onDismiss={() => setTravel(null)}
    />
  );
}
