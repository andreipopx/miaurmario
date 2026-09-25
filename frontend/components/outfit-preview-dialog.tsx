'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { CalendarDays, ChevronLeft, ChevronRight, X, RotateCcw, RotateCw, Loader2, Users, Star, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { StinkyTip } from '@/components/stinky-tip';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { type Outfit } from '@/lib/hooks/use-outfits';
import { useFamily } from '@/lib/hooks/use-family';
import { useRotateImage } from '@/lib/hooks/use-items';
import { FamilyRatingForm, FamilyRatingsDisplay } from '@/components/family-ratings';
import { toast } from 'sonner';
import { useFormatter, useTranslations } from 'next-intl';
import Image from 'next/image';
import { useTagLabel } from '@/lib/tag-labels';
import { clothingColorHex } from '@/lib/colors';

interface OutfitPreviewDialogProps {
  outfit: Outfit;
  open: boolean;
  onClose: () => void;
  isOwner?: boolean;
}

export function OutfitPreviewDialog({ outfit, open, onClose, isOwner = true }: OutfitPreviewDialogProps) {
  const t = useTranslations('outfitPreview');
  const tc = useTranslations('common');
  const tOccasions = useTranslations('suggest.occasions');
  const tagLabel = useTagLabel();
  const format = useFormatter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageKey, setImageKey] = useState(0); // Force image reload after rotation
  const [showRatingForm, setShowRatingForm] = useState(false);
  const items = outfit.items;
  const rotateImage = useRotateImage();
  const { data: session } = useSession();
  const { data: family } = useFamily();

  const currentEmail = session?.user?.email;
  const currentMember = family?.members.find((m) => m.email === currentEmail);
  const isInFamily = !!family && !!currentMember;
  const canRate = isInFamily && !isOwner;
  const myRating = outfit.family_ratings?.find((r) => r.user_id === currentMember?.id);

  const currentItem = items[currentIndex];

  const goToPrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? items.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === items.length - 1 ? 0 : prev + 1));
  };

  const handleRotate = async (direction: 'cw' | 'ccw') => {
    try {
      await rotateImage.mutateAsync({ id: currentItem.id, direction });
      setImageKey((k) => k + 1); // Force image reload
      toast.success(t('toast.rotated'));
    } catch {
      toast.error(t('toast.rotateFailed'));
    }
  };

  if (!currentItem) return null;

  const occasionLabel = tOccasions.has(outfit.occasion as never)
    ? tOccasions(outfit.occasion as never)
    : outfit.occasion;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col overflow-hidden p-0 [&>button]:hidden">
        {/* Header - sticky */}
        <div className="flex flex-shrink-0 items-center justify-between px-5 pb-3 pt-4">
          <div className="min-w-0">
            <DialogTitle className="pr-0 text-xl font-extrabold">{occasionLabel}</DialogTitle>
            <div className="mt-0.5 flex items-center gap-2">
              {outfit.scheduled_for && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {format.dateTime(new Date(outfit.scheduled_for + 'T00:00:00'), { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
              )}
              <span className="text-xs font-semibold text-muted-foreground" aria-live="polite">
                {currentIndex + 1} / {items.length}
              </span>
            </div>
          </div>
          <Button
            variant="secondary"
            size="icon"
            onClick={onClose}
            className="-mr-1 shrink-0"
            aria-label={tc('close')}
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </Button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Main image area */}
          <div className="relative mx-5 rounded-tile bg-panel">
            <Link
              href={`/dashboard/wardrobe?item=${currentItem.id}`}
              className="block rounded-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {/* Image - smaller on mobile */}
              <div className="relative aspect-square max-h-[280px] w-full sm:max-h-[350px]">
                {currentItem.image_url ? (
                  <Image
                    key={`${currentItem.id}-${imageKey}`}
                    src={currentItem.image_url}
                    alt={currentItem.name || tagLabel('types', currentItem.type)}
                    fill
                    className="object-contain p-4"
                    sizes="(max-width: 512px) 100vw, 512px"
                    priority
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    —
                  </div>
                )}
              </div>
            </Link>

            {/* Navigation arrows */}
            {items.length > 1 && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 border-0 bg-background/90 shadow-sm hover:bg-background"
                  onClick={goToPrev}
                  aria-label={tc('aria.previousImage')}
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 border-0 bg-background/90 shadow-sm hover:bg-background"
                  onClick={goToNext}
                  aria-label={tc('aria.nextImage')}
                >
                  <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
                </Button>
              </>
            )}
          </div>

          {/* Item details */}
          <div className="space-y-3 px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="first-letter:uppercase">
                  {tagLabel('types', currentItem.type)}
                </Badge>
                {currentItem.subtype && (
                  <Badge variant="outline" className="capitalize">
                    {currentItem.subtype}
                  </Badge>
                )}
                {currentItem.primary_color && (
                  <Badge variant="outline" className="gap-1.5">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: clothingColorHex(currentItem.primary_color) ?? currentItem.primary_color }}
                    />
                    {tagLabel('colors', currentItem.primary_color)}
                  </Badge>
                )}
              </div>
              {/* Rotate buttons */}
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRotate('ccw')}
                  disabled={rotateImage.isPending}
                  title={t('rotateLeft')}
                  aria-label={t('rotateLeft')}
                >
                  {rotateImage.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRotate('cw')}
                  disabled={rotateImage.isPending}
                  title={t('rotateRight')}
                  aria-label={t('rotateRight')}
                >
                  {rotateImage.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCw className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </Button>
              </div>
            </div>
            {currentItem.name && (
              <p className="break-words font-bold">{currentItem.name}</p>
            )}
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/dashboard/wardrobe?item=${currentItem.id}`}>
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('viewItemDetails')}
              </Link>
            </Button>
          </div>

          {/* Thumbnail strip */}
          {items.length > 1 && (
            <div className="border-t border-border px-5 py-3">
              <div className="-mx-1 flex gap-2 overflow-x-auto scrollbar-none px-1 py-1">
                {items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    aria-label={item.name || tagLabel('types', item.type)}
                    aria-current={index === currentIndex ? 'true' : undefined}
                    className={cn(
                      'relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-[14px] bg-panel transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      index === currentIndex
                        ? 'ring-[2.5px] ring-inset ring-signature'
                        : 'hover:ring-[1.5px] hover:ring-inset hover:ring-border'
                    )}
                  >
                    {item.thumbnail_url ? (
                      <Image
                        src={item.thumbnail_url}
                        alt=""
                        fill
                        className="object-contain p-1"
                        sizes="56px"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                        {tagLabel('types', item.type).charAt(0).toUpperCase()}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Outfit details section */}
          {(outfit.reasoning || outfit.highlights || outfit.style_notes) && (
            <div className="space-y-3 border-t border-border px-5 py-4">
              {outfit.reasoning && (
                <p className="break-words font-semibold text-foreground">{outfit.reasoning}</p>
              )}
              {outfit.highlights && outfit.highlights.length > 0 && (
                <ul className="space-y-1.5">
                  {outfit.highlights.map((highlight, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-signature" />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              )}
              {outfit.style_notes && (
                <StinkyTip className="bg-panel">
                  <span className="break-words">{outfit.style_notes}</span>
                </StinkyTip>
              )}
            </div>
          )}

          {/* Family ratings section */}
          {isInFamily && (
            <div className="space-y-3 border-t border-border px-5 py-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-[15px] font-bold">
                  <Users className="h-4 w-4" strokeWidth={1.75} />
                  {t('familyRatings')}
                  {outfit.family_rating_count != null && outfit.family_rating_count > 0 && (
                    <span className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground">
                      ({outfit.family_rating_average?.toFixed(1)}
                      <Star className="h-3 w-3 fill-pop-amber text-pop-amber" />
                      {t('avg')})
                    </span>
                  )}
                </h3>
                {canRate && !showRatingForm && !myRating && (
                  <Button
                    size="sm"
                    variant="signature"
                    onClick={() => setShowRatingForm(true)}
                  >
                    <Star className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t('rate')}
                  </Button>
                )}
              </div>

              {canRate && (showRatingForm || myRating) && (
                <FamilyRatingForm
                  outfitId={outfit.id}
                  existingRating={myRating ?? undefined}
                  onSuccess={() => setShowRatingForm(false)}
                />
              )}

              {outfit.family_ratings && outfit.family_ratings.length > 0 && (
                <FamilyRatingsDisplay
                  ratings={outfit.family_ratings}
                  outfitId={outfit.id}
                  currentUserId={canRate ? currentMember?.id : undefined}
                />
              )}

              {(!outfit.family_ratings || outfit.family_ratings.length === 0) && !canRate && (
                <p className="text-xs text-muted-foreground">
                  {t('noFamilyRatings')}
                </p>
              )}
              {(!outfit.family_ratings || outfit.family_ratings.length === 0) && canRate && !showRatingForm && !myRating && (
                <p className="text-xs text-muted-foreground">
                  {t('noFamilyRatingsBeFirst')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Close button at bottom - always visible */}
        <div className="flex-shrink-0 border-t border-border p-4">
          <Button variant="secondary" className="w-full" onClick={onClose}>
            {tc('close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
