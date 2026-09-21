'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';

import { cn } from '@/lib/utils';

const LOCALE_COOKIE = 'wardrowbe_locale';
const LOCALES = ['en', 'es'] as const;
type LocaleCode = (typeof LOCALES)[number];

// SHOW_LANGUAGE_SWITCHER: false while the app is Spanish-only for family use.
// To restore the EN/ES toggle in settings/login/onboarding, flip this to true.
// The rest of the i18n plumbing (en.json, next-intl config, request pipeline)
// is intact — this flag is the ONLY thing gating visibility.
export const SHOW_LANGUAGE_SWITCHER = false;

interface Props {
  /** 'compact' fits tight spots (36px pills). 'default' fits standalone use (44px pills). */
  variant?: 'compact' | 'default';
  className?: string;
}

export function LanguageSwitcher(props: Props) {
  if (!SHOW_LANGUAGE_SWITCHER) return null;
  return <LanguageSwitcherControl {...props} />;
}

/** Pill segmented control (panel-gray track, ink pill for the active locale). */
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

  const compact = variant === 'compact';

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      {!compact && <Languages className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />}
      <div
        role="group"
        aria-label={t('language')}
        className="inline-flex items-center gap-1 rounded-full bg-panel p-1"
      >
        {LOCALES.map((code) => {
          const active = current === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => switchTo(code)}
              disabled={isPending}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center justify-center rounded-full font-semibold transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50',
                compact ? 'h-9 min-w-[36px] px-3 text-xs' : 'h-11 min-w-[44px] px-4 text-sm',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent text-foreground hover:bg-background'
              )}
            >
              {compact ? (
                <>
                  <span aria-hidden>{code.toUpperCase()}</span>
                  <span className="sr-only">{code === 'es' ? t('spanish') : t('english')}</span>
                </>
              ) : code === 'es' ? (
                t('spanish')
              ) : (
                t('english')
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
