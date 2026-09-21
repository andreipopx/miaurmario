'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Calendar, Zap, Edit3, ThumbsUp, ThumbsDown, Clock, Eye, Star, ArrowRight, Shirt, Users, ExternalLink, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StinkyTip } from '@/components/stinky-tip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useAcceptOutfit, useRejectOutfit, type Outfit, type OutfitSource, type WoreInsteadItem } from '@/lib/hooks/use-outfits';
import { cn } from '@/lib/utils';
import Image from 'next/image';

type StatusKey = 'accepted' | 'rejected' | 'viewed' | 'sent' | 'pending' | 'expired';

function StatusIcon({ status, label }: { status: Outfit['status']; label: string }) {
  const common = { className: 'h-4 w-4', strokeWidth: 1.75, 'aria-label': label, role: 'img' } as const;
  switch (status) {
    case 'accepted':
      return <ThumbsUp {...common} className="h-4 w-4 text-success" />;
    case 'rejected':
      return <ThumbsDown {...common} className="h-4 w-4 text-destructive" />;
    case 'viewed':
      return <Eye {...common} className="h-4 w-4 text-foreground" />;
    case 'expired':
      return <Clock {...common} className="h-4 w-4 text-warning" />;
    case 'sent':
    case 'pending':
    default:
      return <Clock {...common} className="h-4 w-4 text-muted-foreground" />;
  }
}

function SourceBadge({ source }: { source: OutfitSource }) {
  const t = useTranslations('outfitHistoryCard');
  const config: Record<OutfitSource, { icon: typeof Calendar; variant: 'sky' | 'amber' | 'signature' | 'mint' }> = {
    scheduled: { icon: Calendar, variant: 'sky' },
    on_demand: { icon: Zap, variant: 'amber' },
    manual: { icon: Edit3, variant: 'signature' },
    pairing: { icon: Layers, variant: 'mint' },
  };

  const { icon: Icon, variant } = config[source] ?? config.on_demand;

  return (
    <Badge variant={variant}>
      <Icon className="h-3 w-3" />
      {t(`source.${source}`)}
    </Badge>
  );
}

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5';

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(sizeClass, star <= rating ? 'fill-pop-amber text-pop-amber' : 'text-muted-foreground/30')}
        />
      ))}
    </div>
  );
}

interface OutfitHistoryCardProps {
  outfit: Outfit;
  onFeedback: () => void;
  onPreview?: () => void;
}

