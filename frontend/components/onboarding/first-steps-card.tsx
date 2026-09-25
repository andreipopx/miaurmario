'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Camera, ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LazyStinky } from '@/components/native/lazy-stinky';
import {
  MIN_ITEMS_FOR_LOOKS,
  type WardrobeCounts,
  type WardrobeStage,
  wardrobeStage,
} from '@/lib/onboarding/first-run';
import { useWardrobeStats } from '@/lib/hooks/use-wardrobe-stats';

/** The batch uploader; a wardrobe is filled in one sitting, not one garment at a time. */
const UPLOAD_HREF = '/dashboard/wardrobe?bulk=1';
/** The quick "tipo + color" pass over everything the tagger never named. */
const REVIEW_HREF = '/dashboard/wardrobe?bulk=review';

/**
 * Hoy, while the wardrobe is too small to be useful.
 *
 * One card for the whole ramp, because two competing nudges is worse than none: it
 * says which of the two things is actually missing — photos, or the types that make
 * photos into garments the stylist can see — and never claims a threshold the
 * engine does not have. `variety_target` is presented as a goal, `min_for_looks` as
 * the real gate.
 */
export function FirstStepsCard({ count }: { count: number }) {
  const t = useTranslations('firstRun.firstSteps');
  const { data: stats } = useWardrobeStats();

  // Before the stats land, fall back to the item count Hoy already has: at worst
  // the card shows the "sube prendas" wording a moment longer than needed.
  const counts: WardrobeCounts = {
    total: stats?.total ?? count,
    usable: stats?.usable ?? count,
    untyped: stats?.untyped ?? 0,
    minForLooks: stats?.min_for_looks ?? MIN_ITEMS_FOR_LOOKS,
    varietyTarget: stats?.variety_target ?? MIN_ITEMS_FOR_LOOKS,
  };
  const stage: WardrobeStage = wardrobeStage(counts);
  if (stage === 'ready') return null;

  const copy = COPY[stage];
  const values = {
    count: counts.usable,
    photos: counts.total,
    untyped: counts.untyped,
    min: counts.minForLooks,
    target: counts.varietyTarget,
  };
  const goal = stage === 'variety' ? counts.varietyTarget : counts.minForLooks;
  const pct = Math.min(100, Math.round((counts.usable / Math.max(1, goal)) * 100));
  const taggingFirst = stage === 'untagged';

  return (
    <section
      aria-labelledby="first-steps-title"
      data-testid="first-steps"
      data-stage={stage}
      className="rounded-lg bg-signature-soft p-4 sm:p-6"
    >
      <div className="flex flex-col items-center text-center">
        <div className="flex h-32 w-32 items-center justify-center rounded-full bg-background">
          <LazyStinky state={copy.mascot} settleTo="idle" size={112} label="" />
        </div>
        <h2
          id="first-steps-title"
          className="mt-4 text-[22px] font-extrabold leading-tight tracking-tight"
        >
          {t(copy.title)}
        </h2>

        <div className="mt-3 w-full max-w-sm">
          <p className="text-[15px] font-semibold leading-snug">{t(copy.body, values)}</p>
          {stage !== 'empty' && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={goal}
              aria-valuenow={counts.usable}
              aria-label={t(copy.body, values)}
              className="mt-3 h-3 w-full overflow-hidden rounded-full bg-background"
            >
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <p className="mt-2 text-[13px] text-foreground/70">{t(copy.hint, values)}</p>
        </div>

        <Button asChild size="lg" className="mt-5 w-full max-w-sm">
          <Link href={taggingFirst ? REVIEW_HREF : UPLOAD_HREF}>
            {taggingFirst ? (
              <ListChecks className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            ) : (
              <Camera className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            )}
            {t(copy.cta, values)}
          </Link>
        </Button>
        {taggingFirst && (
          <Button asChild variant="ghost" size="sm" className="mt-2">
            <Link href={UPLOAD_HREF}>{t('emptyCta')}</Link>
          </Button>
        )}
      </div>
    </section>
  );
}

type Copy = {
  title: string;
  body: string;
  hint: string;
  cta: string;
  mascot: 'wave' | 'happy' | 'thinking';
};

const COPY: Record<Exclude<WardrobeStage, 'ready'>, Copy> = {
  empty: { title: 'emptyTitle', body: 'emptyBody', hint: 'progressHint', cta: 'emptyCta', mascot: 'wave' },
  untagged: {
    title: 'untaggedTitle',
    body: 'untagged',
    hint: 'untaggedHint',
    cta: 'untaggedCta',
    mascot: 'thinking',
  },
  progress: {
    title: 'progressTitle',
    body: 'progress',
    hint: 'progressHint',
    cta: 'progressCta',
    mascot: 'happy',
  },
  variety: {
    title: 'varietyTitle',
    body: 'variety',
    hint: 'varietyHint',
    cta: 'varietyCta',
    mascot: 'happy',
  },
};
