'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Camera } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { MIN_ITEMS_FOR_LOOKS } from '@/lib/onboarding/first-run';

const UPLOAD_HREF = '/dashboard/wardrobe?add=1';

/**
 * Hoy while the wardrobe is too small for suggestions: a big "Sube tu primera
 * prenda" card (empty), or progress towards the engine's minimum.
 */
export function FirstStepsCard({ count }: { count: number }) {
  const t = useTranslations('firstRun.firstSteps');
  const empty = count <= 0;
  const pct = Math.min(100, Math.round((count / MIN_ITEMS_FOR_LOOKS) * 100));

  return (
    <section
      aria-labelledby="first-steps-title"
      data-testid="first-steps"
      className="rounded-lg bg-signature-soft p-4 sm:p-6"
    >
      <div className="flex flex-col items-center text-center">
        <div className="flex h-32 w-32 items-center justify-center rounded-full bg-background">
          <LazyStinky state={empty ? 'wave' : 'happy'} settleTo="idle" size={112} label="" />
        </div>
        <h2 id="first-steps-title" className="mt-4 text-[22px] font-extrabold leading-tight tracking-tight">
          {empty ? t('emptyTitle') : t('progressTitle')}
        </h2>
        {empty ? (
          <p className="mt-2 max-w-sm text-[15px] leading-snug text-foreground/75">
            {t('emptyBody', { min: MIN_ITEMS_FOR_LOOKS })}
          </p>
        ) : (
          <div className="mt-3 w-full max-w-sm">
            <p className="text-[15px] font-semibold leading-snug">
              {t('progress', { count, min: MIN_ITEMS_FOR_LOOKS })}
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={MIN_ITEMS_FOR_LOOKS}
              aria-valuenow={count}
              aria-label={t('progress', { count, min: MIN_ITEMS_FOR_LOOKS })}
              className="mt-3 h-3 w-full overflow-hidden rounded-full bg-background"
            >
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[13px] text-foreground/70">{t('progressHint')}</p>
          </div>
        )}
        <Button asChild size="lg" className="mt-5 w-full max-w-sm">
          <Link href={UPLOAD_HREF}>
            <Camera className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            {empty ? t('emptyCta') : t('progressCta')}
          </Link>
        </Button>
      </div>
    </section>
  );
}