export function OutfitHistoryCard({ outfit, onFeedback, onPreview }: OutfitHistoryCardProps) {
  const t = useTranslations('outfitHistoryCard');
  const tOccasions = useTranslations('suggest.occasions');
  const acceptOutfit = useAcceptOutfit();
  const rejectOutfit = useRejectOutfit();
  const [previewItem, setPreviewItem] = useState<WoreInsteadItem | null>(null);

  const handleAccept = async () => {
    try {
      await acceptOutfit.mutateAsync(outfit.id);
      toast.success(t('toast.accepted'));
    } catch {
      toast.error(t('toast.acceptFailed'));
    }
  };

  const handleReject = async () => {
    try {
      await rejectOutfit.mutateAsync(outfit.id);
      toast.success(t('toast.rejected'));
    } catch {
      toast.error(t('toast.rejectFailed'));
    }
  };

  const isPending = outfit.status === 'pending' || outfit.status === 'sent' || outfit.status === 'viewed';
  const occasionLabel = tOccasions.has(outfit.occasion as never)
    ? tOccasions(outfit.occasion as never)
    : outfit.occasion;
  const statusLabel = t.has(`status.${outfit.status}` as never)
    ? t(`status.${outfit.status as StatusKey}`)
    : outfit.status;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardContent className="flex flex-1 flex-col p-4 sm:p-4">
        {/* Header with source badge and status */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <SourceBadge source={outfit.source} />
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{occasionLabel}</Badge>
            <StatusIcon status={outfit.status} label={statusLabel} />
          </div>
        </div>

        {/* Item thumbnails - clickable to preview */}
        <button
          type="button"
          onClick={onPreview}
          aria-label={t('preview')}
          className="group flex w-full flex-wrap gap-2 rounded-[18px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {outfit.items.map((item) => (
            <div
              key={item.id}
              className="relative h-16 w-16 overflow-hidden rounded-[14px] bg-panel transition-transform duration-150 group-hover:scale-[1.03]"
            >
              {item.thumbnail_url ? (
                <Image
                  src={item.thumbnail_url}
                  alt={item.name || item.type}
                  fill
                  className="object-contain p-1.5"
                  sizes="64px"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  {item.type}
                </div>
              )}
            </div>
          ))}
        </button>

        {/* Inline feedback display */}
        {outfit.feedback && (outfit.feedback.rating || outfit.feedback.comment) && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              {outfit.feedback.rating && (
                <StarRating rating={outfit.feedback.rating} />
              )}
              {outfit.feedback.comment && (
                <p className="flex-1 truncate text-xs text-muted-foreground">
                  &ldquo;{outfit.feedback.comment}&rdquo;
                </p>
              )}
            </div>
          </div>
        )}

        {/* Wore instead display */}
        {outfit.feedback?.actually_worn === false && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t('didntWear')}</span>
              {outfit.feedback.wore_instead_items && outfit.feedback.wore_instead_items.length > 0 && (
                <>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-semibold text-foreground">{t('woreInstead')}</span>
                </>
              )}
            </div>
            {outfit.feedback.wore_instead_items && outfit.feedback.wore_instead_items.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {outfit.feedback.wore_instead_items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPreviewItem(item)}
                    className="relative h-14 w-14 overflow-hidden rounded-[14px] bg-panel transition-shadow hover:ring-2 hover:ring-signature focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    title={item.name || item.type}
                    aria-label={item.name || item.type}
                  >
                    {item.thumbnail_url ? (
                      <Image
                        src={item.thumbnail_url}
                        alt={item.name || item.type}
                        fill
                        className="object-contain p-1"
                        sizes="56px"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Shirt className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Family ratings summary */}
        {outfit.family_rating_count != null && outfit.family_rating_count > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-xs">
              <Users className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
              <span className="text-muted-foreground">{t('family')}</span>
              <StarRating rating={Math.round(outfit.family_rating_average ?? 0)} />
              <span className="text-muted-foreground">
                ({outfit.family_rating_count})
              </span>
            </div>
          </div>
        )}

        {/* Details section */}
        {(outfit.reasoning || outfit.style_notes || (outfit.highlights && outfit.highlights.length > 0)) && (
          <div className="mt-3 flex-1 space-y-2 text-[13px]">
            {outfit.reasoning && (
              <p className="font-semibold text-foreground">{outfit.reasoning}</p>
            )}
            {outfit.highlights && outfit.highlights.length > 0 && (
              <ul className="space-y-1">
                {outfit.highlights.map((highlight, index) => (
                  <li key={index} className="flex items-start gap-2 text-muted-foreground">
                    <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-signature" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            )}
            {outfit.style_notes && (
              <StinkyTip className="bg-panel">{outfit.style_notes}</StinkyTip>
            )}
          </div>
        )}

        {/* Action buttons - pushed to bottom */}
        <div className="mt-auto pt-3">
          {isPending && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleReject}
                disabled={rejectOutfit.isPending}
              >
                <ThumbsDown className="h-4 w-4" strokeWidth={1.75} />
                {t('reject')}
              </Button>
              <Button
                className="flex-1"
                onClick={handleAccept}
                disabled={acceptOutfit.isPending}
              >
                <ThumbsUp className="h-4 w-4" strokeWidth={1.75} />
                {t('accept')}
              </Button>
            </div>
          )}

          {outfit.status === 'accepted' && outfit.feedback?.actually_worn !== false && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={onFeedback}
            >
              <Star className="h-4 w-4" strokeWidth={1.75} />
              {outfit.feedback?.rating ? t('update') : t('rate')}
            </Button>
          )}
        </div>
      </CardContent>

      {/* Wore instead item preview modal */}
      <Dialog open={!!previewItem} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-md [&>button]:hidden">
          <DialogHeader className="p-5 pb-2">
            <DialogTitle>{previewItem?.name || previewItem?.type || t('item')}</DialogTitle>
          </DialogHeader>
          <div className="px-5">
            <Link
              href={`/dashboard/wardrobe?item=${previewItem?.id}`}
              className="block rounded-tile bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="relative aspect-square max-h-[350px] w-full">
                {previewItem?.thumbnail_url ? (
                  <Image
                    src={previewItem.thumbnail_url}
                    alt={previewItem.name || previewItem.type}
                    fill
                    className="object-contain p-4"
                    sizes="(max-width: 448px) 100vw, 448px"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Shirt className="h-16 w-16 text-muted-foreground" strokeWidth={1.75} />
                  </div>
                )}
              </div>
            </Link>
          </div>
          <div className="space-y-3 p-5 pt-3">
            <Badge variant="secondary" className="capitalize">
              {previewItem?.type}
            </Badge>
            <Button variant="secondary" className="w-full" asChild>
              <Link href={`/dashboard/wardrobe?item=${previewItem?.id}`}>
                <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
                {t('viewItemDetails')}
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
