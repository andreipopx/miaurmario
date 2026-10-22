'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsSection, SettingsSubpage } from '@/components/settings/subpage';
import { useUserProfile, useUpdateUserProfile } from '@/lib/hooks/use-user';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { getErrorMessage } from '@/lib/api';

const CM_TO_IN = 0.393701;
const IN_TO_CM = 2.54;
const KG_TO_LBS = 2.20462;
const LBS_TO_KG = 0.453592;

type UnitSystem = 'metric' | 'imperial';
const NUMERIC_KEYS = ['chest', 'waist', 'hips', 'inseam', 'height', 'weight'];

function convertMeasurement(value: number, key: string, from: UnitSystem, to: UnitSystem): number {
  if (from === to) return value;
  const isWeight = key === 'weight';
  if (from === 'metric' && to === 'imperial') {
    return Math.round((isWeight ? value * KG_TO_LBS : value * CM_TO_IN) * 10) / 10;
  }
  return Math.round((isWeight ? value * LBS_TO_KG : value * IN_TO_CM) * 10) / 10;
}

const BODY_FIELDS = [
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

/** Medidas: body and sizes, in the unit system you tap into (remembered on this device). */
export default function MeasurementsSettingsPage() {
  const t = useTranslations('settings.measurements');
  const tFields = useTranslations('settings.measurements.fields');
  const tCommon = useTranslations('common');
  const { data: userProfile, isLoading } = useUserProfile();
  const updateUserProfile = useUpdateUserProfile();

  const [measurements, setMeasurements] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
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

  useUnsavedChanges(dirty);

  useEffect(() => {
    if (!userProfile?.body_measurements) return;
    const initial: Record<string, string> = {};
    for (const [key, value] of Object.entries(userProfile.body_measurements)) {
      initial[key] =
        NUMERIC_KEYS.includes(key) && typeof value === 'number'
          ? String(convertMeasurement(value, key, 'metric', unitSystemRef.current))
          : String(value);
    }
    setMeasurements(initial);
  }, [userProfile]);

  const toggleUnits = () => {
    const next: UnitSystem = unitSystem === 'metric' ? 'imperial' : 'metric';
    const converted: Record<string, string> = {};
    for (const [key, value] of Object.entries(measurements)) {
      const num = parseFloat(value.trim());
      converted[key] =
        value.trim() && NUMERIC_KEYS.includes(key) && !isNaN(num)
          ? String(convertMeasurement(num, key, unitSystem, next))
          : value;
    }
    setMeasurements(converted);
    setUnitSystem(next);
    localStorage.setItem('wardrowbe_unit_system', next);
  };

  const change = (key: string, value: string) => {
    setMeasurements((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    const parsed: Record<string, number | string> = {};
    for (const [key, value] of Object.entries(measurements)) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (NUMERIC_KEYS.includes(key)) {
        const num = parseFloat(trimmed);
        if (isNaN(num) || num <= 0) {
          const field = tFields.has(key as 'height') ? tFields(key as 'height') : key;
          toast.error(t('mustBePositive', { field }));
          return;
        }
        parsed[key] = convertMeasurement(num, key, unitSystem, 'metric');
      } else {
        parsed[key] = trimmed;
      }
    }
    try {
      // An empty object, not null: the backend ignores null, so clearing every
      // field would otherwise keep the old values.
      await updateUserProfile.mutateAsync({ body_measurements: parsed });
      setDirty(false);
      toast.success(t('saved'));
    } catch (e) {
      toast.error(getErrorMessage(e, t('saveError')));
    }
  };

  return (
    <SettingsSubpage
      title={t('title')}
      loading={isLoading || !userProfile}
      action={
        <Button variant="outline" size="sm" onClick={toggleUnits}>
          {unitSystem === 'metric' ? t('metric') : t('imperial')}
        </Button>
      }
    >
      <div className="space-y-8">
        <SettingsSection title={t('body')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {BODY_FIELDS.map((field) => {
              const unit = unitSystem === 'metric' ? field.unitMetric : field.unitImperial;
              const placeholder = unitSystem === 'metric' ? field.placeholderMetric : field.placeholderImperial;
              return (
                <div key={field.key} className="space-y-1">
                  <Label htmlFor={`m-${field.key}`} className="text-sm">
                    {tFields(field.key)}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`m-${field.key}`}
                      type="number"
                      step="0.1"
                      min="0"
                      value={measurements[field.key] ?? ''}
                      onChange={(e) => change(field.key, e.target.value)}
                      placeholder={t('example', { value: placeholder })}
                      className="flex-1"
                    />
                    <span className="min-w-[2rem] text-center text-sm text-muted-foreground">{unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </SettingsSection>

        <SettingsSection title={t('sizes')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SIZE_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`m-${field.key}`} className="text-sm">
                  {tFields(field.labelKey)}
                </Label>
                <Input
                  id={`m-${field.key}`}
                  value={measurements[field.key] ?? ''}
                  onChange={(e) => change(field.key, e.target.value)}
                  placeholder={t('example', { value: field.placeholder })}
                />
              </div>
            ))}
          </div>
        </SettingsSection>

        <Button onClick={save} disabled={!dirty || updateUserProfile.isPending}>
          {updateUserProfile.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {tCommon('saving')}
            </>
          ) : (
            tCommon('save')
          )}
        </Button>
      </div>
    </SettingsSubpage>
  );
}
