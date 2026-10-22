'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Camera, ListChecks } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StinkyBubble } from '@/components/stinky-chat/stinky-bubble';
import { useWardrobeStats } from '@/lib/hooks/use-wardrobe-stats';

/**
 * Stinky asking for photos, with somewhere to tap.
 *
 * The prompt already tells him to ask when the wardrobe is nearly empty (see
 * ARMARIO CASI VACÍO in prompts/stinky_chat.txt), but he cannot render a button
 * and he is told never to write ids or links. This is the button that goes with
 * what he says — and it points at tagging rather than uploading when the photos
 * are already there and only the types are missing.
 *
 * It reads as one more thing he says in the chat; `continued` when it follows
 * another bubble of his, so his face is not repeated.
 */
export function EmptyWardrobeCta({ continued = false }: { continued?: boolean }) {
  const t = useTranslations('stinkyChat.emptyWardrobe');
  const { data: stats } = useWardrobeStats();
  if (!stats || stats.usable >= stats.min_for_looks) return null;

  const taggingFirst = stats.untyped > 0;

  return (
    <StinkyBubble
      testId="stinky-empty-wardrobe"
      continued={continued}
      after={
        <Button asChild size="sm" className="mt-2">
          <Link href={taggingFirst ? '/dashboard/wardrobe?bulk=review' : '/dashboard/wardrobe?bulk=1'}>
            {taggingFirst ? (
              <ListChecks className="h-4 w-4" strokeWidth={2} aria-hidden />
            ) : (
              <Camera className="h-4 w-4" strokeWidth={2} aria-hidden />
            )}
            {taggingFirst ? t('tagCta') : t('cta')}
          </Link>
        </Button>
      }
    >
      <span className="block font-bold">{taggingFirst ? t('tagTitle') : t('title')}</span>
      <span className="mt-0.5 block text-[14px] text-foreground/75">
        {taggingFirst ? t('tagBody', { count: stats.untyped }) : t('body')}
      </span>
    </StinkyBubble>
  );
}
