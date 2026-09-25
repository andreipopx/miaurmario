'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Star, Check, X, ChevronLeft, Search, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useSubmitFeedback, type Outfit } from '@/lib/hooks/use-outfits';
import { useItems } from '@/lib/hooks/use-items';
import { cn } from '@/lib/utils';
import Image from 'next/image';

function StarRating({
  rating,
  onRate,
  size = 'sm',
}: {
  rating: number;
  onRate?: (rating: number) => void;
  size?: 'sm' | 'lg';
}) {
  const t = useTranslations('feedback');
  const sizeClass = size === 'lg' ? 'h-7 w-7' : 'h-4 w-4';

  return (
    <div className="flex gap-0.5" role="group" aria-label={t('overallRating')}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onRate?.(star)}
          disabled={!onRate}
          aria-label={t('starLabel', { count: star })}
          aria-pressed={onRate ? star <= rating : undefined}
          className={cn(
            'flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            size === 'lg' && 'h-11 w-11',
            onRate ? 'cursor-pointer transition-transform duration-150 hover:scale-110 active:scale-95' : 'cursor-default'
          )}
        >
          <Star
            className={cn(
              sizeClass,
              star <= rating ? 'fill-pop-amber text-pop-amber' : 'text-muted-foreground/40'
            )}
            strokeWidth={1.75}
          />
        </button>
      ))}
    </div>
  );
}

interface FeedbackDialogProps {
  outfit: Outfit;
  open: boolean;
  onClose: () => void;
}

type FeedbackStep = 'wear-question' | 'rating' | 'wore-instead';

const PAGE_SIZE = 24;

interface AccumulatedItem {
  id: string;
  name?: string;
  type: string;
  thumbnail_path?: string;
  thumbnail_url?: string;
  image_path: string;
  image_url?: string;
  is_archived: boolean;
}

