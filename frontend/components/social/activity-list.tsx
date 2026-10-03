'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useFormatter, useTranslations } from 'next-intl';
import { Heart, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PersonAvatar } from '@/components/social/person-avatar';
import { useMarkActivitySeen, useSocialActivity } from '@/lib/hooks/use-social';

/**
 * What friends did with your looks ("me encanta", comments), newest first. New
 * entries are marked seen while the list is on screen.
 */
export function ActivityList({ active = true }: { active?: boolean }) {
  const t = useTranslations('social.activity');
  const tOccasions = useTranslations('suggest.occasions');
  const format = useFormatter();
  const { data, isLoading } = useSocialActivity();
  const markSeen = useMarkActivitySeen();
  const hasNew = !!data?.some((a) => a.is_new);

  useEffect(() => {
    if (active && hasNew && !markSeen.isPending) markSeen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hasNew]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[72px] w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (!data || data.length === 0) {
    return <EmptyState state="sleepy" size="sm" title={t('emptyTitle')} description={t('emptyBody')} />;
  }
  return (
    <ul className="space-y-2">
      {data.map((a) => {
        const occasion = tOccasions.has(a.outfit_occasion as never) ? tOccasions(a.outfit_occasion as never) : a.outfit_occasion;
        return (
          <li key={a.id}>
            <Link
              href={`/dashboard/outfits/${a.outfit_id}`}
              className={cn(
                'flex min-h-[72px] items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                a.is_new ? 'bg-signature-soft' : 'bg-panel'
              )}
            >
              <PersonAvatar user={a.user} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">
                  <strong className="font-bold">@{a.user.username}</strong>{' '}
                  {a.comment ? t('commented') : t('loved')}{' '}
                  <span className="font-semibold first-letter:uppercase">{a.outfit_name || occasion}</span>
                </span>
                {a.comment && (
                  <span className="mt-0.5 flex items-start gap-1.5 text-sm text-foreground/80">
                    <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                    <span className="line-clamp-2 break-words">{a.comment}</span>
                  </span>
                )}
                {a.updated_at && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {format.relativeTime(new Date(a.updated_at))}
                  </span>
                )}
              </span>
              <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-background">
                {a.outfit_thumbnail_url ? (
                  <Image src={a.outfit_thumbnail_url} alt="" fill className="object-contain p-1" sizes="48px" />
                ) : (
                  <Heart className="m-3.5 h-5 w-5 fill-signature text-signature" aria-hidden />
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
