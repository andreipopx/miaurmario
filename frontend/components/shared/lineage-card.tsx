'use client';

import Link from 'next/link';
import { ArrowRight, BookmarkCheck } from 'lucide-react';
import { parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';
import { useOutfit } from '@/lib/hooks/use-outfits';
import type { Outfit } from '@/lib/hooks/use-outfits';
import { useFormatDate } from '@/lib/date-locale';

interface LineageCardProps {
  outfit: Outfit;
}

export function LineageCard({ outfit }: LineageCardProps) {
  const t = useTranslations('lineageCard');
  const tOccasions = useTranslations('suggest.occasions');
  const formatDate = useFormatDate();
  const replacesId = outfit.replaces_outfit_id;
  const clonedFromId = outfit.cloned_from_outfit_id;

  const { data: referenced } = useOutfit(replacesId ?? clonedFromId ?? undefined);

  if (!replacesId && !clonedFromId) return null;
  if (!referenced) return null;

  const isReplacement = !!replacesId;
  const Icon = isReplacement ? ArrowRight : BookmarkCheck;

  const occasion = tOccasions.has(referenced.occasion as never)
    ? tOccasions(referenced.occasion as never)
    : referenced.occasion;

  const label = isReplacement
    ? referenced.scheduled_for
      ? t('replacesWithDate', {
          occasion,
          date: formatDate(parseISO(referenced.scheduled_for), 'short'),
        })
      : t('replaces', { occasion })
    : t('fromLookbook', { name: referenced.name || occasion });

  return (
    <Card className="border-0 bg-panel">
      <CardContent className="p-1.5 sm:p-1.5">
        <Link
          href={`/dashboard/outfits/${referenced.id}`}
          className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-signature-soft">
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <span className="truncate">{label}</span>
        </Link>
      </CardContent>
    </Card>
  );
}
