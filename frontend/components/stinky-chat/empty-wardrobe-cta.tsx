'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Camera, ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useWardrobeStats } from '@/lib/hooks/use-wardrobe-stats';

/**
 * Stinky asking for photos, with somewhere to tap.
 *
 * The prompt already tells him to ask when the wardrobe is nearly empty (see
 * ARMARIO CASI VACÍO in prompts/stinky_chat.txt), but he cannot render a button
 * and he is told never to write ids or links. This is the button that goes with
 * what he says — and it points at tagging rather than uploading when the photos
 * are already there and only the types are missing.
 */
export function EmptyWardrobeCta() {
  const t = useTranslations('stinkyChat.emptyWardrobe');
  const { data: stats } = useWardrobeStats();
  if (!stats || stats.usable >= stats.min_for_looks) return null;

  const taggingFirst = stats.untyped > 0;

  return (
    <div
      data-testid="stinky-empty-wardrobe"
      className="rounded-lg bg-signature-soft p-3.5 sm:p-4"
    >
      <p className="text-[15px] font-bold leading-snug">
        {taggingFirst ? t('tagTitle') : t('title')}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-foreground/75">
        {taggingFirst ? t('tagBody', { count: stats.untyped }) : t('body')}
      </p>
      <Button asChild className="mt-3 w-full sm:w-auto">
        <Link href={taggingFirst ? '/dashboard/wardrobe?bulk=review' : '/dashboard/wardrobe?bulk=1'}>
          {taggingFirst ? (
            <ListChecks className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          ) : (
            <Camera className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          )}
          {taggingFirst ? t('tagCta') : t('cta')}
        </Link>
      </Button>
    </div>
  );
}
