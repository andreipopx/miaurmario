'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Loader2, Save, RotateCcw, Check, Plus, Trash2, ChevronUp, ChevronDown, Server, MapPin, Navigation, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { usePreferences, useUpdatePreferences, useResetPreferences, useTestAIEndpoint } from '@/lib/hooks/use-preferences';
import { useUserProfile, useUpdateUserProfile } from '@/lib/hooks/use-user';
import {
  getNetworkLocationUrl,
  formatReverseGeocodedLocation,
  getGeolocationFailureMessage,
  isNetworkLocationFallbackEnabled,
  resolveNetworkLocation,
} from '@/lib/location';
import { CLOTHING_COLORS, OCCASIONS, Preferences, StyleProfile, AIEndpoint } from '@/lib/types';
import { toF, toCelsius } from '@/lib/temperature';
import { toast } from 'sonner';

const CM_TO_IN = 0.393701;
const IN_TO_CM = 2.54;
const KG_TO_LBS = 2.20462;
const LBS_TO_KG = 0.453592;

function convertMeasurement(value: number, key: string, from: string, to: string): number {
  if (from === to) return value;
  const isWeight = key === 'weight';
  if (from === 'metric' && to === 'imperial') {
    return Math.round((isWeight ? value * KG_TO_LBS : value * CM_TO_IN) * 10) / 10;
  }
  return Math.round((isWeight ? value * LBS_TO_KG : value * IN_TO_CM) * 10) / 10;
}

const BODY_MEASUREMENT_FIELDS = [
  { key: 'height', unitMetric: 'cm', unitImperial: 'in', placeholderMetric: 'e.g. 178', placeholderImperial: 'e.g. 70' },
  { key: 'weight', unitMetric: 'kg', unitImperial: 'lbs', placeholderMetric: 'e.g. 75', placeholderImperial: 'e.g. 165' },
  { key: 'chest', unitMetric: 'cm', unitImperial: 'in', placeholderMetric: 'e.g. 96', placeholderImperial: 'e.g. 38' },
  { key: 'waist', unitMetric: 'cm', unitImperial: 'in', placeholderMetric: 'e.g. 82', placeholderImperial: 'e.g. 32' },
  { key: 'hips', unitMetric: 'cm', unitImperial: 'in', placeholderMetric: 'e.g. 98', placeholderImperial: 'e.g. 39' },
  { key: 'inseam', unitMetric: 'cm', unitImperial: 'in', placeholderMetric: 'e.g. 81', placeholderImperial: 'e.g. 32' },
] as const;

const SIZE_FIELDS = [
  { key: 'shirt_size', labelKey: 'shirtSize', placeholder: 'e.g. M, L, XL' },
  { key: 'pants_size', labelKey: 'pantsSize', placeholder: 'e.g. 32, 34' },
  { key: 'dress_size', labelKey: 'dressSize', placeholder: 'e.g. 8, 10' },
  { key: 'shoe_size', labelKey: 'shoeSize', placeholder: 'e.g. 10, 42' },
] as const;

function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  return fallback;
}

interface EndpointTestResult {
  status: 'connected' | 'error' | 'testing' | null;
  models?: string[];
  visionModels?: string[];
  textModels?: string[];
  error?: string;
}

