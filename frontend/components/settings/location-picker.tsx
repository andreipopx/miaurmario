'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, Loader2, MapPin, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MIN_PLACE_QUERY,
  type Place,
  type SavedLocation,
  placeSubtitle,
  placeToLocation,
  reverseGeocode,
  searchPlaces,
} from '@/lib/geo';
import {
  getNetworkLocationUrl,
  isNetworkLocationFallbackEnabled,
  resolveNetworkLocation,
} from '@/lib/location';
import { getBrowserTimezone } from '@/lib/timezones';
import { cn } from '@/lib/utils';

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

interface LocationPickerProps {
  id?: string;
  value: SavedLocation;
  onChange: (location: SavedLocation) => void;
  /** Show the lat/lon fields under an "Avanzado" disclosure. */
  showAdvanced?: boolean;
  className?: string;
}

/**
 * City picker: shows the chosen city ("Madrid, Comunidad de Madrid, España")
 * with a "Cambiar" action, a search-as-you-type combobox backed by
 * /geo/search, and "Usar mi ubicación" (browser geolocation -> /geo/reverse).
 * Raw coordinates live under an optional "Avanzado" disclosure.
 */
export function LocationPicker({
  id = 'location',
  value,
  onChange,
  showAdvanced = true,
  className,
}: LocationPickerProps) {
  const t = useTranslations('settings.location');
  const locale = useLocale();
  const hasCity = !!value.name;
  const [editing, setEditing] = useState(!hasCity);
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const resultsRef = useRef<Place[]>([]);

  // A saved city arriving after mount (profile loaded) closes the search.
  useEffect(() => {
    if (value.name) setEditing(false);
  }, [value.name]);

  const debouncedQuery = useDebounced(query.trim(), 250);
  const search = useQuery({
    queryKey: ['geo-search', debouncedQuery.toLowerCase(), locale],
    queryFn: () => searchPlaces(debouncedQuery, locale),
    enabled: editing && debouncedQuery.length >= MIN_PLACE_QUERY,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const results = useMemo(() => search.data ?? [], [search.data]);
  resultsRef.current = results;

  const options: ComboboxOption[] = useMemo(
    () =>
      results.map((place, index) => ({
        value: String(index),
        label: place.name,
        description: placeSubtitle(place) || undefined,
      })),
    [results]
  );

  const typing = query.trim().length > 0;
  const waiting = typing && (debouncedQuery !== query.trim() || search.isFetching);
  let statusMessage: string | undefined;
  if (typing && query.trim().length < MIN_PLACE_QUERY) statusMessage = t('typeMore');
  else if (search.isError) statusMessage = t('searchError');
  else if (typing && !waiting && search.isSuccess && results.length === 0)
    statusMessage = t('noResults');

  const pick = (place: Place) => {
    onChange(placeToLocation(place));
    setQuery('');
    setEditing(false);
  };

  const locateFromNetwork = async (reason?: string) => {
    if (!isNetworkLocationFallbackEnabled()) {
      toast.error(reason || t('unableToDetect'));
      return;
    }
    try {
      const response = await fetch(getNetworkLocationUrl(), {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(t('unableToDetect'));
      const resolved = resolveNetworkLocation(await response.json(), getBrowserTimezone());
      onChange({
        name: resolved.locationName || t('myLocation', { lat: resolved.lat, lon: resolved.lon }),
        lat: Number(resolved.lat),
        lon: Number(resolved.lon),
        timezone: resolved.timezone ?? null,
      });
      setEditing(false);
      toast.success(
        reason ? t('approxFilledWithReason', { reason }) : t('approxFilled')
      );
    } catch {
      toast.error(reason || t('unableToDetect'));
    }
  };

  const handleUseMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      void locateFromNetwork(t('notSupported'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const place = await reverseGeocode(latitude, longitude, locale);
          // Keep the precise device coordinates, not the grid-rounded ones.
          pick({ ...place, latitude, longitude });
          toast.success(t('detectedToast', { city: place.name }));
        } catch {
          onChange({
            name: t('myLocation', { lat: latitude.toFixed(2), lon: longitude.toFixed(2) }),
            lat: Number(latitude.toFixed(6)),
            lon: Number(longitude.toFixed(6)),
            timezone: getBrowserTimezone() ?? null,
          });
          setEditing(false);
          toast.message(t('reverseError'));
        } finally {
          setLocating(false);
        }
      },
      (error) => {
        setLocating(false);
        const reason =
          error.code === 1
            ? t('permissionDenied')
            : error.code === 3
              ? t('positionTimeout')
              : t('positionUnavailable');
        void locateFromNetwork(reason);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
    );
  };

  const setCoordinate = (key: 'lat' | 'lon', raw: string) => {
    const num = raw.trim() === '' ? null : Number(raw);
    onChange({ ...value, [key]: num !== null && Number.isFinite(num) ? num : null });
  };

  return (
    <div className={cn('space-y-3', className)}>
      <Label htmlFor={editing ? `${id}-search` : undefined} className="font-bold">
        {t('cityLabel')}
      </Label>

      {!editing && hasCity ? (
        <div className="flex items-center gap-3 rounded-quick bg-panel p-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-signature-soft text-foreground"
          >
            <MapPin className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <p className="min-w-0 flex-1 text-[15px] font-bold leading-snug" data-testid="chosen-city">
            {value.name}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setEditing(true)}
            className="shrink-0 bg-background"
          >
            {t('change')}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Combobox
            id={`${id}-search`}
            aria-label={t('cityLabel')}
            inputValue={query}
            onInputChange={setQuery}
            options={options}
            onSelect={(option) => {
              const place = resultsRef.current[Number(option.value)];
              if (place) pick(place);
            }}
            placeholder={t('searchPlaceholder')}
            loading={waiting}
            statusMessage={statusMessage}
            autoFocus={hasCity}
            onEscape={hasCity ? () => setEditing(false) : undefined}
          />
          {hasCity ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setEditing(false);
              }}
              className="px-1 text-sm font-semibold text-muted-foreground underline-offset-4 hover:underline"
            >
              {t('cancelChange')}
            </button>
          ) : (
            <p className="px-1 text-sm text-muted-foreground">{t('noCity')}</p>
          )}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={handleUseMyLocation}
        disabled={locating}
        className="w-full sm:w-auto"
      >
        {locating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Navigation className="h-4 w-4" strokeWidth={1.75} />
        )}
        {locating ? t('locating') : t('useMyLocation')}
      </Button>

      {showAdvanced && (
        <div>
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls={`${id}-advanced`}
            onClick={() => setAdvancedOpen((o) => !o)}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-1 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform duration-150', advancedOpen && 'rotate-180')}
              aria-hidden
            />
            {t('advanced')}
          </button>
          {advancedOpen && (
            <div id={`${id}-advanced`} className="mt-2 space-y-3 rounded-quick bg-panel p-3">
              <p className="text-[13px] text-muted-foreground">{t('advancedHint')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-lat`}>{t('latitude')}</Label>
                  <Input
                    id={`${id}-lat`}
                    type="number"
                    inputMode="decimal"
                    step="0.000001"
                    min={-90}
                    max={90}
                    value={value.lat ?? ''}
                    onChange={(e) => setCoordinate('lat', e.target.value)}
                    placeholder={t('latitudePlaceholder')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-lon`}>{t('longitude')}</Label>
                  <Input
                    id={`${id}-lon`}
                    type="number"
                    inputMode="decimal"
                    step="0.000001"
                    min={-180}
                    max={180}
                    value={value.lon ?? ''}
                    onChange={(e) => setCoordinate('lon', e.target.value)}
                    placeholder={t('longitudePlaceholder')}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
