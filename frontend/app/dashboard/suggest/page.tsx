'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useWeatherConditionLabel } from '@/lib/weather-condition';
import {
  Shirt,
  Sparkles,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Cloud,
  Sun,
  CloudRain,
  Loader2,
  AlertCircle,
  Thermometer,
  Droplets,
  ChevronDown,
  MapPin,
  Wind,
  Cloudy,
  CloudSun,
  Snowflake,
  CalendarDays,
  CloudLightning,
  Music,
  LayoutGrid,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { api, getErrorMessage, setAccessToken } from '@/lib/api';
import { OCCASIONS, Outfit, SuggestRequest } from '@/lib/types';
import { useWeather, Weather } from '@/lib/hooks/use-weather';
import { usePreferences } from '@/lib/hooks/use-preferences';
import { useMusicSettings } from '@/lib/hooks/use-music';
import { SongAutocomplete, type SongSelection } from '@/components/music/song-autocomplete';
import { cn } from '@/lib/utils';
import { AIUnavailableNotice } from '@/components/ai/ai-unavailable-notice';
import { getAiAccessErrorCode } from '@/lib/ai-access';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import { TempUnit, formatTemp, displayValue, toF, toCelsius } from '@/lib/temperature';
import { Chip } from '@/components/chip';
import { OccasionChips } from '@/components/shared/occasion-chips';
import { PageHeader } from '@/components/page-header';
import { StinkyTip } from '@/components/stinky-tip';
import { Stinky } from '@/components/stinky/stinky';
import type { StinkyState } from '@/components/stinky/stinky-states';

// Weather condition to icon mapping
function getWeatherIcon(condition: string, isDay: boolean) {
  const c = condition.toLowerCase();
  if (c.includes('rain') || c.includes('drizzle')) return <CloudRain className="h-7 w-7" strokeWidth={1.75} aria-hidden />;
  if (c.includes('snow')) return <Snowflake className="h-7 w-7" strokeWidth={1.75} aria-hidden />;
  if (c.includes('thunder') || c.includes('storm')) return <CloudLightning className="h-7 w-7" strokeWidth={1.75} aria-hidden />;
  if (c.includes('cloud') && c.includes('part')) return <CloudSun className="h-7 w-7" strokeWidth={1.75} aria-hidden />;
  if (c.includes('cloud') || c.includes('overcast')) return <Cloudy className="h-7 w-7" strokeWidth={1.75} aria-hidden />;
  return isDay ? <Sun className="h-7 w-7" strokeWidth={1.75} aria-hidden /> : <Cloud className="h-7 w-7" strokeWidth={1.75} aria-hidden />;
}

interface WeatherOverride {
  temperature: number;
  condition: 'sunny' | 'cloudy' | 'rainy';
}

function WeatherCard({ weather, isLoading, temperatureUnit }: { weather?: Weather; isLoading: boolean; temperatureUnit: TempUnit }) {
  const t = useTranslations('suggest');
  const conditionLabel = useWeatherConditionLabel();

  // Get weather-based outfit hint
  const getWeatherHint = (w: Weather): string => {
    const temp = w.temperature;
    const condition = w.condition.toLowerCase();

    if (w.precipitation_chance > 50) return t('weatherHintRain');
    if (temp < 10) return t('weatherHintCold');
    if (temp < 18) return t('weatherHintCool');
    if (temp > 28) return t('weatherHintHot');
    if (condition.includes('wind')) return t('weatherHintWind');
    return t('weatherHintDefault');
  };

  if (isLoading) {
    return <Skeleton className="h-[88px] w-full rounded-lg" />;
  }

  if (!weather) {
    return (
      <Link
        href="/dashboard/settings"
        className="flex items-center gap-4 rounded-lg bg-panel p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pop-sky text-pop-foreground">
          <MapPin className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] font-bold">{t('locationNotSetTitle')}</span>
          <span className="block text-sm text-muted-foreground">{t('locationNotSetShortBody')}</span>
        </span>
      </Link>
    );
  }

  return (
    <div className="rounded-lg bg-panel p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pop-amber text-pop-foreground">
            {getWeatherIcon(weather.condition, weather.is_day)}
          </span>
          <div>
            <p className="text-2xl font-extrabold leading-none tracking-tight">
              {displayValue(weather.temperature, temperatureUnit)}
              <span className="text-base font-semibold text-muted-foreground">{temperatureUnit === 'fahrenheit' ? '°F' : '°C'}</span>
            </p>
            <p className="mt-1 text-sm font-medium capitalize text-muted-foreground">{conditionLabel(weather)}</p>
          </div>
        </div>
        <ul className="space-y-1 text-right text-[13px] font-medium text-muted-foreground">
          <li className="flex items-center justify-end gap-1.5">
            <Thermometer className="h-3.5 w-3.5" aria-hidden />
            {t('feelsShort', { temp: displayValue(weather.feels_like, temperatureUnit) })}
          </li>
          <li className="flex items-center justify-end gap-1.5">
            <Droplets className="h-3.5 w-3.5" aria-hidden />
            {t('rainChanceShort', { pct: weather.precipitation_chance })}
          </li>
          <li className="flex items-center justify-end gap-1.5">
            <Wind className="h-3.5 w-3.5" aria-hidden />
            {t('windSpeed', { value: Math.round(weather.wind_speed) })}
          </li>
        </ul>
      </div>
      <p className="mt-3 border-t border-border pt-3 text-sm font-medium">{getWeatherHint(weather)}</p>
    </div>
  );
}

