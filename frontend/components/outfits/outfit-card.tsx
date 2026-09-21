'use client';

import Link from 'next/link';
import Image from 'next/image';
import { formatDistanceToNow, parseISO, type Locale } from 'date-fns';
import { useTranslations } from 'next-intl';
import {
  BookmarkCheck,
  Layers,
  RefreshCw,
  Shirt,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Outfit } from '@/lib/hooks/use-outfits';
import { useDateFnsLocale } from '@/lib/date-locale';

interface OutfitCardProps {
  outfit: Outfit;
  onClick?: () => void;
}

type SourceBadgeKey =
  | 'badgeReplacement'
  | 'badgeWorn'
  | 'badgeStudio'
  | 'badgePairing'
  | 'badgeAi';

type BadgeVariant = 'amber' | 'sky' | 'mint' | 'signature' | 'secondary';

function getSourceBadge(outfit: Outfit): {
  labelKey: SourceBadgeKey;
  icon: React.ReactNode;
  variant: BadgeVariant;
} {
  if (outfit.replaces_outfit_id) {
    return {
      labelKey: 'badgeReplacement',
      icon: <RefreshCw className="h-3 w-3" />,
      variant: 'amber',
    };
  }
  if (
    outfit.cloned_from_outfit_id &&
    outfit.source === 'manual' &&
    outfit.scheduled_for
  ) {
    return {
      labelKey: 'badgeWorn',
      icon: <BookmarkCheck className="h-3 w-3" />,
      variant: 'mint',
    };
  }
  if (outfit.source === 'manual') {
    return {
      labelKey: 'badgeStudio',
      icon: <Shirt className="h-3 w-3" />,
      variant: 'signature',
    };
  }
  if (outfit.source === 'pairing') {
    return {
      labelKey: 'badgePairing',
      icon: <Layers className="h-3 w-3" />,
      variant: 'amber',
    };
  }
  return {
    labelKey: 'badgeAi',
    icon: <Sparkles className="h-3 w-3" />,
    variant: 'sky',
  };
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
  const tOccasions = useTranslations('suggest.occasions');
  const dateFnsLocale = useDateFnsLocale();
  const badge = getSourceBadge(outfit);
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
                  alt={item.name || item.type}
                  fill
                  className="object-contain p-1.5"
                  sizes="(max-width: 640px) 25vw, 15vw"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-[11px] text-muted-foreground">
                    {item.type}
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
        <Badge
          variant={badge.variant}
          className="absolute right-3 top-3 text-[11px]"
        >
          {badge.icon}
          <span>{t(badge.labelKey)}</span>
        </Badge>
      </div>
      <div className="space-y-2 px-4 pb-4 pt-1">
        <h3 className="truncate text-[15px] font-bold leading-tight">
          {title}
        </h3>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="font-semibold">
            {occasionLabel}
          </Badge>
          <span className="truncate">{meta}</span>
        </div>
      </div>
    </div>
  );

  if (onClick) return content;
  return (
    <Link
      href={`/dashboard/outfits/${outfit.id}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {content}
    </Link>
  );
}
