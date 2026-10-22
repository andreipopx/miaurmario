'use client';

import { useTranslations } from 'next-intl';

import { PollCard } from '@/components/social/poll-card';
import { usePolls } from '@/lib/hooks/use-social';

/** Amigos: your friends' «¿Cuál me pongo?» first, then yours. Asking is the icon in the header. */
export function PollsSection({ hasFriends }: { hasFriends: boolean }) {
  const t = useTranslations('social.polls');
  const { data } = usePolls(hasFriends);
  if (!hasFriends) return null;
  const polls = [...(data?.friends ?? []), ...(data?.mine ? [data.mine] : [])];
  if (polls.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={t('sectionLabel')}>
      {polls.map((poll) => (
        <PollCard key={poll.id} poll={poll} />
      ))}
    </section>
  );
}
