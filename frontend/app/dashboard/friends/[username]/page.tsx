'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Ban, ChevronLeft, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { LoadMoreSentinel } from '@/components/native/load-more-sentinel';
import { PersonAvatar } from '@/components/social/person-avatar';
import { RelationActions, useFriendErrorMessage } from '@/components/social/relation-actions';
import { SocialOutfitTile, useDayLabel } from '@/components/social/feed-day-card';
import { ReactionBar } from '@/components/social/reaction-bar';
import { useBlockUser, useProfile, useProfileOutfits } from '@/lib/hooks/use-social';

export default function FriendProfilePage() {
  const t = useTranslations('social.profile');
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const username = params?.username ? decodeURIComponent(params.username) : undefined;
  const profile = useProfile(username);
  const outfits = useProfileOutfits(username, profile.isSuccess);
  const block = useBlockUser();
  const errorMessage = useFriendErrorMessage();
  const dayLabel = useDayLabel();
  const [justAccepted, setJustAccepted] = useState(false);

  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 h-11 max-lg:hidden">
      <Link href="/dashboard/friends">
        <ChevronLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {t('back')}
      </Link>
    </Button>
  );

  if (profile.isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <Skeleton className="h-40 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="aspect-[3/4] rounded-tile" />
          <Skeleton className="aspect-[3/4] rounded-tile" />
        </div>
      </div>
    );
  }

  if (profile.isError || !profile.data) {
    const notFound = profile.error instanceof ApiError && profile.error.status === 404;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <EmptyState state="sad" title={notFound ? t('notFoundTitle') : t('errorTitle')} description={notFound ? t('notFoundBody') : undefined} />
      </div>
    );
  }

  const { user, relation, friendship_id, is_me, friend_count } = profile.data;
  const list = outfits.data?.pages.flatMap((p) => p.items) ?? [];

  const onBlock = () => {
    if (!confirm(t('confirmBlock', { name: '@' + user.username }))) return;
    block.mutate(user.username, {
      onSuccess: () => {
        toast.success(t('blocked'));
        router.push('/dashboard/friends?tab=friends');
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {back}

      <section className="rounded-lg bg-panel p-5 text-center">
        <div className="relative mx-auto w-fit">
          <PersonAvatar user={user} size={96} className="mx-auto" />
          {justAccepted && (
            <span className="absolute -bottom-3 -right-8">
              <LazyStinky state="happy" size={64} label="" />
            </span>
          )}
        </div>
        <h1 className="mt-3 text-[26px] font-extrabold leading-tight tracking-[-0.02em]">@{user.username}</h1>
        {user.bio && <p className="mx-auto mt-2 max-w-sm text-[15px] leading-snug">{user.bio}</p>}
        {friend_count != null && (
          <p className="mt-2 text-sm text-muted-foreground">{t('friendCount', { count: friend_count })}</p>
        )}
        {!is_me && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <RelationActions
              username={user.username}
              relation={relation}
              friendshipId={friendship_id}
              showRemove
              onAccepted={() => {
                setJustAccepted(true);
                profile.refetch();
                outfits.refetch();
              }}
            />
            {relation !== 'blocked' && (
              <Button variant="ghost" onClick={onBlock} disabled={block.isPending} className="text-muted-foreground">
                {block.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Ban className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
                {t('block')}
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-lg font-bold">{t('sharedLooks')}</h2>
        {outfits.isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="aspect-[3/4] rounded-tile" />
            <Skeleton className="aspect-[3/4] rounded-tile" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            size="sm"
            state="sleepy"
            title={relation === 'friends' || is_me ? t('noLooksTitle') : t('notFriendsTitle')}
            description={relation === 'friends' || is_me ? t('noLooksBody', { name: '@' + user.username }) : t('notFriendsBody', { name: '@' + user.username })}
          />
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
            {list.map((o) => (
              <li key={o.id}>
                <SocialOutfitTile outfit={o} compact />
                <div className="flex items-center justify-between gap-1 px-1">
                  {o.day && <span className="truncate text-xs text-muted-foreground first-letter:uppercase">{dayLabel(o.day)}</span>}
                </div>
                <ReactionBar outfit={o} />
              </li>
            ))}
          </ul>
        )}
        {outfits.hasNextPage && (
          <div className="flex flex-col items-center">
            <LoadMoreSentinel
              enabled={!outfits.isFetchingNextPage}
              onVisible={() => void outfits.fetchNextPage()}
            />
            <Button variant="secondary" onClick={() => outfits.fetchNextPage()} disabled={outfits.isFetchingNextPage}>
              {outfits.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t('loadMore')}
            </Button>
          </div>
        )}
        <p className="px-1 text-xs text-muted-foreground">{t('borrowSoon')}</p>
      </section>
    </div>
  );
}
