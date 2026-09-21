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
    <Card className="border-muted bg-muted/30">
      <CardContent className="p-3">
        <Link
          href={`/dashboard/outfits/${referenced.id}`}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </Link>
      </CardContent>
    </Card>
  );
}
