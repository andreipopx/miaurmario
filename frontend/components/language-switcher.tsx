'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';

const LOCALE_COOKIE = 'wardrowbe_locale';
const LOCALES = ['en', 'es'] as const;
type LocaleCode = (typeof LOCALES)[number];

// SHOW_LANGUAGE_SWITCHER: false while the app is Spanish-only for family use.
// To restore the EN/ES toggle in the header/login/onboarding, flip this to true.
// The rest of the i18n plumbing (en.json, next-intl config, request pipeline)
// is intact — this flag is the ONLY thing gating visibility.
export const SHOW_LANGUAGE_SWITCHER = false;

interface Props {
  /** 'compact' fits the header (tight border, small text). 'default' fits standalone use. */
  variant?: 'compact' | 'default';
  className?: string;
}

export function LanguageSwitcher(props: Props) {
  if (!SHOW_LANGUAGE_SWITCHER) return null;
  return <LanguageSwitcherControl {...props} />;
}

function LanguageSwitcherControl({ variant = 'default', className }: Props) {
  const t = useTranslations('common');
  const current = useLocale();
  const [isPending, startTransition] = useTransition();

  const switchTo = (code: LocaleCode) => {
    if (code === current) return;
    document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => {
      window.location.reload();
    });
  };

  const buttonBase = variant === 'compact' ? 'px-2 py-1 text-xs min-h-[36px] min-w-[36px]' : 'px-3 py-2 text-sm min-h-[44px]';

  return (
    <div className={`inline-flex items-center gap-2 ${className || ''}`} aria-label={t('language')}>
      {variant !== 'compact' && (
        <Languages className="h-4 w-4 text-muted-foreground" aria-hidden />
      )}
      <div role="group" className="inline-flex rounded-md border border-input overflow-hidden">
        {LOCALES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => switchTo(code)}
            disabled={isPending}
            aria-pressed={current === code}
            aria-label={code === 'es' ? t('spanish') : t('english')}
            className={`${buttonBase} font-semibold transition-colors ${
              current === code
                ? 'bg-primary text-primary-foreground'
                : 'bg-background hover:bg-accent'
            } disabled:opacity-50`}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
