'use client';

import { useState } from 'react';
import { Star, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useSubmitFamilyRating, useDeleteFamilyRating } from '@/lib/hooks/use-outfits';
import { FamilyRating } from '@/lib/types';
import { cn } from '@/lib/utils';

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useTranslations('familyRatings');
  const [hovered, setHovered] = useState(0);

  return (
    <div role="group" aria-label={t('yourRating')} className="flex" onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHovered(star)}
          onClick={() => onChange(star)}
          aria-label={t('starsLabel', { count: star })}
          aria-pressed={value === star}
          className="flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-150 hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90"
        >
          <Star
            aria-hidden
            strokeWidth={1.75}
            className={cn(
              'h-6 w-6 transition-colors',
              star <= (hovered || value) ? 'fill-pop-amber text-pop-amber' : 'text-muted-foreground/40'
            )}
          />
        </button>
      ))}
    </div>
  );
}

interface FamilyRatingFormProps {
  outfitId: string;
  existingRating?: FamilyRating;
  onSuccess?: () => void;
}

export function FamilyRatingForm({ outfitId, existingRating, onSuccess }: FamilyRatingFormProps) {
  const t = useTranslations('familyRatings');
  const [rating, setRating] = useState(existingRating?.rating ?? 0);
  const [comment, setComment] = useState(existingRating?.comment ?? '');
  const submitRating = useSubmitFamilyRating();

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error(t('toast.ratingRequired'));
      return;
    }
    try {
      await submitRating.mutateAsync({
        outfitId,
        rating,
        comment: comment.trim() || undefined,
      });
      toast.success(existingRating ? t('toast.ratingUpdated') : t('toast.ratingSubmitted'));
      onSuccess?.();
    } catch {
      toast.error(t('toast.submitFailed'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">{t('yourRating')}</span>
        <StarPicker value={rating} onChange={setRating} />
      </div>
      <Textarea
        placeholder={t('commentPlaceholder')}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        maxLength={500}
        className="resize-none rounded-lg text-sm"
      />
      <Button
        onClick={handleSubmit}
        disabled={rating === 0 || submitRating.isPending}
      >
        {submitRating.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {existingRating ? t('update') : t('submit')}
      </Button>
    </div>
  );
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

interface FamilyRatingsDisplayProps {
  ratings: FamilyRating[];
  outfitId: string;
  currentUserId?: string;
}

export function FamilyRatingsDisplay({ ratings, outfitId, currentUserId }: FamilyRatingsDisplayProps) {
  const t = useTranslations('familyRatings');
  const deleteRating = useDeleteFamilyRating();

  if (ratings.length === 0) return null;

  const handleDelete = async () => {
    try {
      await deleteRating.mutateAsync(outfitId);
      toast.success(t('toast.ratingRemoved'));
    } catch {
      toast.error(t('toast.removeFailed'));
    }
  };

  return (
    <div className="space-y-2">
      {ratings.map((r) => (
        <div key={r.id} className="flex items-start gap-3 rounded-md bg-panel p-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={r.user_avatar_url} />
            <AvatarFallback className="text-xs">
              {getInitials(r.user_display_name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-bold">{r.user_display_name}</span>
              <div className="flex gap-0.5" role="img" aria-label={t('starsLabel', { count: r.rating })}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    aria-hidden
                    className={cn(
                      'h-3.5 w-3.5',
                      star <= r.rating ? 'fill-pop-amber text-pop-amber' : 'text-muted-foreground/30'
                    )}
                  />
                ))}
              </div>
            </div>
            {r.comment && (
              <p className="text-xs text-muted-foreground mt-0.5">&ldquo;{r.comment}&rdquo;</p>
            )}
          </div>
          {currentUserId && r.user_id === currentUserId && (
            <Button
              variant="ghost"
              size="icon"
              className="-my-1.5 -mr-1.5 shrink-0 text-muted-foreground hover:bg-background hover:text-destructive"
              aria-label={t('removeRating')}
              onClick={handleDelete}
              disabled={deleteRating.isPending}
            >
              {deleteRating.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              )}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
