import { useCallback } from 'react';
import { useLocale } from 'next-intl';
import { format, type Locale as DateFnsLocale } from 'date-fns';
import { enUS, es } from 'date-fns/locale';

/**
 * Bridges the active next-intl locale to date-fns.
 *
 * date-fns `format()` / `formatDistance*()` default to English unless a
 * `locale` option is passed, and English-style patterns such as
 * 'MMMM d, yyyy' read oddly in Spanish even with the right month names.
 * Use the helpers here instead of calling date-fns with a hardcoded pattern.
 */

type DateLang = 'en' | 'es';

const DATE_FNS_LOCALES: Record<DateLang, DateFnsLocale> = {
  en: enUS,
  es,
};

/** Normalise a locale code ('es', 'es-ES', 'en_US', ...) to a supported language. Falls back to 'en'. */
function resolveLang(locale: string | undefined | null): DateLang {
  const base = (locale ?? '').toLowerCase().split(/[-_]/)[0];
  return base === 'es' ? 'es' : 'en';
}

/** Map a next-intl locale code (e.g. 'es', 'en', 'es-ES') to a date-fns locale. Falls back to enUS. */
export function getDateFnsLocale(locale: string | undefined | null): DateFnsLocale {
  return DATE_FNS_LOCALES[resolveLang(locale)];
}

/** Named date formats, with a pattern per language. */
export const DATE_PATTERNS = {
  /** "September 21, 2026" / "21 de septiembre de 2026" */
  long: { en: 'MMMM d, yyyy', es: "d 'de' MMMM 'de' yyyy" },
  /** "Monday, September 21" / "lunes, 21 de septiembre" */
  weekdayLong: { en: 'EEEE, MMMM d', es: "EEEE, d 'de' MMMM" },
  /** "Sep 21, 2026" / "21 sep 2026" */
  medium: { en: 'MMM d, yyyy', es: 'd MMM yyyy' },
  /** "Sep 21" / "21 sep" */
  short: { en: 'MMM d', es: 'd MMM' },
  /** "September 2026" / "septiembre de 2026" */
  monthYear: { en: 'MMMM yyyy', es: "MMMM 'de' yyyy" },
} as const;

export type DatePatternKey = keyof typeof DATE_PATTERNS;

/** Pure formatter: format `date` using the named pattern for `locale`. */
export function formatDateLocalized(
  date: Date | number,
  key: DatePatternKey,
  locale: string | undefined | null
): string {
  const lang = resolveLang(locale);
  return format(date, DATE_PATTERNS[key][lang], { locale: DATE_FNS_LOCALES[lang] });
}

/** Upper-case the first character (Spanish month/day names are lowercase). */
export function capitalizeFirst(value: string): string {
  return value ? value.charAt(0).toLocaleUpperCase() + value.slice(1) : value;
}

/** date-fns locale for the active next-intl locale. */
export function useDateFnsLocale(): DateFnsLocale {
  return getDateFnsLocale(useLocale());
}

/** Returns a `(date, key) => string` formatter bound to the active locale. */
export function useFormatDate(): (date: Date | number, key: DatePatternKey) => string {
  const locale = useLocale();
  return useCallback((date, key) => formatDateLocalized(date, key, locale), [locale]);
}
