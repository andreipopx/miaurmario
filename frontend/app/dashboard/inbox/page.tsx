'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Settings } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { PersonAvatar } from '@/components/social/person-avatar';
import { RelationActions } from '@/components/social/relation-actions';
import { ActivityList } from '@/components/social/activity-list';
import { useFriendsOverview, useSocialActivity } from '@/lib/hooks/use-social';

/**
 * Avisos (the bell): what's waiting for you — friend requests to answer and what
 * friends did with your looks. How you're notified is in Ajustes → Notificaciones,
 * one tap away from here.
 */
export default function InboxPage() {
  const t = useTranslations('inbox');
  const { data: overview } = useFriendsOverview();
  const { data: activity } = useSocialActivity();
  const incoming = overview?.incoming ?? [];
  // «Tus looks» as a heading only over something: with nothing new the quiet
  // empty state says it all by itself.
  const hasActivity = (activity?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={t('title')}
        action={
          <Link
            href="/dashboard/notifications"
            aria-label={t('settings')}
            title={t('settings')}
            className="pressable flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </Link>
        }
      />

      {incoming.length > 0 && (
        <section aria-labelledby="inbox-requests" className="space-y-2">
          <h2 id="inbox-requests" className="px-1 text-[15px] font-bold">
            {t('requests', { count: incoming.length })}
          </h2>
          <ul className="space-y-2">
            {incoming.map((f) => (
              <li key={f.id} className="space-y-2.5 rounded-2xl bg-signature-soft px-3 py-3">
                <Link
                  href={`/dashboard/friends/${encodeURIComponent(f.user.username)}`}
                  className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PersonAvatar user={f.user} size={44} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-bold">@{f.user.username}</span>
                    <span className="block truncate text-sm text-muted-foreground">{t('wantsToBeFriends')}</span>
                  </span>
                </Link>
                {/* Under the name, so a long @name is never squeezed by the buttons. */}
                <div className="pl-14">
                  <RelationActions username={f.user.username} relation="incoming" friendshipId={f.id} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={t('activity')} className="space-y-2">
        {hasActivity && <h2 className="px-1 text-[15px] font-bold">{t('activity')}</h2>}
        <ActivityList />
      </section>
    </div>
  );
}
