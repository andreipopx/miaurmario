'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronRight, Heart, Loader2, MessageCircle, Search, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { LoadMoreSentinel } from '@/components/native/load-more-sentinel';
import { FeedDayCard } from '@/components/social/feed-day-card';
import { InviteCard, ShareProfileButton } from '@/components/social/invite-card';
import { PersonAvatar } from '@/components/social/person-avatar';
import { RelationActions, useFriendErrorMessage } from '@/components/social/relation-actions';
import {
  normalizeUsernameQuery,
  useFriendsFeed,
  useFriendsOverview,
  useMarkActivitySeen,
  useRemoveFriendship,
  useSocialActivity,
  useSocialSummary,
  useUserSearch,
  type Friendship,
  type PublicUser,
} from '@/lib/hooks/use-social';

type Tab = 'feed' | 'friends' | 'activity';
const TABS: Tab[] = ['feed', 'friends', 'activity'];

function CountDot({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signature px-1.5 text-[11px] font-bold text-signature-foreground"
      aria-label={label}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

/** Stinky celebrates for a moment after a new friendship. */
function Celebration({ name, onDone }: { name: string; onDone: () => void }) {
  const t = useTranslations('social.friends');
  useEffect(() => {
    const id = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(id);
  }, [onDone]);
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg bg-signature-soft p-3">
      <LazyStinky state="happy" size={64} label="" />
      <p className="text-[15px] font-bold">{t('celebrate', { name })}</p>
    </div>
  );
}

// -- Feed tab ------------------------------------------------------------------------------

function FeedTab({ hasFriends }: { hasFriends: boolean }) {
  const t = useTranslations('social.feed');
  const feed = useFriendsFeed();
  const groups = feed.data?.pages.flatMap((p) => p.groups) ?? [];

  if (feed.isLoading) {
    return (
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[520px] w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (feed.isError) {
    return <EmptyState state="sad" title={t('errorTitle')} description={t('errorBody')} action={<Button onClick={() => feed.refetch()}>{t('retry')}</Button>} />;
  }
  if (groups.length === 0) {
    return (
      <EmptyState
        state="sleepy"
        title={hasFriends ? t('emptyTitle') : t('noFriendsTitle')}
        description={hasFriends ? t('emptyBody') : t('noFriendsBody')}
        action={<ShareProfileButton variant="signature" />}
      />
    );
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <FeedDayCard key={`${g.author.username}-${g.day}`} group={g} />
      ))}
      {feed.hasNextPage && (
        <div className="flex flex-col items-center">
          <LoadMoreSentinel
            enabled={!feed.isFetchingNextPage}
            onVisible={() => void feed.fetchNextPage()}
          />
          <Button variant="secondary" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

// -- Friends tab ----------------------------------------------------------------------------

function PersonRow({
  user,
  href,
  children,
  stacked = false,
}: {
  user: PublicUser;
  href?: string;
  children?: React.ReactNode;
  /** Put the actions under the name (rows with two buttons). */
  stacked?: boolean;
}) {
  const body = (
    <>
      <PersonAvatar user={user} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold">@{user.username}</span>
      </span>
    </>
  );
  return (
    <li className={cn('flex min-h-[60px] gap-3 rounded-2xl bg-panel px-3 py-2', stacked ? 'flex-col items-stretch py-3' : 'items-center')}>
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {body}
          {!children && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      {children && <div className={cn('shrink-0', stacked && 'pl-[56px]')}>{children}</div>}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[15px] font-bold">{title}</h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function SearchBox({ onAccepted }: { onAccepted: (name: string) => void }) {
  const t = useTranslations('social.friends');
  const [value, setValue] = useState('');
  const q = normalizeUsernameQuery(value);
  const search = useUserSearch(value);

  return (
    <div className="space-y-2">
      <label htmlFor="friend-search" className="sr-only">
        {t('searchLabel')}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <Input
          id="friend-search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('searchPlaceholder')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="search"
          className="border-transparent bg-panel pl-11"
        />
      </div>
      {q.length >= 2 && (
        <div aria-live="polite">
          {search.isLoading ? (
            <Skeleton className="h-[60px] w-full rounded-2xl" />
          ) : search.isError ? (
            <p className="px-1 text-sm text-muted-foreground">{t('searchError')}</p>
          ) : search.data && search.data.length > 0 ? (
            <ul className="space-y-2">
              {search.data.map((r) => (
                <PersonRow
                  key={r.user.username}
                  user={r.user}
                  stacked={r.relation === 'incoming'}
                  href={r.relation === 'friends' ? `/dashboard/friends/${encodeURIComponent(r.user.username)}` : undefined}
                >
                  <RelationActions
                    username={r.user.username}
                    relation={r.relation}
                    friendshipId={r.friendship_id}
                    size="sm"
                    compact
                    onAccepted={() => onAccepted('@' + r.user.username)}
                  />
                </PersonRow>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-sm text-muted-foreground">{t('noResults', { q })}</p>
          )}
        </div>
      )}
    </div>
  );
}

function FriendsTab({ onAccepted }: { onAccepted: (name: string) => void }) {
  const t = useTranslations('social.friends');
  const { data, isLoading } = useFriendsOverview();
  const remove = useRemoveFriendship();
  const errorMessage = useFriendErrorMessage();

  const profileHref = (f: Friendship) => `/dashboard/friends/${encodeURIComponent(f.user.username)}`;

  return (
    <div className="space-y-6">
      <SearchBox onAccepted={onAccepted} />

      {isLoading || !data ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[60px] w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {data.incoming.length > 0 && (
            <Section title={t('incoming', { count: data.incoming.length })}>
              {data.incoming.map((f) => (
                <PersonRow key={f.id} user={f.user} stacked>
                  <RelationActions username={f.user.username} relation="incoming" friendshipId={f.id} size="sm" onAccepted={() => onAccepted('@' + f.user.username)} />
                </PersonRow>
              ))}
            </Section>
          )}

          <Section title={t('yourFriends', { count: data.friends.length })}>
            {data.friends.length === 0 ? (
              <li className="rounded-2xl bg-panel px-4 py-4 text-sm text-muted-foreground">{t('noFriendsYet')}</li>
            ) : (
              data.friends.map((f) => <PersonRow key={f.id} user={f.user} href={profileHref(f)} />)
            )}
          </Section>

          {data.outgoing.length > 0 && (
            <Section title={t('outgoing')}>
              {data.outgoing.map((f) => (
                <PersonRow key={f.id} user={f.user}>
                  <RelationActions username={f.user.username} relation="outgoing" friendshipId={f.id} size="sm" />
                </PersonRow>
              ))}
            </Section>
          )}

          {data.blocked.length > 0 && (
            <Section title={t('blocked')}>
              {data.blocked.map((f) => (
                <PersonRow key={f.id} user={f.user}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(f.id, { onSuccess: () => toast.success(t('unblocked')), onError: (e) => toast.error(errorMessage(e)) })}
                  >
                    <ShieldOff className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    {t('unblock')}
                  </Button>
                </PersonRow>
              ))}
            </Section>
          )}
        </>
      )}

      <InviteCard />
    </div>
  );
}

// -- Activity tab ------------------------------------------------------------------------------

function ActivityTab({ active }: { active: boolean }) {
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

// -- Page ------------------------------------------------------------------------------------------

export default function FriendsPage() {
  const t = useTranslations('social');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initial = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(TABS.includes(initial as Tab) ? (initial as Tab) : 'feed');
  const [celebrating, setCelebrating] = useState<string | null>(null);
  const { data: summary } = useSocialSummary();
  const { data: overview } = useFriendsOverview();

  const changeTab = (value: string) => {
    const next = value as Tab;
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'feed') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const hasFriends = (overview?.friends.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {celebrating && <Celebration name={celebrating} onDone={() => setCelebrating(null)} />}

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="feed">{t('tabs.feed')}</TabsTrigger>
          <TabsTrigger value="friends">
            {t('tabs.friends')}
            <CountDot count={summary?.pending_requests ?? 0} label={t('tabs.pendingLabel', { count: summary?.pending_requests ?? 0 })} />
          </TabsTrigger>
          <TabsTrigger value="activity">
            {t('tabs.activity')}
            <CountDot count={summary?.new_reactions ?? 0} label={t('tabs.newLabel', { count: summary?.new_reactions ?? 0 })} />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="feed" className="mt-4">
          <FeedTab hasFriends={hasFriends} />
        </TabsContent>
        <TabsContent value="friends" className="mt-4">
          <FriendsTab onAccepted={setCelebrating} />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab active={tab === 'activity'} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
