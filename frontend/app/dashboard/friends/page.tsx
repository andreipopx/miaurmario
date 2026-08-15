'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useAcceptFriend,
  useDeclineFriend,
  useFriends,
  type Friendship,
} from '@/lib/hooks/use-social';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FriendRequestButton } from '@/components/friend-request-button';
import { getErrorMessage } from '@/lib/api';

type TabKey = 'friends' | 'pending' | 'search';

function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function FriendRow({ friendship }: { friendship: Friendship }) {
  const t = useTranslations('friends');
  const other = friendship.other;
  const label = other.username ? `@${other.username}` : other.display_name;

  return (
    <div className="flex items-center gap-3 border-b border-border-solid/40 py-3 last:border-none">
      <Avatar className="h-9 w-9 rounded-none border border-border-solid/60">
        <AvatarImage src={other.avatar_url || ''} alt={other.display_name} className="rounded-none" />
        <AvatarFallback className="rounded-none bg-transparent font-display text-sm">
          {initials(other.display_name || label)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-1 flex-col">
        <span className="font-display italic">{label}</span>
        {other.username && other.display_name && (
          <span className="label-editorial text-muted-foreground">{other.display_name}</span>
        )}
      </div>
      <span className="label-editorial text-muted-foreground">
        {t(`direction.${friendship.direction}`)}
      </span>
    </div>
  );
}

function PendingRow({ friendship }: { friendship: Friendship }) {
  const t = useTranslations('friends');
  const other = friendship.other;
  const label = other.username ? `@${other.username}` : other.display_name;
  const accept = useAcceptFriend();
  const decline = useDeclineFriend();
  const [err, setErr] = useState<string | null>(null);

  const isIncoming = friendship.direction === 'incoming';

  const onAction = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(getErrorMessage(e, t('errors.generic')));
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-border-solid/40 py-3 last:border-none">
      <Avatar className="h-9 w-9 rounded-none border border-border-solid/60">
        <AvatarImage src={other.avatar_url || ''} alt={other.display_name} className="rounded-none" />
        <AvatarFallback className="rounded-none bg-transparent font-display text-sm">
          {initials(other.display_name || label)}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-1 flex-col">
        <span className="font-display italic">{label}</span>
        <span className="label-editorial text-muted-foreground">
          {t(isIncoming ? 'pending.wantsToConnect' : 'pending.awaitingReply')}
        </span>
      </div>
      {isIncoming ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onAction(() => accept.mutateAsync(friendship.id))}>
            {t('actions.accept')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onAction(() => decline.mutateAsync(friendship.id))}
          >
            {t('actions.decline')}
          </Button>
        </div>
      ) : null}
      {err && <span className="label-editorial text-destructive">{err}</span>}
    </div>
  );
}

export default function FriendsPage() {
  const t = useTranslations('friends');
  const [tab, setTab] = useState<TabKey>('friends');

  const accepted = useFriends('accepted');
  const pending = useFriends('pending');

  const friends = accepted.data ?? [];
  const pendingRows = useMemo(
    () => (pending.data ?? []).slice().sort((a, b) => (a.direction === 'incoming' ? -1 : 1)),
    [pending.data]
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display italic text-3xl sm:text-4xl">{t('title')}</h1>
        <p className="label-editorial text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="friends">{t('tabs.friends')}</TabsTrigger>
          <TabsTrigger value="pending">
            {t('tabs.pending')}
            {pendingRows.length > 0 && (
              <span className="ml-2 rounded-none bg-primary px-1.5 text-xs text-primary-foreground">
                {pendingRows.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="search">{t('tabs.search')}</TabsTrigger>
        </TabsList>

        <TabsContent value="friends">
          {accepted.isLoading && <p className="label-editorial text-muted-foreground">{t('loading')}</p>}
          {friends.length === 0 && !accepted.isLoading && (
            <p className="label-editorial text-muted-foreground">{t('empty')}</p>
          )}
          <div>{friends.map((f) => <FriendRow key={f.id} friendship={f} />)}</div>
        </TabsContent>

        <TabsContent value="pending">
          {pending.isLoading && <p className="label-editorial text-muted-foreground">{t('loading')}</p>}
          {pendingRows.length === 0 && !pending.isLoading && (
            <p className="label-editorial text-muted-foreground">{t('pending.empty')}</p>
          )}
          <div>{pendingRows.map((f) => <PendingRow key={f.id} friendship={f} />)}</div>
        </TabsContent>

        <TabsContent value="search">
          <FriendRequestButton />
        </TabsContent>
      </Tabs>
    </div>
  );
}