function ColorPicker({
  selected,
  onChange,
  label,
}: {
  selected: string[];
  onChange: (colors: string[]) => void;
  label: string;
}) {
  const toggleColor = (color: string) => {
    if (selected.includes(color)) {
      onChange(selected.filter((c) => c !== color));
    } else {
      onChange([...selected, color]);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {CLOTHING_COLORS.map((color) => {
          const isSelected = selected.includes(color.value);
          return (
            <button
              key={color.value}
              type="button"
              onClick={() => toggleColor(color.value)}
              className={`w-8 h-8 rounded-full border-2 transition-all ${
                isSelected
                  ? 'border-primary ring-2 ring-primary/30 scale-110'
                  : 'border-muted-foreground/20 hover:border-muted-foreground/40'
              }`}
              style={{ backgroundColor: color.hex }}
              title={color.name}
            >
              {isSelected && (
                <Check
                  className={`h-4 w-4 mx-auto ${
                    color.value === 'white' || color.value === 'yellow' || color.value === 'beige'
                      ? 'text-black'
                      : 'text-white'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selected.map((color) => {
            const colorInfo = CLOTHING_COLORS.find((c) => c.value === color);
            return (
              <Badge key={color} variant="secondary" className="gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: colorInfo?.hex }}
                />
                {colorInfo?.name}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StyleSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <Label>{label}</Label>
        <span className="text-sm text-muted-foreground">{value}%</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={(vals) => onChange(vals[0])}
        min={0}
        max={100}
        step={10}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const { data: preferences, isLoading } = usePreferences();
  const { data: userProfile, isLoading: isLoadingProfile } = useUserProfile();
  const updatePreferences = useUpdatePreferences();
  const resetPreferences = useResetPreferences();
  const testEndpoint = useTestAIEndpoint();
  const updateUserProfile = useUpdateUserProfile();

  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tLocation = useTranslations('settings.location');
  const tMeasurements = useTranslations('settings.measurements');
  const tFields = useTranslations('settings.measurements.fields');
  const tColors = useTranslations('settings.colors');
  const tStyleProfile = useTranslations('settings.styleProfile');
  const tStyles = useTranslations('settings.styleProfile.styles');
  const tComfort = useTranslations('settings.comfort');
  const tPreferences = useTranslations('settings.preferences');
  const tRecommendations = useTranslations('settings.recommendations');
  const tAiEndpoints = useTranslations('settings.aiEndpoints');
  const tAccount = useTranslations('settings.account');
  const tTz = useTranslations('settings.location.timezones');

  const [formData, setFormData] = useState<Partial<Preferences>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [endpointTests, setEndpointTests] = useState<Record<number, EndpointTestResult>>({});

  // Location and timezone state
  const [locationName, setLocationName] = useState('');
  const [locationLat, setLocationLat] = useState('');
  const [locationLon, setLocationLon] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  // Body measurements state
  type UnitSystem = 'metric' | 'imperial';
  const [measurements, setMeasurements] = useState<Record<string, string>>({});
  const [measurementsDirty, setMeasurementsDirty] = useState(false);
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('wardrowbe_unit_system') as UnitSystem) || 'metric';
    }
    return 'metric';
  });
  const unitSystemRef = useRef(unitSystem);

  useEffect(() => {
    unitSystemRef.current = unitSystem;
  }, [unitSystem]);

  useEffect(() => {
    if (userProfile) {
      setLocationName(userProfile.location_name || '');
      setLocationLat(userProfile.location_lat?.toString() || '');
      setLocationLon(userProfile.location_lon?.toString() || '');
      setTimezone(userProfile.timezone || 'UTC');

      if (userProfile.body_measurements) {
        const initial: Record<string, string> = {};
        const numericKeys = ['chest', 'waist', 'hips', 'inseam', 'height', 'weight'];
        const displayUnitSystem = unitSystemRef.current;
        for (const [key, value] of Object.entries(userProfile.body_measurements)) {
          if (numericKeys.includes(key) && typeof value === 'number') {
            const converted = convertMeasurement(value, key, 'metric', displayUnitSystem);
            initial[key] = String(converted);
          } else {
            initial[key] = String(value);
          }
        }
        setMeasurements(initial);
      }
    }
  }, [userProfile]);

  const detectLocationFromNetwork = async () => {
    const response = await fetch(getNetworkLocationUrl(), {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(
        `Network-based location lookup failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})`
      );
    }

    const data = await response.json();
    const resolved = resolveNetworkLocation(data, timezone);
    setLocationLat(resolved.lat);
    setLocationLon(resolved.lon);
    if (resolved.locationName) {
      setLocationName(resolved.locationName);
    }
    if (resolved.timezone) {
      setTimezone(resolved.timezone);
    }
    return resolved;
  };

  const handleGetCurrentLocation = () => {
    setIsGettingLocation(true);
    const finalizeFromCoordinates = async (lat: string, lon: string) => {
      // Reverse geocode to get city name
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
          { headers: { 'User-Agent': 'WardrobeAI/1.0' } }
        );
        if (response.ok) {
          const data = await response.json();
          const nextLocationName = formatReverseGeocodedLocation(data);
          if (nextLocationName) {
            setLocationName(nextLocationName);
            return nextLocationName;
          }
        }
      } catch {
        // Ignore geocoding errors, we still have coordinates
      }

      return undefined;
    };

    const fallbackToNetworkLocation = async (reason?: string) => {
      if (!isNetworkLocationFallbackEnabled()) {
        toast.error(reason || tLocation('unableToDetect'));
        setIsGettingLocation(false);
        return;
      }
      try {
        await detectLocationFromNetwork();
        toast.success(
          reason
            ? tLocation('approxFilledWithReason', { reason })
            : tLocation('approxFilled')
        );
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error
          ? fallbackError.message
          : tLocation('unableToDetect');
        toast.error(fallbackMessage);
      } finally {
        setIsGettingLocation(false);
      }
    };

    if (!navigator.geolocation) {
      void fallbackToNetworkLocation(tLocation('notSupported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lon = position.coords.longitude.toFixed(6);
        setLocationLat(lat);
        setLocationLon(lon);
        await finalizeFromCoordinates(lat, lon);
        setIsGettingLocation(false);
        toast.success(tLocation('detectedToast'));
      },
      (error) => {
        void fallbackToNetworkLocation(
          getGeolocationFailureMessage(error)
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSaveLocation = async () => {
    const lat = parseFloat(locationLat);
    const lon = parseFloat(locationLon);

    if (isNaN(lat) || isNaN(lon)) {
      toast.error(tLocation('invalidLatLon'));
      return;
    }

    if (lat < -90 || lat > 90) {
      toast.error(tLocation('latRange'));
      return;
    }

    if (lon < -180 || lon > 180) {
      toast.error(tLocation('lonRange'));
      return;
    }

    try {
      await updateUserProfile.mutateAsync({
        location_lat: lat,
        location_lon: lon,
        location_name: locationName || undefined,
        timezone: timezone,
      });
      toast.success(tLocation('savedToast'));
    } catch {
      toast.error(tLocation('saveError'));
    }
  };

  const hasLocationChanges = userProfile && (
    locationName !== (userProfile.location_name || '') ||
    locationLat !== (userProfile.location_lat?.toString() || '') ||
    locationLon !== (userProfile.location_lon?.toString() || '') ||
    timezone !== (userProfile.timezone || 'UTC')
  );

  const isDirty = hasChanges || measurementsDirty || !!hasLocationChanges;

  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);

    const origPush = history.pushState.bind(history);
    history.pushState = function (...args) {
      if (window.confirm(t('header.unsavedChanges'))) {
        origPush(...args);
      }
    };

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      history.pushState = origPush;
    };
  }, [isDirty]);

  const handleToggleUnits = () => {
    const newSystem: UnitSystem = unitSystem === 'metric' ? 'imperial' : 'metric';
    const converted: Record<string, string> = {};
    const numericKeys = ['chest', 'waist', 'hips', 'inseam', 'height', 'weight'];
    for (const [key, value] of Object.entries(measurements)) {
      const trimmed = value.trim();
      if (!trimmed) { converted[key] = value; continue; }
      if (numericKeys.includes(key)) {
        const num = parseFloat(trimmed);
        if (!isNaN(num)) {
          converted[key] = String(convertMeasurement(num, key, unitSystem, newSystem));
          continue;
        }
      }
      converted[key] = value;
    }
    setMeasurements(converted);
    setUnitSystem(newSystem);
    localStorage.setItem('wardrowbe_unit_system', newSystem);
  };

  const handleMeasurementChange = (key: string, value: string) => {
    setMeasurements((prev) => ({ ...prev, [key]: value }));
    setMeasurementsDirty(true);
  };

  const handleSaveMeasurements = async () => {
    const parsed: Record<string, number | string> = {};
    const numericKeys = ['chest', 'waist', 'hips', 'inseam', 'height', 'weight'];
    for (const [key, value] of Object.entries(measurements)) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (numericKeys.includes(key)) {
        const num = parseFloat(trimmed);
        if (isNaN(num) || num <= 0) {
          const fieldLabel = (() => {
            try {
              return tFields(key);
            } catch {
              return key.charAt(0).toUpperCase() + key.slice(1);
            }
          })();
          toast.error(tMeasurements('mustBePositive', { field: fieldLabel }));
          return;
        }
        parsed[key] = convertMeasurement(num, key, unitSystem, 'metric');
      } else {
        parsed[key] = trimmed;
      }
    }
    try {
      await updateUserProfile.mutateAsync({
        body_measurements: Object.keys(parsed).length > 0 ? parsed : null,
      });
      setMeasurementsDirty(false);
      toast.success(tMeasurements('saved'));
    } catch (e) {
      toast.error(getErrorMessage(e, tMeasurements('saveError')));
    }
  };

  const handleTestEndpoint = async (index: number, url: string) => {
    setEndpointTests((prev) => ({ ...prev, [index]: { status: 'testing' } }));
    try {
      const result = await testEndpoint.mutateAsync(url);
      setEndpointTests((prev) => ({
        ...prev,
        [index]: {
          status: result.status,
          models: result.available_models,
          visionModels: result.vision_models,
          textModels: result.text_models,
          error: result.error,
        },
      }));
    } catch (error) {
      setEndpointTests((prev) => ({
        ...prev,
        [index]: { status: 'error', error: tAiEndpoints('testFailed') },
      }));
    }
  };

  useEffect(() => {
    if (preferences) {
      setFormData(preferences);
      setHasChanges(false);
    }
  }, [preferences]);

  const updateField = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'color_favorites' && Array.isArray(value)) {
        next.color_avoid = (prev.color_avoid || []).filter(
          (c) => !(value as string[]).includes(c)
        );
      } else if (key === 'color_avoid' && Array.isArray(value)) {
        next.color_favorites = (prev.color_favorites || []).filter(
          (c) => !(value as string[]).includes(c)
        );
      }
      return next;
    });
    setHasChanges(true);
  };

  const updateStyleProfile = (key: keyof StyleProfile, value: number) => {
    setFormData((prev) => ({
      ...prev,
      style_profile: {
        ...(prev.style_profile || {
          casual: 50,
          formal: 50,
          sporty: 50,
          minimalist: 50,
          bold: 50,
        }),
        [key]: value,
      },
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await updatePreferences.mutateAsync(formData);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save preferences:', error);
    }
  };

  const handleReset = async () => {
    if (confirm(t('header.resetConfirm'))) {
      try {
        await resetPreferences.mutateAsync();
      } catch (error) {
        console.error('Failed to reset preferences:', error);
      }
    }
  };

  if (isLoading || isLoadingProfile) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-10 py-10 sm:py-14 space-y-10">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <p className="label-editorial text-gold">{t('title')}</p>
          <h1 className="font-display italic font-black text-display-lg leading-none">
            {t('title')}
          </h1>
          <p className="font-editorial italic text-lg text-muted-foreground">
            {t('header.manageSubtitle')}
          </p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={handleReset} disabled={resetPreferences.isPending}
            className="h-11 px-5 border border-primary/70 text-primary uppercase tracking-widest text-xs hover:bg-primary hover:text-primary-foreground transition-all duration-200 ease-editorial disabled:opacity-50 inline-flex items-center gap-2">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t('header.reset')}
          </button>
          <button type="button" onClick={handleSave} disabled={!hasChanges || updatePreferences.isPending}
            className="h-11 px-5 bg-primary text-primary-foreground border border-primary uppercase tracking-widest text-xs hover:bg-transparent hover:text-primary transition-all duration-200 ease-editorial disabled:opacity-50 inline-flex items-center gap-2">
            {updatePreferences.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
            {tCommon('save')}
          </button>
        </div>
      </header>

      <div className="divider-gold" />

      <div className="grid gap-6">
        {/* Account Section */}
        <Card>
          <CardHeader>
            <CardTitle>{tAccount('title')}</CardTitle>
            <CardDescription>{tAccount('description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{tAccount('name')}</Label>
                <Input value={userProfile?.display_name || ''} disabled />
              </div>
              <div className="space-y-2">
                <Label>{t('profile.email')}</Label>
                <Input value={userProfile?.email || ''} disabled />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Integrations Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t('integrations.title')}</CardTitle>
            <CardDescription>{t('integrations.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href="/dashboard/settings/integrations">{t('integrations.cta')}</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Location Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              {tLocation('title')}
            </CardTitle>
            <CardDescription>
              {tLocation('description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{tLocation('cityLabel')}</Label>
              <Input
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder={tLocation('cityPlaceholder')}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{tLocation('latitude')}</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={locationLat}
                  onChange={(e) => setLocationLat(e.target.value)}
                  placeholder={tLocation('latitudePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{tLocation('longitude')}</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={locationLon}
                  onChange={(e) => setLocationLon(e.target.value)}
                  placeholder={tLocation('longitudePlaceholder')}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{tLocation('timezone')}</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue placeholder={tLocation('timezonePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTC">{tTz('utc')}</SelectItem>
                  <SelectItem value="America/New_York">{tTz('easternUS')}</SelectItem>
                  <SelectItem value="America/Chicago">{tTz('centralUS')}</SelectItem>
                  <SelectItem value="America/Denver">{tTz('mountainUS')}</SelectItem>
                  <SelectItem value="America/Los_Angeles">{tTz('pacificUS')}</SelectItem>
                  <SelectItem value="Europe/London">{tTz('londonUK')}</SelectItem>
                  <SelectItem value="Europe/Paris">{tTz('parisEU')}</SelectItem>
                  <SelectItem value="Europe/Berlin">{tTz('berlinEU')}</SelectItem>
                  <SelectItem value="Asia/Tokyo">{tTz('tokyoJP')}</SelectItem>
                  <SelectItem value="Asia/Shanghai">{tTz('shanghaiCN')}</SelectItem>
                  <SelectItem value="Asia/Kolkata">{tTz('indiaIST')}</SelectItem>
                  <SelectItem value="Asia/Kathmandu">{tTz('nepalNPT')}</SelectItem>
                  <SelectItem value="Asia/Dubai">{tTz('dubaiUAE')}</SelectItem>
                  <SelectItem value="Australia/Sydney">{tTz('sydneyAU')}</SelectItem>
                  <SelectItem value="Pacific/Auckland">{tTz('aucklandNZ')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleGetCurrentLocation}
                disabled={isGettingLocation}
              >
                {isGettingLocation ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Navigation className="h-4 w-4 mr-2" />
                )}
                {tLocation('useMyLocation')}
              </Button>
              <Button
                onClick={handleSaveLocation}
                disabled={!hasLocationChanges || updateUserProfile.isPending}
              >
                {updateUserProfile.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {tLocation('saveLocation')}
              </Button>
            </div>
            {!locationLat && !locationLon && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {tLocation('required')}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Body Measurements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ruler className="h-5 w-5" />
              {tMeasurements('title')}
            </CardTitle>
            <CardDescription>{tMeasurements('description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <Label>{tMeasurements('unitSystem')}</Label>
              <Button variant="outline" size="sm" onClick={handleToggleUnits}>
                {unitSystem === 'metric' ? tMeasurements('metric') : tMeasurements('imperial')}
              </Button>
            </div>

            <div>
              <Label className="text-muted-foreground mb-3 block">{tMeasurements('body')}</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {BODY_MEASUREMENT_FIELDS.map((field) => {
                  const unit = unitSystem === 'metric' ? field.unitMetric : field.unitImperial;
                  const placeholder = unitSystem === 'metric' ? field.placeholderMetric : field.placeholderImperial;
                  return (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-sm">{tFields(field.key)}</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          value={measurements[field.key] ?? ''}
                          onChange={(e) => handleMeasurementChange(field.key, e.target.value)}
                          placeholder={placeholder}
                          className="flex-1"
                        />
                        <span className="text-sm text-muted-foreground min-w-[2rem] text-center">{unit}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-muted-foreground mb-3 block">{tMeasurements('sizes')}</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {SIZE_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-sm">{tFields(field.labelKey)}</Label>
                    <Input
                      value={measurements[field.key] ?? ''}
                      onChange={(e) => handleMeasurementChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                    />
                  </div>
                ))}
              </div>
            </div>

            {measurementsDirty && (
              <Button
                onClick={handleSaveMeasurements}
                disabled={updateUserProfile.isPending}
                size="sm"
              >
                {updateUserProfile.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{tCommon('saving')}</>
                ) : (
                  <><Save className="mr-2 h-4 w-4" />{tMeasurements('save')}</>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Color Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>{tColors('title')}</CardTitle>
            <CardDescription>
              {tColors('description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ColorPicker
              label={tColors('favorites')}
              selected={formData.color_favorites || []}
              onChange={(colors) => updateField('color_favorites', colors)}
            />
            <ColorPicker
              label={tColors('avoid')}
              selected={formData.color_avoid || []}
              onChange={(colors) => updateField('color_avoid', colors)}
            />
          </CardContent>
        </Card>

        {/* Style Profile */}
        <Card>
          <CardHeader>
            <CardTitle>{tStyleProfile('title')}</CardTitle>
            <CardDescription>
              {tStyleProfile('description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <StyleSlider
              label={tStyles('casual')}
              value={formData.style_profile?.casual ?? 50}
              onChange={(v) => updateStyleProfile('casual', v)}
            />
            <StyleSlider
              label={tStyles('formal')}
              value={formData.style_profile?.formal ?? 50}
              onChange={(v) => updateStyleProfile('formal', v)}
            />
            <StyleSlider
              label={tStyles('sporty')}
              value={formData.style_profile?.sporty ?? 50}
              onChange={(v) => updateStyleProfile('sporty', v)}
            />
            <StyleSlider
              label={tStyles('minimalist')}
              value={formData.style_profile?.minimalist ?? 50}
              onChange={(v) => updateStyleProfile('minimalist', v)}
            />
            <StyleSlider
              label={tStyles('bold')}
              value={formData.style_profile?.bold ?? 50}
              onChange={(v) => updateStyleProfile('bold', v)}
            />
          </CardContent>
        </Card>

        {/* Temperature & Comfort */}
        <Card>
          <CardHeader>
            <CardTitle>{tComfort('title')}</CardTitle>
            <CardDescription>
              {tComfort('description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{tComfort('temperatureUnit')}</Label>
                <Select
                  value={formData.temperature_unit || 'celsius'}
                  onValueChange={(v) =>
                    updateField('temperature_unit', v as 'celsius' | 'fahrenheit')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="celsius">{tPreferences('celsius')}</SelectItem>
                    <SelectItem value="fahrenheit">{tPreferences('fahrenheit')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{tComfort('sensitivity')}</Label>
                <Select
                  value={formData.temperature_sensitivity || 'normal'}
                  onValueChange={(v) =>
                    updateField('temperature_sensitivity', v as 'low' | 'normal' | 'high')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{tComfort('sensitivityLow')}</SelectItem>
                    <SelectItem value="normal">{tComfort('sensitivityNormal')}</SelectItem>
                    <SelectItem value="high">{tComfort('sensitivityHigh')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{tComfort('layering')}</Label>
                <Select
                  value={formData.layering_preference || 'moderate'}
                  onValueChange={(v) =>
                    updateField('layering_preference', v as 'minimal' | 'moderate' | 'heavy')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimal">{tComfort('layeringMinimal')}</SelectItem>
                    <SelectItem value="moderate">{tComfort('layeringModerate')}</SelectItem>
                    <SelectItem value="heavy">{tComfort('layeringHeavy')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(() => {
                const unit = formData.temperature_unit || 'celsius';
                const isFahrenheit = unit === 'fahrenheit';
                const coldC = formData.cold_threshold ?? 10;
                const hotC = formData.hot_threshold ?? 25;
                const unitLabel = isFahrenheit ? '°F' : '°C';
                return (
                  <>
                    <div className="space-y-2">
                      <Label>{tComfort('coldThreshold', { unit: unitLabel })}</Label>
                      <Input
                        type="number"
                        value={isFahrenheit ? Math.round(toF(coldC)) : coldC}
                        onChange={(e) => {
                          const raw = e.target.value === '' ? (isFahrenheit ? 50 : 10) : parseInt(e.target.value);
                          updateField('cold_threshold', isFahrenheit ? Math.round(toCelsius(raw)) : raw);
                        }}
                        min={isFahrenheit ? -4 : -20}
                        max={isFahrenheit ? 86 : 30}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{tComfort('hotThreshold', { unit: unitLabel })}</Label>
                      <Input
                        type="number"
                        value={isFahrenheit ? Math.round(toF(hotC)) : hotC}
                        onChange={(e) => {
                          const raw = e.target.value === '' ? (isFahrenheit ? 77 : 25) : parseInt(e.target.value);
                          updateField('hot_threshold', isFahrenheit ? Math.round(toCelsius(raw)) : raw);
                        }}
                        min={isFahrenheit ? 50 : 10}
                        max={isFahrenheit ? 113 : 45}
                      />
                    </div>
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Recommendation Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{tRecommendations('title')}</CardTitle>
            <CardDescription>
              {tRecommendations('description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{tRecommendations('defaultOccasion')}</Label>
                <Select
                  value={formData.default_occasion || 'casual'}
                  onValueChange={(v) => updateField('default_occasion', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OCCASIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{tRecommendations('varietyLevel')}</Label>
                <Select
                  value={formData.variety_level || 'moderate'}
                  onValueChange={(v) =>
                    updateField('variety_level', v as 'low' | 'moderate' | 'high')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{tRecommendations('varietyLow')}</SelectItem>
                    <SelectItem value="moderate">{tRecommendations('varietyModerate')}</SelectItem>
                    <SelectItem value="high">{tRecommendations('varietyHigh')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{tRecommendations('avoidRepeatDays')}</Label>
                <Input
                  type="number"
                  value={formData.avoid_repeat_days ?? 7}
                  onChange={(e) => updateField('avoid_repeat_days', e.target.value === '' ? 7 : parseInt(e.target.value))}
                  min={0}
                  max={30}
                />
              </div>
              <div className="space-y-2">
                <Label>{tRecommendations('preferUnderused')}</Label>
                <Select
                  value={formData.prefer_underused_items ? 'yes' : 'no'}
                  onValueChange={(v) => updateField('prefer_underused_items', v === 'yes')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">{tCommon('yes')}</SelectItem>
                    <SelectItem value="no">{tCommon('no')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Endpoints */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              {tAiEndpoints('title')}
            </CardTitle>
            <CardDescription>
              {tAiEndpoints('description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(formData.ai_endpoints || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {tAiEndpoints('empty')}
              </p>
            ) : (
              <div className="space-y-3">
                {(formData.ai_endpoints || []).map((endpoint, index) => (
                  <div
                    key={index}
                    className={`border rounded-lg p-4 space-y-3 ${
                      !endpoint.enabled ? 'opacity-60 bg-muted/50' : ''
                    }`}
                  >
                    <div className="space-y-2">
                      {/* Header row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex flex-col shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 p-0"
                              disabled={index === 0}
                              onClick={() => {
                                const updated = [...(formData.ai_endpoints || [])];
                                [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
                                updateField('ai_endpoints', updated);
                              }}
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 p-0"
                              disabled={index === (formData.ai_endpoints || []).length - 1}
                              onClick={() => {
                                const updated = [...(formData.ai_endpoints || [])];
                                [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
                                updateField('ai_endpoints', updated);
                              }}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </div>
                          <span className="font-medium text-sm truncate">
                            {endpoint.name || tAiEndpoints('endpointN', { index: index + 1 })}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Switch
                            checked={endpoint.enabled}
                            onCheckedChange={(checked) => {
                              const updated = [...(formData.ai_endpoints || [])];
                              updated[index] = { ...updated[index], enabled: checked };
                              updateField('ai_endpoints', updated);
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => {
                              const updated = (formData.ai_endpoints || []).filter((_, i) => i !== index);
                              updateField('ai_endpoints', updated);
                              setEndpointTests((prev) => {
                                const newTests = { ...prev };
                                delete newTests[index];
                                return newTests;
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {/* Status badges and test button */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={endpoint.enabled ? 'default' : 'secondary'} className="text-xs">
                          {endpoint.enabled ? tAiEndpoints('active') : tAiEndpoints('disabled')}
                        </Badge>
                        {endpointTests[index]?.status === 'connected' && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                            {tAiEndpoints('connected')}
                          </Badge>
                        )}
                        {endpointTests[index]?.status === 'error' && (
                          <Badge variant="outline" className="text-xs text-red-600 border-red-600">
                            {tAiEndpoints('errorBadge')}
                          </Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs ml-auto"
                          onClick={() => handleTestEndpoint(index, endpoint.url)}
                          disabled={endpointTests[index]?.status === 'testing' || !endpoint.url}
                        >
                          {endpointTests[index]?.status === 'testing' ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : null}
                          {tAiEndpoints('testConnection')}
                        </Button>
                      </div>
                    </div>
                    {/* Test Results */}
                    {endpointTests[index]?.status === 'connected' && endpointTests[index]?.models && (
                      <div className="text-xs space-y-1 p-2 bg-green-50 dark:bg-green-950 rounded overflow-hidden">
                        <p className="font-medium text-green-700 dark:text-green-300">
                          {tAiEndpoints('modelsAvailable', { count: endpointTests[index].models?.length ?? 0 })}
                        </p>
                        {endpointTests[index].visionModels && endpointTests[index].visionModels!.length > 0 && (
                          <p className="text-green-600 dark:text-green-400 truncate" title={endpointTests[index].visionModels?.join(', ')}>
                            {tAiEndpoints('vision')}: {endpointTests[index].visionModels?.slice(0, 3).join(', ')}
                            {(endpointTests[index].visionModels?.length || 0) > 3 && '...'}
                          </p>
                        )}
                        {endpointTests[index].textModels && endpointTests[index].textModels!.length > 0 && (
                          <p className="text-green-600 dark:text-green-400 truncate" title={endpointTests[index].textModels?.join(', ')}>
                            {tAiEndpoints('text')}: {endpointTests[index].textModels?.slice(0, 3).join(', ')}
                            {(endpointTests[index].textModels?.length || 0) > 3 && '...'}
                          </p>
                        )}
                      </div>
                    )}
                    {endpointTests[index]?.status === 'error' && (
                      <div className="text-xs p-2 bg-red-50 dark:bg-red-950 rounded text-red-600 dark:text-red-400 break-words">
                        {endpointTests[index].error}
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{tAiEndpoints('name')}</Label>
                        <Input
                          value={endpoint.name}
                          onChange={(e) => {
                            const updated = [...(formData.ai_endpoints || [])];
                            updated[index] = { ...updated[index], name: e.target.value };
                            updateField('ai_endpoints', updated);
                          }}
                          placeholder="e.g., Local Ollama"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{tAiEndpoints('url')}</Label>
                        <Input
                          value={endpoint.url}
                          onChange={(e) => {
                            const updated = [...(formData.ai_endpoints || [])];
                            updated[index] = { ...updated[index], url: e.target.value };
                            updateField('ai_endpoints', updated);
                          }}
                          placeholder="http://localhost:11434/v1"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{tAiEndpoints('visionModel')}</Label>
                        <Input
                          value={endpoint.vision_model}
                          onChange={(e) => {
                            const updated = [...(formData.ai_endpoints || [])];
                            updated[index] = { ...updated[index], vision_model: e.target.value };
                            updateField('ai_endpoints', updated);
                          }}
                          placeholder="moondream"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{tAiEndpoints('textModel')}</Label>
                        <Input
                          value={endpoint.text_model}
                          onChange={(e) => {
                            const updated = [...(formData.ai_endpoints || [])];
                            updated[index] = { ...updated[index], text_model: e.target.value };
                            updateField('ai_endpoints', updated);
                          }}
                          placeholder="phi3:mini"
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  const newEndpoint: AIEndpoint = {
                    name: tAiEndpoints('endpointN', { index: (formData.ai_endpoints || []).length + 1 }),
                    url: 'http://localhost:11434/v1',
                    vision_model: 'moondream',
                    text_model: 'phi3:mini',
                    enabled: true,
                  };
                  updateField('ai_endpoints', [...(formData.ai_endpoints || []), newEndpoint]);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                {tAiEndpoints('addEndpoint')}
              </Button>
              {hasChanges && (
                <Button onClick={handleSave} disabled={updatePreferences.isPending}>
                  {updatePreferences.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  {tCommon('save')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
