'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Bell, Loader2, Save, RotateCcw, MapPin, Ruler, Sun, Moon, Monitor, Palette, Smartphone } from 'lucide-react';
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
import { usePreferences, useUpdatePreferences, useResetPreferences } from '@/lib/hooks/use-preferences';
import { AISettingsCard } from '@/components/ai/ai-settings-card';
import { useUserProfile, useUpdateUserProfile } from '@/lib/hooks/use-user';
import { OCCASIONS, Preferences, StyleProfile } from '@/lib/types';
import type { SavedLocation } from '@/lib/geo';
import { LocationPicker } from '@/components/settings/location-picker';
import { TimezoneCombobox } from '@/components/settings/timezone-combobox';
import { ColorPreferences } from '@/components/settings/color-preferences';
import { toF, toCelsius } from '@/lib/temperature';
import { toast } from 'sonner';
import { SecurityCard } from '@/components/settings/security-card';
import { AvatarSettings } from '@/components/settings/avatar-settings';
import { PageHeader } from '@/components/page-header';
import { LanguageSwitcher } from '@/components/language-switcher';
import { cn } from '@/lib/utils';

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
  { key: 'height', unitMetric: 'cm', unitImperial: 'in', placeholderMetric: '178', placeholderImperial: '70' },
  { key: 'weight', unitMetric: 'kg', unitImperial: 'lbs', placeholderMetric: '75', placeholderImperial: '165' },
  { key: 'chest', unitMetric: 'cm', unitImperial: 'in', placeholderMetric: '96', placeholderImperial: '38' },
  { key: 'waist', unitMetric: 'cm', unitImperial: 'in', placeholderMetric: '82', placeholderImperial: '32' },
  { key: 'hips', unitMetric: 'cm', unitImperial: 'in', placeholderMetric: '98', placeholderImperial: '39' },
] as const;

const SIZE_FIELDS = [
  { key: 'shirt_size', labelKey: 'shirtSize', placeholder: 'M, L, XL' },
  { key: 'pants_size', labelKey: 'pantsSize', placeholder: '32, 34' },
  { key: 'dress_size', labelKey: 'dressSize', placeholder: '8, 10' },
  { key: 'shoe_size', labelKey: 'shoeSize', placeholder: '10, 42' },
] as const;

function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  return fallback;
}

const THEME_OPTIONS = [
  { value: 'light', labelKey: 'themeLight', Icon: Sun },
  { value: 'dark', labelKey: 'themeDark', Icon: Moon },
  { value: 'system', labelKey: 'themeSystem', Icon: Monitor },
] as const;

