'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Heart, Loader2, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useReact, useRemoveReaction, type SocialOutfit } from '@/lib/hooks/use-social';

const COMMENT_MAX = 500;

/** "Me encanta" toggle + comment for a friend's shared look. */
export function ReactionBar({ outfit }: { outfit: SocialOutfit }) {
  const t = useTranslations('social.reactions');
  const react = useReact();
  const unreact = useRemoveReaction();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState(outfit.my_reaction?.comment ?? '');

  if (outfit.is_mine) {
    return outfit.reaction_count > 0 ? (
      <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
        <Heart className="h-4 w-4 fill-signature text-signature" aria-hidden />
        {t('count', { count: outfit.reaction_count })}
      </p>
    ) : null;
  }

  const loved = !!outfit.my_reaction;
  const busy = react.isPending || unreact.isPending;

  const toggleLove = () => {
    const onError = () => toast.error(t('error'));
    if (loved) unreact.mutate(outfit.id, { onError });
    else react.mutate({ outfitId: outfit.id }, { onError });
  };

  const sendComment = () => {
    react.mutate(
      { outfitId: outfit.id, comment: comment.trim() || null },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(t('commentSent'));
        },
        onError: () => toast.error(t('error')),
      }
    );
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggleLove}
        disabled={busy}
        aria-pressed={loved}
        aria-label={loved ? t('unlove') : t('love')}
        className={cn(
          'inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]',
          loved ? 'bg-signature-soft text-foreground' : 'hover:bg-accent'
        )}
      >
        <Heart
          className={cn('h-5 w-5 transition-transform', loved && 'scale-110 fill-signature text-signature')}
          strokeWidth={loved ? 2 : 1.75}
          aria-hidden
        />
        <span>{outfit.reaction_count > 0 ? outfit.reaction_count : t('loveShort')}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setComment(outfit.my_reaction?.comment ?? '');
          setOpen(true);
        }}
        aria-label={t('comment')}
        className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessageCircle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        {outfit.my_reaction?.comment ? t('editComment') : t('commentShort')}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('commentTitle', { name: '@' + outfit.author.username })}</DialogTitle>
            <DialogDescription>{t('commentHint')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
            placeholder={t('commentPlaceholder')}
            rows={3}
            aria-label={t('comment')}
          />
          <p className="text-right text-xs text-muted-foreground">
            {comment.length}/{COMMENT_MAX}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={sendComment} disabled={react.isPending}>
              {react.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t('send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
