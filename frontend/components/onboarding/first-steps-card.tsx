'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Camera, ImagePlus, Link2, ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';
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
/** The ways in that need no photo of your own: what you bought online. */
const SCREENSHOT_HREF = '/dashboard/wardrobe?add=shot';
const LINK_HREF = '/dashboard/wardrobe?add=link';

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
      className="rounded-lg bg-panel p-4"
    >
      {/* Stinky says it, small: the card is a line from him, not a poster. */}
      <div className="flex items-center gap-3">
        <StinkyAvatar size={40} className="bg-signature-soft" />
        <h2 id="first-steps-title" className="min-w-0 text-[17px] font-bold leading-snug">
          {t(copy.title)}
        </h2>
      </div>

      <p className="mt-3 text-[14px] leading-snug text-muted-foreground">{t(copy.body, values)}</p>
      {stage !== 'empty' && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={counts.usable}
          aria-label={t(copy.body, values)}
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-background"
        >
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <Button asChild className="mt-4 w-full">
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
        <Button asChild variant="ghost" size="sm" className="mt-2 w-full">
          <Link href={UPLOAD_HREF}>{t('emptyCta')}</Link>
        </Button>
      )}
      {/* Photographing the wardrobe is where people give up, so the first
          garments can also come from a screenshot or a shop link. */}
      {(stage === 'empty' || stage === 'progress') && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button asChild variant="ghost" className="bg-background">
            <Link href={SCREENSHOT_HREF}>
              <ImagePlus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              {t('fromScreenshot')}
            </Link>
          </Button>
          <Button asChild variant="ghost" className="bg-background">
            <Link href={LINK_HREF}>
              <Link2 className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              {t('fromLink')}
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}

type Copy = {
  title: string;
  body: string;
  cta: string;
};

const COPY: Record<Exclude<WardrobeStage, 'ready'>, Copy> = {
  empty: { title: 'emptyTitle', body: 'emptyBody', cta: 'emptyCta' },
  untagged: { title: 'untaggedTitle', body: 'untagged', cta: 'untaggedCta' },
  progress: { title: 'progressTitle', body: 'progress', cta: 'progressCta' },
  variety: { title: 'varietyTitle', body: 'variety', cta: 'varietyCta' },
};