/** Claro / Oscuro / Sistema as a pill segmented control (next-themes). */
function ThemeSelector() {
  const t = useTranslations('settings.appearance');
  const { theme, setTheme } = useTheme();
  // next-themes only knows the stored theme on the client; avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? theme ?? 'system' : undefined;

  return (
    <div role="group" aria-label={t('theme')} className="grid w-full max-w-sm grid-cols-3 gap-1 rounded-full bg-panel p-1">
      {THEME_OPTIONS.map(({ value, labelKey, Icon }) => {
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active ? 'bg-primary text-primary-foreground' : 'bg-transparent text-foreground hover:bg-background'
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={active ? 2 : 1.75} aria-hidden />
            {t(labelKey)}
          </button>
        );
      })}
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
  const tAccount = useTranslations('settings.account');
  const tAppearance = useTranslations('settings.appearance');

  const [formData, setFormData] = useState<Partial<Preferences>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Location and timezone state
  const [location, setLocation] = useState<SavedLocation>({ name: '', lat: null, lon: null });
  const [timezone, setTimezone] = useState('UTC');

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
      setLocation({
        name: userProfile.location_name || '',
        lat: userProfile.location_lat ?? null,
        lon: userProfile.location_lon ?? null,
      });
      // Not auto-switched to the device zone (that would mark the form dirty);
      // TimezoneCombobox offers it as a one-tap suggestion instead.
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

  const handleLocationChange = (next: SavedLocation) => {
    setLocation(next);
    // Picking a city brings its timezone along; the user can still override it.
    if (next.timezone) setTimezone(next.timezone);
  };

  const handleSaveLocation = async () => {
    const { lat, lon } = location;
    if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) {
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
        location_name: location.name || undefined,
        timezone,
      });
      toast.success(tLocation('savedToast'));
    } catch {
      toast.error(tLocation('saveError'));
    }
  };

  const hasLocationChanges = userProfile && (
    location.name !== (userProfile.location_name || '') ||
    location.lat !== (userProfile.location_lat ?? null) ||
    location.lon !== (userProfile.location_lon ?? null) ||
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
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <PageHeader
        title={t('title')}
        description={t('header.manageSubtitle')}
        action={
          <>
            <Button variant="secondary" onClick={handleReset} disabled={resetPreferences.isPending}>
              <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
              {t('header.reset')}
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || updatePreferences.isPending}>
              {updatePreferences.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              ) : (
                <Save className="h-4 w-4" strokeWidth={1.75} />
              )}
              {tCommon('save')}
            </Button>
          </>
        }
      />

      <div className="grid gap-6">
        {/* Account Section */}
        <Card>
          <CardHeader>
            <CardTitle>{tAccount('title')}</CardTitle>
            <CardDescription>{tAccount('description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <AvatarSettings user={userProfile} />
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

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {tAppearance('title')}
            </CardTitle>
            <CardDescription>{tAppearance('description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <p className="eyebrow">{tAppearance('theme')}</p>
              <ThemeSelector />
            </div>
            <LanguageSwitcher />
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

        {/* Notifications + install the PWA */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {t('notificationsCard.title')}
            </CardTitle>
            <CardDescription>{t('notificationsCard.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/notifications">{t('notificationsCard.manage')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/install">
                <Smartphone className="h-4 w-4" strokeWidth={1.75} />
                {t('notificationsCard.install')}
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* AI access (free plan / admin grant / own key) */}
        <AISettingsCard />

        {/* Security: optional password on top of the magic link */}
        <SecurityCard user={userProfile} />

        {/* Location Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              {tLocation('title')}
            </CardTitle>
            <CardDescription>
              {tLocation('description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <LocationPicker id="settings-location" value={location} onChange={handleLocationChange} />
            <TimezoneCombobox
              id="settings-timezone"
              value={timezone}
              onChange={setTimezone}
              cityTimezone={location.timezone}
              cityName={location.name.split(',')[0]}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleSaveLocation}
                disabled={!hasLocationChanges || updateUserProfile.isPending}
              >
                {updateUserProfile.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {tLocation('saveLocation')}
              </Button>
              {(location.lat === null || location.lon === null) && (
                <p className="text-sm font-medium text-warning">{tLocation('required')}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Body Measurements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ruler className="h-5 w-5" strokeWidth={1.75} aria-hidden />
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
              <Label className="eyebrow mb-3 block">{tMeasurements('body')}</Label>
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
                          placeholder={tMeasurements('example', { value: placeholder })}
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
              <Label className="eyebrow mb-3 block">{tMeasurements('sizes')}</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {SIZE_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-sm">{tFields(field.labelKey)}</Label>
                    <Input
                      value={measurements[field.key] ?? ''}
                      onChange={(e) => handleMeasurementChange(field.key, e.target.value)}
                      placeholder={tMeasurements('example', { value: field.placeholder })}
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
                  <><Loader2 className="h-4 w-4 animate-spin" />{tCommon('saving')}</>
                ) : (
                  <><Save className="h-4 w-4" />{tMeasurements('save')}</>
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
          <CardContent className="space-y-8">
            <ColorPreferences
              label={tColors('favorites')}
              selected={formData.color_favorites || []}
              onChange={(colors) => updateField('color_favorites', colors)}
              tone="favorite"
            />
            <div className="h-px bg-border" aria-hidden />
            <ColorPreferences
              label={tColors('avoid')}
              selected={formData.color_avoid || []}
              onChange={(colors) => updateField('color_avoid', colors)}
              tone="avoid"
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
      </div>
    </div>
  );
}
