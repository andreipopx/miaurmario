'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Eye, ExternalLink } from 'lucide-react';

import { cn } from '@/lib/utils';

export const LASTFM_JOIN_URL = 'https://www.last.fm/join';
export const LASTFM_APPS_URL = 'https://www.last.fm/settings/applications';
export const LASTFM_PRIVACY_URL = 'https://www.last.fm/settings/privacy';

function StepLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-bold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
    </a>
  );
}

/**
 * "Cómo tener Last.fm, en 3 pasos" — hand-holding for the (many) people who have
 * never heard of scrobbling. Open by default when the user has nothing connected;
 * collapsible so it gets out of the way once they do.
 */
export function LastfmGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const t = useTranslations('integrations.lastfm.guide');
  const [open, setOpen] = useState(defaultOpen);

  const steps = [
    { title: t('step1Title'), body: t('step1Body'), link: t('step1Link'), href: LASTFM_JOIN_URL },
    { title: t('step2Title'), body: t('step2Body'), link: t('step2Link'), href: LASTFM_APPS_URL },
    { title: t('step3Title'), body: t('step3Body'), link: null, href: null },
  ];

  return (
    <section
      id="guia-lastfm"
      aria-labelledby="lastfm-guide-title"
      className="space-y-4 rounded-lg bg-panel p-5 sm:p-6"
    >
      <div className="space-y-1">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h2 id="lastfm-guide-title" className="text-lg font-bold">
          {t('title')}
        </h2>
        <p className="text-[15px] leading-snug text-muted-foreground">{t('intro')}</p>
      </div>

      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="lastfm-guide-steps"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-bold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {open ? t('hide') : t('show')}
        <ChevronDown
          className={cn('h-4 w-4 transition-transform duration-150', open && 'rotate-180')}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>

      {open && (
        <div id="lastfm-guide-steps" className="space-y-4">
          <ol className="space-y-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pop-amber text-[15px] font-extrabold text-pop-foreground"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-[15px] font-bold leading-snug">
                    <span className="sr-only">{t('stepLabel', { number: i + 1 })}: </span>
                    {step.title}
                  </p>
                  <p className="text-sm leading-snug text-muted-foreground">{step.body}</p>
                  {step.href && step.link && <StepLink href={step.href}>{step.link}</StepLink>}
                </div>
              </li>
            ))}
          </ol>

          <div className="space-y-1 rounded-quick bg-background p-4">
            <p className="flex items-start gap-2 text-sm font-bold">
              <Eye className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              {t('publicTitle')}
            </p>
            <p className="text-sm leading-snug text-muted-foreground">{t('publicBody')}</p>
            <StepLink href={LASTFM_PRIVACY_URL}>{t('publicLink')}</StepLink>
          </div>
        </div>
      )}
    </section>
  );
}