function WeatherOverrideSection({
  weather,
  onChange,
  temperatureUnit,
}: {
  weather: WeatherOverride | null;
  onChange: (weather: WeatherOverride | null) => void;
  temperatureUnit: TempUnit;
}) {
  const t = useTranslations('suggest');
  const [isOpen, setIsOpen] = useState(false);
  const conditions = [
    { value: 'sunny', icon: <Sun className="h-4 w-4" />, label: t('conditionSunny') },
    { value: 'cloudy', icon: <Cloud className="h-4 w-4" />, label: t('conditionCloudy') },
    { value: 'rainy', icon: <CloudRain className="h-4 w-4" />, label: t('conditionRainy') },
  ] as const;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          aria-expanded={isOpen}
          className="-ml-2 flex min-h-[44px] items-center gap-2 rounded-full px-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} aria-hidden />
          <span>{weather ? t('overrideActive') : t('overrideCta')}</span>
          {weather && (
            <Badge variant="secondary" className="text-xs">
              {conditions.find((c) => c.value === weather.condition)?.label ?? weather.condition}{' '}
              {formatTemp(weather.temperature, temperatureUnit)}
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="space-y-4 rounded-lg bg-panel p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{t('overrideCondition')}</span>
            {weather && (
              <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
                {t('overrideReset')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {conditions.map((c) => (
              <Chip
                key={c.value}
                active={weather?.condition === c.value}
                onClick={() =>
                  onChange({
                    temperature: weather?.temperature ?? 20,
                    condition: c.value,
                  })
                }
              >
                {c.icon}
                {c.label}
              </Chip>
            ))}
          </div>
          {weather && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{t('overrideTemperature')}</span>
              <input
                type="range"
                min={temperatureUnit === 'fahrenheit' ? 14 : -10}
                max={temperatureUnit === 'fahrenheit' ? 104 : 40}
                value={temperatureUnit === 'fahrenheit' ? Math.round(toF(weather.temperature)) : weather.temperature}
                onChange={(e) => {
                  const raw = parseInt(e.target.value);
                  onChange({ ...weather, temperature: temperatureUnit === 'fahrenheit' ? Math.round(toCelsius(raw)) : raw });
                }}
                aria-label={t('overrideTemperature')}
                className="flex-1 accent-[var(--signature)]"
              />
              <span className="w-14 text-right text-sm font-bold">{formatTemp(weather.temperature, temperatureUnit)}</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function OutfitResult({
  outfit,
  occasion,
  temperatureUnit,
  onAccept,
  onReject,
  onTryAnother,
  onNewRequest,
  isAccepting,
}: {
  outfit: Outfit;
  occasion: string;
  temperatureUnit: TempUnit;
  onAccept: () => void;
  onReject: () => void;
  onTryAnother: () => void;
  onNewRequest: () => void;
  isAccepting: boolean;
}) {
  const t = useTranslations('suggest');
  const format = useFormatter();
  const conditionLabel = useWeatherConditionLabel();
  return (
    <div className="space-y-4">
      {/* Occasion, date, start over */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="signature" className="px-3 py-1 text-sm capitalize">
            {t(`occasions.${occasion}` as any)}
          </Badge>
          {outfit.scheduled_for && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {format.dateTime(new Date(outfit.scheduled_for + 'T00:00:00'), { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onNewRequest}>
          {t('startOver')}
        </Button>
      </div>

      {/* Weather used */}
      {outfit.weather && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-full bg-panel px-4 py-2 text-sm font-medium">
          <span className="flex items-center gap-1.5">
            <Thermometer className="h-4 w-4" aria-hidden />
            {formatTemp(outfit.weather.temperature, temperatureUnit)}
            <span className="text-xs text-muted-foreground">
              {t('feelsInline', { temp: displayValue(outfit.weather.feels_like, temperatureUnit) })}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <Droplets className="h-4 w-4" aria-hidden />
            {t('rainChanceShort', { pct: outfit.weather.precipitation_chance })}
          </span>
          <span className="capitalize text-muted-foreground">{conditionLabel(outfit.weather)}</span>
        </div>
      )}

      {/* The look */}
      <section aria-labelledby="your-outfit-title" className="rounded-lg bg-panel p-3.5 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="your-outfit-title" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <Sparkles className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            {t('yourOutfit')}
          </h2>
          {outfit.music_inspiration && (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-semibold">
              <Music className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="text-muted-foreground">{t('inspiredBy')}</span>
              <span className="truncate">{outfit.music_inspiration.label}</span>
            </span>
          )}
        </div>

        {outfit.reasoning && <p className="mt-2 text-[15px] font-medium leading-snug">{outfit.reasoning}</p>}
        {outfit.highlights && outfit.highlights.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {outfit.highlights.map((highlight, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signature" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {outfit.items.map((item) => (
            <Link
              key={item.id}
              href={`/dashboard/wardrobe?item=${item.id}`}
              className="group block rounded-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="relative aspect-square overflow-hidden rounded-tile bg-background">
                {item.thumbnail_url ? (
                  <Image
                    src={item.thumbnail_url}
                    alt={item.name || item.type}
                    fill
                    className="object-contain p-2 transition-transform duration-300 group-hover:scale-105"
                    sizes="(max-width: 640px) 50vw, 33vw"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Shirt className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                  </div>
                )}
                {item.layer_type && (
                  <Badge variant="secondary" className="absolute left-2 top-2 bg-panel capitalize">
                    {item.layer_type}
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 truncate px-1 text-sm font-semibold">{item.name || item.type}</p>
            </Link>
          ))}
        </div>

        {outfit.style_notes && <StinkyTip className="mt-4">{outfit.style_notes}</StinkyTip>}
      </section>

      {/* Actions */}
      <div className="flex gap-2.5">
        <Button variant="secondary" size="lg" onClick={onTryAnother} className="flex-1">
          <RefreshCw className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          {t('tryAnother')}
        </Button>
        <Button size="lg" onClick={onAccept} disabled={isAccepting} className="flex-1">
          {isAccepting ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
          ) : (
            <ThumbsUp className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          )}
          {t('loveIt')}
        </Button>
        <Button variant="outline" size="icon" className="h-[52px] w-[52px]" onClick={onReject} aria-label={t('rejectOutfit')}>
          <ThumbsDown className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** Big Stinky in a soft-pink circle — the page's hero. */
function StinkyHero({
  state,
  title,
  body,
  children,
}: {
  state: StinkyState;
  title: string;
  body?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col items-center px-2 text-center" aria-live="polite">
      <div className="flex h-44 w-44 items-center justify-center rounded-full bg-signature-soft">
        <Stinky state={state} size={150} label="" />
      </div>
      <h2 className="mt-4 text-[26px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h2>
      {body && <p className="mt-2 max-w-md text-[15px] leading-snug text-muted-foreground">{body}</p>}
      {children}
    </section>
  );
}

export default function SuggestPage() {
  const t = useTranslations('suggest');
  const tOcc = useTranslations('suggest.occasions');
  const { data: session } = useSession();
  const { data: weather, isLoading: weatherLoading } = useWeather();
  const { data: prefs } = usePreferences();
  const temperatureUnit: TempUnit = prefs?.temperature_unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const [selectedOccasion, setSelectedOccasion] = useState<string | null>(null);
  const [occasionInitialized, setOccasionInitialized] = useState(false);
  const [weatherOverride, setWeatherOverride] = useState<WeatherOverride | null>(null);
  const [song, setSong] = useState<SongSelection>({ text: '', trackId: null, track: null });
  const songQuery = song.text;
  const musicSettings = useMusicSettings();
  const musicConnected = Boolean(musicSettings.data?.source);
  const [isGenerating, setIsGenerating] = useState(false);
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [aiBlocked, setAiBlocked] = useState<string | null>(null);
  const { data: aiStatus } = useAIStatus();
  const noTextAi = Boolean(
    aiStatus && aiStatus.server_ai_enabled && !aiStatus.capabilities.text
  );

  useEffect(() => {
    if (prefs?.default_occasion && !occasionInitialized && !selectedOccasion) {
      setSelectedOccasion(prefs.default_occasion);
      setOccasionInitialized(true);
    }
  }, [prefs, occasionInitialized, selectedOccasion]);

  const handleGenerate = async () => {
    if (!selectedOccasion) return;

    if (session?.accessToken) {
      setAccessToken(session.accessToken as string);
    }

    setIsGenerating(true);
    setError(null);
    setAccepted(false);
    setAiBlocked(null);

    try {
      const request: SuggestRequest = {
        occasion: selectedOccasion,
      };

      if (weatherOverride) {
        request.weather_override = {
          temperature: weatherOverride.temperature,
          feels_like: weatherOverride.temperature,
          humidity: 50,
          precipitation_chance: weatherOverride.condition === 'rainy' ? 80 : weatherOverride.condition === 'cloudy' ? 30 : 10,
          condition: weatherOverride.condition,
        };
      }

      const trimmedSong = songQuery.trim();
      if (trimmedSong) {
        request.song_query = trimmedSong;
      }
      if (song.trackId) {
        request.song_track_id = song.trackId;
      }

      const result = await api.post<Outfit>('/outfits/suggest', request);
      setOutfit(result);
    } catch (err) {
      const aiCode = getAiAccessErrorCode(err);
      if (aiCode) {
        setAiBlocked(aiCode);
      } else {
        // Never the backend's own prose: the code decides the (Spanish) copy.
        setError(getErrorMessage(err, t('generateError')));
      }
      console.error('Suggestion error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAccept = async () => {
    if (!outfit) return;

    if (session?.accessToken) {
      setAccessToken(session.accessToken as string);
    }

    setIsAccepting(true);
    try {
      await api.post(`/outfits/${outfit.id}/accept`);
      setOutfit(null);
      setSelectedOccasion(null);
      setAccepted(true);
    } catch (err) {
      console.error('Accept error:', err);
    } finally {
      setIsAccepting(false);
    }
  };

  const handleTryAnother = () => {
    setOutfit(null);
    handleGenerate();
  };

  const handleReject = async () => {
    if (!outfit) return;

    if (session?.accessToken) {
      setAccessToken(session.accessToken as string);
    }

    try {
      await api.post(`/outfits/${outfit.id}/reject`);
    } catch (err) {
      console.error('Reject error:', err);
    }

    setOutfit(null);
    handleGenerate();
  };

  const handleNewRequest = () => {
    setOutfit(null);
    setSelectedOccasion(null);
    setError(null);
    setAccepted(false);
  };

  const trimmedSong = songQuery.trim();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t('title')} />

      {outfit ? (
        <OutfitResult
          outfit={outfit}
          occasion={selectedOccasion || 'casual'}
          temperatureUnit={temperatureUnit}
          onAccept={handleAccept}
          onReject={handleReject}
          onTryAnother={handleTryAnother}
          onNewRequest={handleNewRequest}
          isAccepting={isAccepting}
        />
      ) : isGenerating ? (
        <div className="space-y-6">
          <StinkyHero
            state="thinking"
            title={t('thinkingTitle')}
            body={
              trimmedSong
                ? t.rich('thinkingBodySong', { song: trimmedSong, b: (c) => <strong className="text-foreground">{c}</strong> })
                : t('thinkingBody')
            }
          />
          <section>
            <p className="mb-2.5 px-1 text-sm font-bold">{t('occasionsQuestion')}</p>
            <OccasionChips selected={selectedOccasion} onSelect={() => {}} disabled scroll />
          </section>
          <div className="space-y-2">
            <div
              role="progressbar"
              aria-label={t('creatingLook')}
              aria-busy="true"
              className="relative h-3 overflow-hidden rounded-full bg-panel"
            >
              <div className="absolute inset-y-0 left-0 w-2/5 animate-progress-indeterminate rounded-full bg-signature" />
            </div>
            <p className="px-1 text-[13px] text-muted-foreground">{t('thinkingCaption')}</p>
          </div>
        </div>
      ) : accepted ? (
        <StinkyHero state="happy" title={t('acceptedTitle')} body={t('acceptedBody')}>
          <div className="mt-6 flex w-full max-w-md gap-2.5">
            <Button variant="secondary" size="lg" className="flex-1" onClick={handleNewRequest}>
              <RefreshCw className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              {t('anotherLook')}
            </Button>
            <Button asChild size="lg" className="flex-1">
              <Link href="/dashboard/outfits">
                <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                {t('seeLooks')}
              </Link>
            </Button>
          </div>
        </StinkyHero>
      ) : (
        <div className="space-y-6">
          {aiBlocked || noTextAi ? (
            <AIUnavailableNotice feature="suggest" reason={aiBlocked ?? aiStatus?.blocked_reason} />
          ) : error ? (
            <StinkyHero state="sad" title={t('errorTitle')} body={error} />
          ) : (
            <StinkyHero
              state="idle"
              title={t('introTitle')}
              body={selectedOccasion ? t('introBodyOccasion', { occasion: tOcc(selectedOccasion as any) }) : t('introBody')}
            />
          )}

          <WeatherCard weather={weather} isLoading={weatherLoading} temperatureUnit={temperatureUnit} />

          <section className="space-y-2.5">
            <h2 className="px-1 text-sm font-bold">{t('occasionsQuestion')}</h2>
            <OccasionChips selected={selectedOccasion} onSelect={setSelectedOccasion} scroll />
          </section>

          <WeatherOverrideSection weather={weatherOverride} onChange={setWeatherOverride} temperatureUnit={temperatureUnit} />

          {/* Song — optional mood/aesthetic reference */}
          <div className="space-y-2">
            <label htmlFor="song-query" className="flex items-center gap-2 px-1 text-sm font-bold">
              <Music className="h-4 w-4" aria-hidden />
              {t('songLabel')}
            </label>
            <SongAutocomplete
              value={song}
              onChange={setSong}
              musicConnected={musicConnected}
              describedBy="song-help"
            />
            <p id="song-help" className="px-1 text-xs text-muted-foreground">
              {t('songHelp')}
            </p>
            {musicConnected && musicSettings.data?.use_for_mood && !songQuery.trim() && (
              <p className="px-1 text-xs font-semibold text-success">{t('songSpotifyHint')}</p>
            )}
          </div>

          <Button size="lg" className="w-full" onClick={handleGenerate} disabled={!selectedOccasion || noTextAi}>
            <Sparkles className="h-5 w-5" strokeWidth={2} aria-hidden />
            {error ? t('tryAgain') : t('getSuggestion')}
          </Button>
        </div>
      )}
    </div>
  );
}
