'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Vote } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PollCard } from '@/components/social/poll-card';
import { usePolls } from '@/lib/hooks/use-social';

/** Amigos: your friends' «¿Cuál me pongo?» first, then yours, and the way to ask. */
export function PollsSection({ hasFriends }: { hasFriends: boolean }) {
  const t = useTranslations('social.polls');
  const { data } = usePolls(hasFriends);
  if (!hasFriends) return null;
  const polls = [...(data?.friends ?? []), ...(data?.mine ? [data.mine] : [])];
  return (
    <section className="space-y-3" aria-label={t('sectionLabel')}>
      {polls.map((poll) => (
        <PollCard key={poll.id} poll={poll} />
      ))}
      <Button asChild variant="secondary" className="w-full">
        <Link href="/dashboard/friends/poll">
          <Vote className="h-4 w-4" aria-hidden />
          {t('ask')}
        </Link>
      </Button>
    </section>
  );
}
