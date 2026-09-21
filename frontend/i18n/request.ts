import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
// Deployment default is Spanish. The app is currently Spanish-only for family
// use: the language switcher is hidden (see components/language-switcher.tsx)
// and this config force-serves 'es' even if a legacy 'en' cookie is present.
// To restore per-user locale selection, flip SHOW_LANGUAGE_SWITCHER back to
// true and re-enable the cookie branch below.
export const DEFAULT_LOCALE: Locale = 'es';
export const LOCALE_COOKIE = 'wardrowbe_locale';

// Async fallback: any key missing from es.json falls through to en.json so we
// never surface a raw dotted key like "wardrobe.emptyState.title" in the UI.
async function loadMessages(locale: Locale): Promise<AbstractIntlMessages> {
  const primary: AbstractIntlMessages = (await import(`../messages/${locale}.json`)).default;
  if (locale === 'en') return primary;
  const fallback: AbstractIntlMessages = (await import(`../messages/en.json`)).default;
  return deepMerge(fallback, primary);
}

function deepMerge(base: AbstractIntlMessages, override: AbstractIntlMessages): AbstractIntlMessages {
  const out: AbstractIntlMessages = { ...base };
  for (const key of Object.keys(override)) {
    const b = out[key];
    const o = override[key];
    out[key] = typeof b === 'object' && typeof o === 'object' ? deepMerge(b, o) : o;
  }
  return out;
}

export default getRequestConfig(async () => {
  // Force Spanish across the whole app while SHOW_LANGUAGE_SWITCHER=false.
  // (Cookie is intentionally ignored — legacy 'en' cookies simply have no effect.)
  const locale: Locale = DEFAULT_LOCALE;
  const messages = await loadMessages(locale);
  return { locale, messages };
});
