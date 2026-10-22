'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';

import { PersonAvatar } from '@/components/social/person-avatar';
import { OutfitComposition } from '@/components/social/outfit-composition';
import { useFriendsFeed, useFriendsOverview, usePolls } from '@/lib/hooks/use-social';

/** Today as a local YYYY-MM-DD (the feed groups by the author's day). */
function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * Hoy: what your friends are wearing today, and who is asking «¿Cuál me pongo?».
 * Nothing at all when there is nothing from them today (no empty box on Hoy).
 */
export function FriendsToday() {
  const t = useTranslations('social.today');
  const { data: overview } = useFriendsOverview();
  const hasFriends = (overview?.friends.length ?? 0) > 0;
  const feed = useFriendsFeed();
  const { data: polls } = usePolls(hasFriends);
  if (!hasFriends) return null;

  const today = todayIso();
  const groups = (feed.data?.pages[0]?.groups ?? []).filter((g) => g.day === today);
  const asking = (polls?.friends ?? []).filter((p) => !p.my_vote);
  if (!groups.length && !asking.length) return null;

  return (
    <section aria-labelledby="friends-today-title" className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 id="friends-today-title" className="text-[17px] font-extrabold tracking-tight">
          {t('title')}
        </h2>
        <Link href="/dashboard/friends" className="flex items-center text-sm font-semibold">
          {t('seeAll')}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {asking.map((poll) => (
          <li key={poll.id} className="w-40 shrink-0">
            <Link href="/dashboard/friends" className="block space-y-2 rounded-lg bg-signature-soft p-2.5">
              <span className="flex items-center gap-2">
                <PersonAvatar user={poll.author} size={28} />
                <span className="min-w-0 truncate text-[13px] font-bold">{poll.author.display_name}</span>
              </span>
              <span className="grid grid-cols-2 gap-1">
                {poll.options.slice(0, 2).map((o) => (
                  <OutfitComposition key={o.outfit.id} items={o.outfit.items} sizes="70px" />
                ))}
              </span>
              <span className="block text-[12.5px] font-semibold leading-tight">{t('asking')}</span>
            </Link>
          </li>
        ))}
        {groups.map((g) => (
          <li key={`${g.author.username}-${g.day}`} className="w-32 shrink-0">
            <Link href="/dashboard/friends" className="block space-y-2 rounded-lg bg-panel p-2.5">
              <span className="flex items-center gap-2">
                <PersonAvatar user={g.author} size={28} />
                <span className="min-w-0 truncate text-[13px] font-bold">{g.author.display_name}</span>
              </span>
              <OutfitComposition items={g.outfits[0].items} sizes="110px" />
              {g.outfits.length > 1 && (
                <span className="block text-[12px] text-muted-foreground">{t('more', { count: g.outfits.length - 1 })}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
