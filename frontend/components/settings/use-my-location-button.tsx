'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TravelPromptCard } from '@/components/settings/travel-prompt-card';
import { geoLang, type SavedLocation } from '@/lib/geo';
import {
  type DeviceLocationResult,
  detectedToSavedLocation,
  useDeviceLocation,
} from '@/lib/hooks/use-location';
import { type LocationFailure, readDevicePosition } from '@/lib/location-detect';

interface UseMyLocationButtonProps {
  /** Called with the city the server saved, so the form around us matches it. */
  onDetected: (location: SavedLocation) => void;
  className?: string;
}

/**
 * "Usar mi ubicación": the browser asks for permission, we keep a city.
 *
 * The permission prompt is the browser's, raised by this tap and never before
 * it. The reading is rounded to ~1 km before it leaves the device, and the line
 * under the button says exactly what is kept. Denial, timeout and "no idea"
 * each get a plain sentence and leave the manual search sitting right there:
 * this button is a shortcut, never a requirement.
 */
export function UseMyLocationButton({ onDetected, className }: UseMyLocationButtonProps) {
  const t = useTranslations('settings.location');
  const locale = useLocale();
  const deviceLocation = useDeviceLocation();
  const [locating, setLocating] = useState(false);
  const [travel, setTravel] = useState<DeviceLocationResult | null>(null);

  const failureMessage = (reason: LocationFailure) =>
    reason === 'denied'
      ? t('permissionDenied')
      : reason === 'timeout'
        ? t('positionTimeout')
        : reason === 'unsupported'
          ? t('notSupported')
          : t('positionUnavailable');

  const handleClick = async () => {
    setLocating(true);
    setTravel(null);
    try {
      const reading = await readDevicePosition();
      if (!reading.ok) {
        toast.message(failureMessage(reading.reason));
        return;
      }
      const result = await deviceLocation.mutateAsync({
        latitude: reading.latitude,
        longitude: reading.longitude,
        lang: geoLang(locale),
        trigger: 'button',
      });
      if (result.status === 'travel_suspected') {
        // Far from the saved city: nothing changed, we ask instead.
        setTravel(result);
        return;
      }
      if (result.detected) {
        onDetected(detectedToSavedLocation(result.detected));
        toast.success(t('detectedToast', { city: result.detected.name }));
      }
    } catch {
      toast.error(t('unableToDetect'));
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        onClick={handleClick}
        disabled={locating || deviceLocation.isPending}
        className="w-full sm:w-auto"
      >
        {locating || deviceLocation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Navigation className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        )}
        {locating || deviceLocation.isPending ? t('locating') : t('useMyLocation')}
      </Button>
      <p className="mt-2 px-1 text-[13px] leading-snug text-muted-foreground">
        {t('privacyNote')}
      </p>

      {travel?.detected && (
        <TravelPromptCard
          className="mt-3"
          detected={travel.detected}
          currentCity={travel.current_city ?? null}
          onConfirmed={(location) => {
            setTravel(null);
            onDetected(location);
          }}
          onDismiss={() => setTravel(null)}
        />
      )}
    </div>
  );
}
