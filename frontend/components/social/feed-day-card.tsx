'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { TransitionLink } from '@/components/native/transition-link';
import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { dayKind, parseLocalDay } from '@/lib/social';
import type { FeedDayGroup, SocialOutfit } from '@/lib/hooks/use-social';
import { PersonAvatar } from '@/components/social/person-avatar';
import { OutfitComposition } from '@/components/social/outfit-composition';
import { ReactionBar } from '@/components/social/reaction-bar';

export function useDayLabel() {
  const t = useTranslations('social.feed');
  const format = useFormatter();
  return (dayIso: string) => {
    const kind = dayKind(dayIso);
    if (kind === 'today') return t('today');
    if (kind === 'yesterday') return t('yesterday');
    return format.dateTime(parseLocalDay(dayIso), { weekday: 'long', day: 'numeric', month: 'long' });
  };
}

function useOccasionLabel() {
  const tOccasions = useTranslations('suggest.occasions');
  return (occasion: string) =>
    tOccasions.has(occasion as never) ? tOccasions(occasion as never) : occasion;
}

export function SocialOutfitTile({ outfit, compact = false }: { outfit: SocialOutfit; compact?: boolean }) {
  const occasion = useOccasionLabel();
  return (
    <figure className="space-y-2">
      <OutfitComposition items={outfit.items} />
      <figcaption className={cn('px-1', compact ? 'space-y-0' : 'flex items-start justify-between gap-2')}>
        <span className="block min-w-0">
          <span className="block truncate text-[15px] font-bold first-letter:uppercase">
            {outfit.name || occasion(outfit.occasion)}
          </span>
          {outfit.name && (
            <span className="block truncate text-xs capitalize text-muted-foreground">{occasion(outfit.occasion)}</span>
          )}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * One friend's shared looks for one day. Several looks (e.g. morning work +
 * evening date) scroll horizontally in the order they were worn.
 */
export function FeedDayCard({ group }: { group: FeedDayGroup }) {
  const t = useTranslations('social.feed');
  const dayLabel = useDayLabel();
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const many = group.outfits.length > 1;

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth * 0.82)));
  };

  return (
    <article className="rounded-lg border border-border bg-card p-3.5 sm:p-4" aria-label={t('cardLabel', { name: '@' + group.author.username })}>
      <header className="flex items-center gap-3">
        <TransitionLink
          href={`/dashboard/friends/${encodeURIComponent(group.author.username)}`}
          className="pressable flex min-w-0 flex-1 items-center gap-3 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PersonAvatar user={group.author} size={44} />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold">@{group.author.username}</span>
          </span>
        </TransitionLink>
        <span className="shrink-0 rounded-full bg-panel px-3 py-1 text-xs font-semibold first-letter:uppercase">
          {dayLabel(group.day)}
        </span>
      </header>

      {many && (
        <p className="mt-3 px-1 text-sm font-semibold text-muted-foreground">
          {t('looksThatDay', { count: group.outfits.length })}
        </p>
      )}

      <div
        ref={scroller}
        onScroll={many ? onScroll : undefined}
        className={cn(
          'mt-3',
          many && '-mx-3.5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3.5 pb-1 sm:-mx-4 sm:px-4 [scrollbar-width:none]'
        )}
      >
        {group.outfits.map((outfit, i) => (
          <div
            key={outfit.id}
            className={cn(many && 'w-[82%] shrink-0 snap-center snap-always sm:w-[60%]')}
            aria-label={many ? t('lookOf', { n: i + 1, total: group.outfits.length }) : undefined}
          >
            <SocialOutfitTile outfit={outfit} />
            <div className="mt-1">
              <ReactionBar outfit={outfit} />
            </div>
          </div>
        ))}
      </div>

      {many && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {group.outfits.map((o, i) => (
            <span
              key={o.id}
              className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-4 bg-foreground' : 'w-1.5 bg-border')}
            />
          ))}
        </div>
      )}
    </article>
  );
}
