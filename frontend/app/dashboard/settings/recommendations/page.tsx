'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsSection, SettingsSubpage } from '@/components/settings/subpage';
import { usePreferences, useResetPreferences, useUpdatePreferences } from '@/lib/hooks/use-preferences';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { getErrorMessage } from '@/lib/api';
import { OCCASIONS, type Preferences, type StyleProfile } from '@/lib/types';
import { toCelsius, toF } from '@/lib/temperature';

/** The preference fields this screen owns; it PATCHes only these. */
const FIELDS = [
  'style_profile',
  'temperature_unit',
  'temperature_sensitivity',
  'layering_preference',
  'cold_threshold',
  'hot_threshold',
  'default_occasion',
  'variety_level',
  'avoid_repeat_days',
  'prefer_underused_items',
] as const;
type Field = (typeof FIELDS)[number];
type Form = Partial<Pick<Preferences, Field>>;

const DEFAULT_STYLE: StyleProfile = { casual: 50, formal: 50, sporty: 50, minimalist: 50, bold: 50 };
const STYLES = ['casual', 'formal', 'sporty', 'minimalist', 'bold'] as const;

function pick(preferences: Preferences): Form {
  const out: Form = {};
  for (const f of FIELDS) (out as Record<string, unknown>)[f] = preferences[f];
  return out;
}

function StyleSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-sm text-muted-foreground">{value}%</span>
      </div>
      <Slider value={[value]} onValueChange={(vals) => onChange(vals[0])} min={0} max={100} step={10} />
    </div>
  );
}

/** Recomendaciones: how Stinky weighs style, weather and variety when he proposes a look. */
export default function RecommendationsSettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const tStyles = useTranslations('settings.styleProfile.styles');
  const tComfort = useTranslations('settings.comfort');
  const tPreferences = useTranslations('settings.preferences');
  const tRec = useTranslations('settings.recommendations');
  const tOccasions = useTranslations('suggest.occasions');
  const confirm = useConfirm();

  const { data: preferences, isLoading } = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const resetPreferences = useResetPreferences();

  const [form, setForm] = useState<Form>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!preferences) return;
    setForm(pick(preferences));
    setDirty(false);
  }, [preferences]);

  useUnsavedChanges(dirty);

  const update = <K extends Field>(key: K, value: Preferences[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };
  const updateStyle = (key: keyof StyleProfile, value: number) =>
    update('style_profile', { ...(form.style_profile || DEFAULT_STYLE), [key]: value });

  const save = async () => {
    try {
      await updatePreferences.mutateAsync(form);
      setDirty(false);
      toast.success(tPreferences('saved'));
    } catch (e) {
      toast.error(getErrorMessage(e, tPreferences('saveError')));
    }
  };

  const reset = async () => {
    if (!(await confirm({ title: t('header.resetConfirm'), destructive: true }))) return;
    try {
      await resetPreferences.mutateAsync();
    } catch (e) {
      toast.error(getErrorMessage(e, tPreferences('saveError')));
    }
  };

  const unit = form.temperature_unit || 'celsius';
  const isFahrenheit = unit === 'fahrenheit';
  const unitLabel = isFahrenheit ? '°F' : '°C';
  const coldC = form.cold_threshold ?? 10;
  const hotC = form.hot_threshold ?? 25;

  return (
    <SettingsSubpage title={tRec('title')} loading={isLoading || !preferences}>
      <div className="space-y-8">
        <SettingsSection title={t('styleProfile.title')}>
          <div className="space-y-5">
            {STYLES.map((s) => (
              <StyleSlider
                key={s}
                label={tStyles(s)}
                value={form.style_profile?.[s] ?? 50}
                onChange={(v) => updateStyle(s, v)}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection title={tComfort('title')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{tComfort('temperatureUnit')}</Label>
              <Select value={unit} onValueChange={(v) => update('temperature_unit', v as 'celsius' | 'fahrenheit')}>
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
                value={form.temperature_sensitivity || 'normal'}
                onValueChange={(v) => update('temperature_sensitivity', v as 'low' | 'normal' | 'high')}
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
            <div className="space-y-2">
              <Label>{tComfort('layering')}</Label>
              <Select
                value={form.layering_preference || 'moderate'}
                onValueChange={(v) => update('layering_preference', v as 'minimal' | 'moderate' | 'heavy')}
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rec-cold">{tComfort('coldThreshold', { unit: unitLabel })}</Label>
                <Input
                  id="rec-cold"
                  type="number"
                  value={isFahrenheit ? Math.round(toF(coldC)) : coldC}
                  onChange={(e) => {
                    const raw = e.target.value === '' ? (isFahrenheit ? 50 : 10) : parseInt(e.target.value);
                    update('cold_threshold', isFahrenheit ? Math.round(toCelsius(raw)) : raw);
                  }}
                  min={isFahrenheit ? -4 : -20}
                  max={isFahrenheit ? 86 : 30}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rec-hot">{tComfort('hotThreshold', { unit: unitLabel })}</Label>
                <Input
                  id="rec-hot"
                  type="number"
                  value={isFahrenheit ? Math.round(toF(hotC)) : hotC}
                  onChange={(e) => {
                    const raw = e.target.value === '' ? (isFahrenheit ? 77 : 25) : parseInt(e.target.value);
                    update('hot_threshold', isFahrenheit ? Math.round(toCelsius(raw)) : raw);
                  }}
                  min={isFahrenheit ? 50 : 10}
                  max={isFahrenheit ? 113 : 45}
                />
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title={tRec('variety')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{tRec('defaultOccasion')}</Label>
              <Select value={form.default_occasion || 'casual'} onValueChange={(v) => update('default_occasion', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OCCASIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {tOccasions(o.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tRec('varietyLevel')}</Label>
              <Select
                value={form.variety_level || 'moderate'}
                onValueChange={(v) => update('variety_level', v as 'low' | 'moderate' | 'high')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{tRec('varietyLow')}</SelectItem>
                  <SelectItem value="moderate">{tRec('varietyModerate')}</SelectItem>
                  <SelectItem value="high">{tRec('varietyHigh')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-repeat">{tRec('avoidRepeatDays')}</Label>
              <Input
                id="rec-repeat"
                type="number"
                value={form.avoid_repeat_days ?? 7}
                onChange={(e) => update('avoid_repeat_days', e.target.value === '' ? 7 : parseInt(e.target.value))}
                min={0}
                max={30}
              />
            </div>
            <div className="space-y-2">
              <Label>{tRec('preferUnderused')}</Label>
              <Select
                value={form.prefer_underused_items ? 'yes' : 'no'}
                onValueChange={(v) => update('prefer_underused_items', v === 'yes')}
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
        </SettingsSection>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button onClick={save} disabled={!dirty || updatePreferences.isPending}>
            {updatePreferences.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {tCommon('saving')}
              </>
            ) : (
              tCommon('save')
            )}
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={reset} disabled={resetPreferences.isPending}>
            {t('header.reset')}
          </Button>
        </div>
      </div>
    </SettingsSubpage>
  );
}
