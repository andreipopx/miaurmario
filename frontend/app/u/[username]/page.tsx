'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/hooks/use-auth';
import { useProfile } from '@/lib/hooks/use-social';
import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/brand/wordmark';
import { Stinky } from '@/components/stinky/stinky';
import { PersonAvatar } from '@/components/social/person-avatar';
import { RelationActions } from '@/components/social/relation-actions';
import { ShareProfileButton } from '@/components/social/invite-card';

/**
 * Share-invite landing: /u/{username}. Signed-in users see a mini-profile with
 * "Añadir a tus amigos"; everyone else goes to /login and comes back here.
 */
export default function PublicProfilePage() {
  const t = useTranslations('social.publicProfile');
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const username = params?.username ? decodeURIComponent(params.username) : '';
  const { status } = useSession();
  const { isAuthenticated, isLoading } = useAuth();
  const profile = useProfile(isAuthenticated ? username : undefined);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/login?callbackUrl=${encodeURIComponent(`/u/${encodeURIComponent(username)}`)}`);
    }
  }, [status, router, username]);

  const loading = status === 'loading' || status === 'unauthenticated' || isLoading || profile.isLoading;
  const notFound = profile.error instanceof ApiError && profile.error.status === 404;
  const data = profile.data;

  const stinkyState = celebrate || data?.relation === 'friends' ? 'happy' : notFound ? 'sad' : 'wave';

  return (
    <main className="flex min-h-screen flex-col items-center bg-background px-4 pb-10" style={{ paddingTop: 'max(24px, env(safe-area-inset-top))' }}>
      <Link href="/dashboard" className="rounded-full px-2" aria-label="Miaurmario">
        <Wordmark className="text-[26px]" />
      </Link>

      <div className="mt-6 w-full max-w-sm">
        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label={t('loading')} />
          </div>
        ) : notFound || !data ? (
          <section className="rounded-lg bg-panel p-6 text-center">
            <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-signature-soft">
              <Stinky state="sad" size={108} label="" />
            </div>
            <h1 className="mt-4 text-xl font-extrabold">{t('notFoundTitle')}</h1>
            <p className="mt-1 text-[15px] text-muted-foreground">{t('notFoundBody')}</p>
            <Button asChild className="mt-5 w-full">
              <Link href="/dashboard">{t('goHome')}</Link>
            </Button>
          </section>
        ) : (
          <section className="rounded-lg bg-panel p-6 text-center">
            <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-signature-soft">
              <Stinky state={stinkyState} size={108} label="" />
            </div>
            <div className="mt-4 flex justify-center">
              <PersonAvatar user={data.user} size={64} />
            </div>
            <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em]">@{data.user.username}</h1>
            {data.user.bio && <p className="mt-2 text-[15px] leading-snug">{data.user.bio}</p>}

            <div className="mt-5 flex flex-col items-stretch gap-2">
              {data.is_me ? (
                <>
                  <p className="text-sm text-muted-foreground">{t('isMe')}</p>
                  <ShareProfileButton />
                </>
              ) : data.relation === 'friends' ? (
                <>
                  <p className="text-[15px] font-semibold">{t('alreadyFriends', { name: '@' + data.user.username })}</p>
                  <Button asChild size="lg">
                    <Link href={`/dashboard/friends/${encodeURIComponent(data.user.username)}`}>{t('seeLooks')}</Link>
                  </Button>
                </>
              ) : data.relation === 'blocked' ? (
                <p className="text-sm text-muted-foreground">{t('blockedByYou')}</p>
              ) : (
                <>
                  <p className="text-[15px]">{t('invite', { name: '@' + data.user.username })}</p>
                  <div className="flex justify-center">
                    <RelationActions
                      username={data.user.username}
                      relation={data.relation}
                      friendshipId={data.friendship_id}
                      size="lg"
                      onAccepted={() => {
                        setCelebrate(true);
                        profile.refetch();
                      }}
                    />
                  </div>
                </>
              )}
              <Button asChild variant="ghost">
                <Link href="/dashboard/friends">{t('goFriends')}</Link>
              </Button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
