'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  buildTimezoneOptions,
  filterTimezoneOptions,
  formatTimezoneLabel,
  getBrowserTimezone,
} from '@/lib/timezones';

interface TimezoneComboboxProps {
  id?: string;
  value: string;
  onChange: (timeZone: string) => void;
  /** IANA zone of the chosen city, offered as a one-tap suggestion. */
  cityTimezone?: string | null;
  /** Short city name for the suggestion ("Madrid"). */
  cityName?: string;
}

/**
 * Searchable list of every IANA zone with friendly labels
 * ("Europa/Madrid (UTC+2)"). The input shows the current choice; typing
 * filters by label, IANA id or offset.
 */
export function TimezoneCombobox({
  id = 'timezone',
  value,
  onChange,
  cityTimezone,
  cityName,
}: TimezoneComboboxProps) {
  const t = useTranslations('settings.location');
  const locale = useLocale();
  const allOptions = useMemo(() => buildTimezoneOptions(locale), [locale]);
  const [query, setQuery] = useState<string | null>(null);

  const currentLabel = value ? formatTimezoneLabel(value, locale) : '';
  const editing = query !== null;
  const filtered = useMemo(
    () => filterTimezoneOptions(allOptions, editing ? query : ''),
    [allOptions, editing, query]
  );
  const options: ComboboxOption[] = useMemo(
    () => filtered.map((o) => ({ value: o.value, label: o.label })),
    [filtered]
  );

  const browserTz = useMemo(() => getBrowserTimezone(), []);
  const suggestion =
    cityTimezone && cityTimezone !== value
      ? { tz: cityTimezone, text: t('useCityTimezone', { city: cityName || cityTimezone, zone: formatTimezoneLabel(cityTimezone, locale) }) }
      : !cityTimezone && browserTz && browserTz !== value
        ? { tz: browserTz, text: t('useBrowserTimezone', { zone: formatTimezoneLabel(browserTz, locale) }) }
        : null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="font-bold">
        {t('timezone')}
      </Label>
      <Combobox
        id={id}
        aria-label={t('timezone')}
        inputValue={editing ? query : currentLabel}
        onInputChange={setQuery}
        onFocus={() => setQuery('')}
        onBlur={() => setQuery(null)}
        onEscape={() => setQuery(null)}
        options={options}
        selectedValue={value}
        onSelect={(option) => {
          onChange(option.value);
          setQuery(null);
        }}
        placeholder={editing ? t('timezoneSearchPlaceholder') : currentLabel}
        statusMessage={t('timezoneNoResults')}
      />
      {suggestion ? (
        <button
          type="button"
          onClick={() => onChange(suggestion.tz)}
          className="min-h-[36px] rounded-full bg-signature-soft px-3 py-1.5 text-left text-[13px] font-semibold text-foreground transition-colors hover:bg-signature/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {suggestion.text}
        </button>
      ) : (
        <p className="px-1 text-[13px] text-muted-foreground">{t('timezoneHint')}</p>
      )}
    </div>
  );
}
