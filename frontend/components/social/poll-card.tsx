'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/social/person-avatar';
import { OutfitComposition } from '@/components/social/outfit-composition';
import { useDeletePoll, useVotePoll, type LookPoll } from '@/lib/hooks/use-social';
import { haptic } from '@/lib/native/haptics';
import { cn } from '@/lib/utils';

/** Index of the option with the most votes, or -1 on a tie or no votes. */
export function leader(poll: LookPoll): number {
  const counts = poll.options.map((o) => o.votes ?? 0);
  const top = Math.max(...counts);
  if (top === 0 || counts.filter((c) => c === top).length > 1) return -1;
  return counts.indexOf(top);
}

/**
 * «¿Cuál me pongo?»: a friend's question (tap a look to vote; the counts show
 * once you have voted) or your own (the votes as they come in).
 */
export function PollCard({ poll }: { poll: LookPoll }) {
  const t = useTranslations('social.polls');
  const format = useFormatter();
  const vote = useVotePoll();
  const remove = useDeletePoll();
  const best = leader(poll);
  const showCounts = poll.options.some((o) => o.votes !== null);

  const choose = (outfitId: string) => {
    if (poll.is_mine || !poll.is_open || vote.isPending) return;
    haptic(10);
    vote.mutate(
      { pollId: poll.id, outfitId },
      {
        onSuccess: () => toast.success(t('voted', { name: poll.author.display_name })),
        onError: () => toast.error(t('voteError')),
      }
    );
  };

  return (
    <article className="space-y-3 rounded-lg bg-panel p-4" data-testid="poll-card">
      <header className="flex items-center gap-3">
        <PersonAvatar user={poll.author} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">
            {poll.is_mine ? t('mineTitle') : t('askTitle', { name: poll.author.display_name })}
          </p>
          <p className="truncate text-[13px] text-muted-foreground">
            {poll.question || t('defaultQuestion')}
          </p>
        </div>
        {poll.is_mine && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('delete')}
            disabled={remove.isPending}
            onClick={() => remove.mutate(poll.id)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </header>

      <ol className={cn('grid gap-2', poll.options.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {poll.options.map((option, i) => {
          const mine = poll.my_vote === option.outfit.id;
          const pct =
            showCounts && poll.total_votes ? Math.round(((option.votes ?? 0) / poll.total_votes) * 100) : 0;
          return (
            <li key={option.outfit.id}>
              <button
                type="button"
                onClick={() => choose(option.outfit.id)}
                disabled={poll.is_mine || !poll.is_open}
                aria-pressed={mine}
                aria-label={t('optionLabel', { n: i + 1 })}
                className={cn(
                  'relative block w-full overflow-hidden rounded-[18px] bg-background text-left ring-offset-2 ring-offset-panel transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  mine && 'ring-2 ring-foreground',
                  !poll.is_mine && poll.is_open && 'pressable'
                )}
              >
                <OutfitComposition items={option.outfit.items} sizes="160px" className="pointer-events-none" />
                <span className="flex items-center justify-between gap-1 px-2.5 py-2 text-[13px] font-bold">
                  <span>{t('option', { n: i + 1 })}</span>
                  {showCounts ? (
                    <span className={cn('tabular-nums', i === best ? 'text-foreground' : 'text-muted-foreground')}>
                      {pct}%
                    </span>
                  ) : null}
                </span>
                {showCounts && (
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-border" aria-hidden>
                    <span className="block h-full bg-foreground" style={{ width: `${pct}%` }} />
                  </span>
                )}
                {mine && (
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <p className="text-[12.5px] text-muted-foreground">
        {poll.is_mine
          ? poll.total_votes
            ? best >= 0
              ? t('winning', { n: best + 1, count: poll.total_votes })
              : t('tied', { count: poll.total_votes })
            : t('noVotesYet')
          : poll.my_vote
            ? t('changeVote')
            : t('tapToVote')}
        {poll.is_open && (
          <> · {t('closes', { time: format.dateTime(new Date(poll.closes_at), { hour: '2-digit', minute: '2-digit' }) })}</>
        )}
      </p>
    </article>
  );
}
