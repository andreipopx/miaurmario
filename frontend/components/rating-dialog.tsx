'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useRateOutfit } from '@/lib/hooks/use-social';
import { getErrorMessage } from '@/lib/api';

interface RatingDialogProps {
  outfitId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RatingDialog({ outfitId, open, onOpenChange }: RatingDialogProps) {
  const t = useTranslations('outfitCard.rate');
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending } = useRateOutfit();

  const submit = async () => {
    setError(null);
    if (rating < 1 || rating > 5) {
      setError(t('pickRating'));
      return;
    }
    try {
      await mutateAsync({ outfitId, rating, comment: comment.trim() || undefined });
      onOpenChange(false);
      setRating(0);
      setComment('');
    } catch (err) {
      setError(getErrorMessage(err, t('errorGeneric')));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-2" role="radiogroup" aria-label={t('title')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-checked={rating === n}
                role="radio"
                className={`font-display text-3xl transition-colors ${
                  rating >= n ? 'text-primary' : 'text-muted-foreground/40'
                }`}
              >
                ★
              </button>
            ))}
          </div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('commentPlaceholder')}
            maxLength={500}
            rows={3}
          />
          {error && <p className="label-editorial text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? t('sending') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
