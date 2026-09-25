'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Plane } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { geoLang, type SavedLocation } from '@/lib/geo';
import {
  type DetectedPlace,
  detectedToSavedLocation,
  useDeviceLocation,
} from '@/lib/hooks/use-location';
import { cn } from '@/lib/utils';

interface TravelPromptCardProps {
  detected: DetectedPlace;
  /** The city on file ("Madrid"), for "No, sigue con Madrid". */
  currentCity: string | null;
  onConfirmed?: (location: SavedLocation) => void;
  onDismiss: () => void;
  className?: string;
}

/**
 * "¿Estás en Lisboa? ¿Visto para allí?" — the only way a trip moves the city.
 *
 * Nothing has changed by the time this appears: the backend answered
 * `travel_suspected` and left the saved city alone. Both buttons are an answer,
 * and dismissing is one of them.
 */
export function TravelPromptCard({
  detected,
  currentCity,
  onConfirmed,
  onDismiss,
  className,
}: TravelPromptCardProps) {
  const t = useTranslations('settings.location.travel');
  const locale = useLocale();
  const deviceLocation = useDeviceLocation();

  const confirm = async () => {
    try {
      const result = await deviceLocation.mutateAsync({
        latitude: detected.latitude,
        longitude: detected.longitude,
        lang: geoLang(locale),
        trigger: 'confirm',
      });
      const place = result.detected ?? detected;
      onConfirmed?.(detectedToSavedLocation(place));
      toast.success(t('updatedToast', { city: place.name }));
      onDismiss();
    } catch {
      toast.error(t('updateError'));
    }
  };

  return (
    <div
      className={cn('rounded-quick bg-signature-soft p-3', className)}
      role="status"
      data-testid="travel-prompt"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background text-foreground"
        >
          <Plane className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-snug">
            {t('question', { city: detected.name })}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{t('hint')}</p>
        </div>
      </div>
      {/*
        Both answers wrap rather than overflow: "No, sigue con San Cristóbal de
        La Laguna" has to fit a 320 px screen at 125 % font, so the pills grow
        taller instead of wider (h-auto beats the button's fixed height, and
        whitespace-normal beats its nowrap).
      */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={confirm}
          disabled={deviceLocation.isPending}
          className="h-auto min-h-9 grow whitespace-normal py-2 text-center sm:grow-0"
        >
          {deviceLocation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t('confirm')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onDismiss}
          disabled={deviceLocation.isPending}
          className="h-auto min-h-9 grow whitespace-normal break-words bg-background py-2 text-center sm:grow-0"
        >
          {currentCity ? t('keep', { city: currentCity }) : t('keepGeneric')}
        </Button>
      </div>
    </div>
  );
}
