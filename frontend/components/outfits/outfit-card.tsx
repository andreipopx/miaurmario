'use client';

import Link from 'next/link';
import { TransitionLink } from '@/components/native/transition-link';
import Image from 'next/image';
import { formatDistanceToNow, parseISO, type Locale } from 'date-fns';
import { useTranslations } from 'next-intl';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { cn } from '@/lib/utils';
import type { Outfit } from '@/lib/hooks/use-outfits';
import { useDateFnsLocale } from '@/lib/date-locale';

interface OutfitCardProps {
  outfit: Outfit;
  onClick?: () => void;
}

function formatRelative(outfit: Outfit, dateFnsLocale: Locale): string | null {
  if (!outfit.scheduled_for) return null;
  try {
    return formatDistanceToNow(parseISO(outfit.scheduled_for), {
      addSuffix: true,
      locale: dateFnsLocale,
    });
  } catch {
    return outfit.scheduled_for;
  }
}

export function OutfitCard({ outfit, onClick }: OutfitCardProps) {
  const t = useTranslations('outfitCard');
  const typeLabel = useClothingTypeLabel();
  const tOccasions = useTranslations('suggest.occasions');
  const dateFnsLocale = useDateFnsLocale();
  const visibleItems = outfit.items.slice(0, 4);
  const overflow = outfit.items.length - visibleItems.length;

  const occasionLabel = tOccasions.has(outfit.occasion as never)
    ? tOccasions(outfit.occasion as never)
    : outfit.occasion;

  const title =
    outfit.name ||
    outfit.reasoning ||
    (outfit.highlights && outfit.highlights.length > 0
      ? outfit.highlights[0]
      : t('titleFallback', { occasion: occasionLabel }));

  const meta = formatRelative(outfit, dateFnsLocale) ?? t('lookbookTemplate');

  const content = (
    <div
      className={cn(
        'group overflow-hidden rounded-lg border border-border bg-card transition-shadow duration-200 hover:shadow-[0_10px_30px_rgba(0,0,0,0.08)]',
        onClick && 'cursor-pointer'
      )}
      onClick={onClick}
    >
      <div className="relative aspect-[5/4] p-2">
        <div className="grid h-full grid-cols-4 gap-1.5">
          {visibleItems.map((item, idx) => (
            <div
              key={`${item.id}-${idx}`}
              className="relative overflow-hidden rounded-tile bg-panel"
            >
              {item.thumbnail_url || item.image_url ? (
                <Image
                  src={(item.thumbnail_url || item.image_url)!}
                  alt={item.name || typeLabel(item.type)}
                  fill
                  className="object-contain p-1.5"
                  sizes="(max-width: 640px) 25vw, 15vw"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-[11px] text-muted-foreground">
                    {typeLabel(item.type)}
                  </span>
                </div>
              )}
            </div>
          ))}
          {overflow > 0 && (
            <div className="relative flex items-center justify-center overflow-hidden rounded-tile bg-panel">
              <span className="text-sm font-bold text-muted-foreground">
                +{overflow}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2 px-4 pb-4 pt-1">
        <h3 className="truncate text-[15px] font-bold leading-tight">
          {title}
        </h3>
        {/* Where a look came from (Studio, IA…) changes nothing you can do with it:
            the occasion and the date are the only words under the title. */}
        <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
          <span className="truncate">{occasionLabel}</span>
          <span className="shrink-0 truncate">{meta}</span>
        </div>
      </div>
    </div>
  );

  if (onClick) return content;
  return (
    <TransitionLink
      href={`/dashboard/outfits/${outfit.id}`}
      className="pressable block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {content}
    </TransitionLink>
  );
}