export function FeedbackDialog({ outfit, open, onClose }: FeedbackDialogProps) {
  const t = useTranslations('feedback');
  const typeLabel = useClothingTypeLabel();
  const [step, setStep] = useState<FeedbackStep>('wear-question');
  const [actuallyWorn, setActuallyWorn] = useState<boolean | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [accumulatedItems, setAccumulatedItems] = useState<AccumulatedItem[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const submitFeedback = useSubmitFeedback();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
      setAccumulatedItems([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: itemsData, isLoading, isFetching } = useItems(
    { search: debouncedSearch || undefined, is_archived: false },
    page,
    PAGE_SIZE
  );
  const hasMore = itemsData?.has_more ?? false;
  const totalItems = itemsData?.total ?? 0;

  useEffect(() => {
    if (itemsData?.items) {
      if (page === 1) {
        setAccumulatedItems(itemsData.items);
      } else {
        setAccumulatedItems((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const newItems = itemsData.items.filter((i) => !existingIds.has(i.id));
          return [...prev, ...newItems];
        });
      }
    }
  }, [itemsData?.items, page]);

  const wardrobeItems = accumulatedItems;

  useEffect(() => {
    if (open) {
      const hasFeedback = outfit.feedback?.rating != null;

      if (hasFeedback) {
        setStep('rating');
        setActuallyWorn(true);
      } else {
        setStep('wear-question');
        setActuallyWorn(null);
      }

      setRating(outfit.feedback?.rating ?? 0);
      setComment(outfit.feedback?.comment ?? '');
      setSelectedItems([]);
      setSearchQuery('');
      setDebouncedSearch('');
      setPage(1);
      setAccumulatedItems([]);
    }
  }, [open, outfit.id, outfit.feedback]);

  const loadMore = useCallback(() => {
    if (hasMore && !isFetching) {
      setPage((p) => p + 1);
    }
  }, [hasMore, isFetching]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const nearBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 100;
    if (nearBottom) {
      loadMore();
    }
  }, [loadMore]);

  const handleWearAnswer = (wore: boolean) => {
    setActuallyWorn(wore);
    if (wore) {
      setStep('rating');
    } else {
      setStep('wore-instead');
    }
  };

  const toggleItemSelection = (itemId: string) => {
    setSelectedItems((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const handleSubmit = async () => {
    try {
      await submitFeedback.mutateAsync({
        outfitId: outfit.id,
        feedback: {
          rating: rating > 0 ? rating : undefined,
          comment: comment.trim() || undefined,
          worn: actuallyWorn === true || undefined,
          actually_worn: actuallyWorn ?? undefined,
          wore_instead_items: selectedItems.length > 0 ? selectedItems : undefined,
        },
      });
      toast.success(t('toast.submitted'));
      onClose();
    } catch {
      toast.error(t('toast.failed'));
    }
  };

  const handleSkipWoreInstead = async () => {
    try {
      await submitFeedback.mutateAsync({
        outfitId: outfit.id,
        feedback: {
          actually_worn: false,
        },
      });
      toast.success(t('toast.submitted'));
      onClose();
    } catch {
      toast.error(t('toast.failed'));
    }
  };

  const outfitItemIds = new Set(outfit.items?.map((i) => i.id) || []);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        {step === 'wear-question' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('wearQuestionTitle')}</DialogTitle>
              <DialogDescription>
                {t('wearQuestionDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <button
                type="button"
                className="flex min-h-[64px] items-center gap-3 rounded-quick bg-panel p-3 text-left transition-[background-color,transform] duration-150 hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => handleWearAnswer(true)}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pop-mint text-pop-foreground">
                  <Check className="h-5 w-5" strokeWidth={2} />
                </span>
                <span>
                  <span className="block font-bold">{t('yesIWoreIt')}</span>
                  <span className="block text-sm text-muted-foreground">{t('rateHowItWent')}</span>
                </span>
              </button>
              <button
                type="button"
                className="flex min-h-[64px] items-center gap-3 rounded-quick bg-panel p-3 text-left transition-[background-color,transform] duration-150 hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => handleWearAnswer(false)}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pop-amber text-pop-foreground">
                  <X className="h-5 w-5" strokeWidth={2} />
                </span>
                <span>
                  <span className="block font-bold">{t('noWoreElse')}</span>
                  <span className="block text-sm text-muted-foreground">{t('tellUsWhatYouWore')}</span>
                </span>
              </button>
            </div>
          </>
        )}

        {step === 'rating' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('ratingTitle')}</DialogTitle>
              <DialogDescription>{t('ratingDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <p className="mb-1 block text-sm font-bold">{t('overallRating')}</p>
                <StarRating rating={rating} onRate={setRating} size="lg" />
              </div>
              <div>
                <label htmlFor="feedback-comment" className="mb-2 block text-sm font-bold">{t('commentsLabel')}</label>
                <Textarea
                  id="feedback-comment"
                  placeholder={t('commentsPlaceholder')}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              {!outfit.feedback?.rating && (
                <Button variant="ghost" className="-ml-2" onClick={() => setStep('wear-question')}>
                  <ChevronLeft className="h-4 w-4" />
                  {t('back')}
                </Button>
              )}
              <div className="ml-auto flex gap-2">
                <Button variant="secondary" onClick={onClose}>
                  {t('cancel')}
                </Button>
                <Button onClick={handleSubmit} disabled={submitFeedback.isPending}>
                  {submitFeedback.isPending ? t('submitting') : t('submit')}
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 'wore-instead' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('whatWoreInsteadTitle')}</DialogTitle>
              <DialogDescription>
                {t('whatWoreInsteadDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('searchWardrobe')}
                aria-label={t('searchWardrobe')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 border-transparent bg-panel pl-10"
              />
            </div>

            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="h-[280px] overflow-y-auto py-2 -mx-2 px-2"
            >
              {selectedItems.length > 0 && (
                <div className="mb-2 text-xs font-semibold text-muted-foreground">
                  {t('itemsSelected', { count: selectedItems.length })}
                </div>
              )}

              <div className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4">
                {wardrobeItems
                  .filter((item) => !outfitItemIds.has(item.id))
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleItemSelection(item.id)}
                      aria-pressed={selectedItems.includes(item.id)}
                      className="group min-w-0 rounded-tile text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <div
                        className={cn(
                          'relative aspect-square overflow-hidden rounded-tile bg-panel transition-shadow duration-150',
                          selectedItems.includes(item.id)
                            ? 'ring-[2.5px] ring-inset ring-signature'
                            : 'group-hover:ring-[1.5px] group-hover:ring-inset group-hover:ring-border'
                        )}
                      >
                        <Image
                          src={item.thumbnail_url || item.image_url || item.image_path}
                          alt={item.name || typeLabel(item.type)}
                          fill
                          className="object-contain p-2"
                          sizes="(max-width: 640px) 33vw, 25vw"
                          loading="lazy"
                        />
                        {selectedItems.includes(item.id) && (
                          <div className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-signature text-signature-foreground">
                            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                          </div>
                        )}
                      </div>
                      <span className="mt-1 block truncate px-0.5 text-xs font-semibold">
                        {item.name || typeLabel(item.type)}
                      </span>
                    </button>
                  ))}
              </div>

              {isLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {isFetching && !isLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{t('loadingMore')}</span>
                </div>
              )}

              {!isLoading && wardrobeItems.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {debouncedSearch ? t('noMatchSearch') : t('noItemsInWardrobe')}
                </div>
              )}

              {!isLoading && !hasMore && wardrobeItems.length > 0 && (
                <div className="text-center text-xs text-muted-foreground py-3">
                  {t('showingAll', { total: totalItems })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
              <Button variant="ghost" className="-ml-2" onClick={() => setStep('wear-question')}>
                <ChevronLeft className="h-4 w-4" />
                {t('back')}
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={handleSkipWoreInstead}>
                  {t('skip')}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitFeedback.isPending || selectedItems.length === 0}
                >
                  {submitFeedback.isPending
                    ? t('submitting')
                    : t('submitWithCount', { count: selectedItems.length })}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
