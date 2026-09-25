'use client';

import { Trash2, Star, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StinkyTip } from '@/components/stinky-tip';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useDeletePairing } from '@/lib/hooks/use-pairings';
import { Pairing } from '@/lib/types';
import { cn } from '@/lib/utils';
import Image from 'next/image';
import { useTagLabel } from '@/lib/tag-labels';

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            'h-3.5 w-3.5',
            star <= rating ? 'fill-pop-amber text-pop-amber' : 'text-muted-foreground/30'
          )}
        />
      ))}
    </div>
  );
}

interface PairingCardProps {
  pairing: Pairing;
  onFeedback?: () => void;
  onPreview?: () => void;
}

export function PairingCard({ pairing, onFeedback, onPreview }: PairingCardProps) {
  const t = useTranslations('pairingCard');
  const tn = useTranslations('nav');
  const tagLabel = useTagLabel();
  const deletePairing = useDeletePairing();

  const handleDelete = async () => {
    try {
      await deletePairing.mutateAsync(pairing.id);
      toast.success(t('toast.deleted'));
    } catch {
      toast.error(t('toast.deleteFailed'));
    }
  };

  // Find the source item in the items list
  const sourceItemId = pairing.source_item?.id;
  const otherItems = pairing.items.filter((item) => item.id !== sourceItemId);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardContent className="flex flex-1 flex-col p-4 sm:p-4">
        {/* Header with source badge */}
        <div className="mb-3 flex items-center justify-between">
          <Badge variant="amber">
            <Sparkles className="h-3 w-3" />
            {tn('pairings')}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-1 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={deletePairing.isPending}
            aria-label={t('delete')}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </div>

        {/* Source item highlighted */}
        {pairing.source_item && (
          <div className="mb-3">
            <p className="eyebrow mb-1.5">{t('builtAround')}</p>
            <div className="flex items-center gap-3 rounded-[18px] bg-signature-soft p-2">
              <div className="relative h-12 w-12 overflow-hidden rounded-[14px] bg-background">
                {pairing.source_item.thumbnail_url ? (
                  <Image
                    src={pairing.source_item.thumbnail_url}
                    alt={pairing.source_item.name || tagLabel('types', pairing.source_item.type)}
                    fill
                    className="object-contain p-1"
                    sizes="48px"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    {tagLabel('types', pairing.source_item.type)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {pairing.source_item.name || tagLabel('types', pairing.source_item.type)}
                </p>
                {pairing.source_item.primary_color && (
                  <p className="text-xs text-muted-foreground">
                    {tagLabel('colors', pairing.source_item.primary_color)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Other items in outfit */}
        <button
          type="button"
          onClick={onPreview}
          aria-label={t('preview')}
          className="group flex w-full flex-wrap gap-2 rounded-[18px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {otherItems.map((item) => (
            <div
              key={item.id}
              className="relative h-16 w-16 overflow-hidden rounded-[14px] bg-panel transition-transform duration-150 group-hover:scale-[1.03]"
            >
              {item.thumbnail_url ? (
                <Image
                  src={item.thumbnail_url}
                  alt={item.name || tagLabel('types', item.type)}
                  fill
                  className="object-contain p-1.5"
                  sizes="64px"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  {tagLabel('types', item.type)}
                </div>
              )}
            </div>
          ))}
        </button>

        {/* Feedback display */}
        {pairing.feedback && (pairing.feedback.rating || pairing.feedback.comment) && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              {pairing.feedback.rating && (
                <StarRating rating={pairing.feedback.rating} />
              )}
              {pairing.feedback.comment && (
                <p className="flex-1 truncate text-xs text-muted-foreground">
                  &ldquo;{pairing.feedback.comment}&rdquo;
                </p>
              )}
            </div>
          </div>
        )}

        {/* AI reasoning */}
        {(pairing.reasoning || pairing.highlights) && (
          <div className="mt-3 flex-1 space-y-1.5 text-[13px]">
            {pairing.reasoning && (
              <p className="break-words font-semibold text-foreground">{pairing.reasoning}</p>
            )}
            {pairing.highlights && pairing.highlights.length > 0 && (
              <ul className="space-y-1">
                {pairing.highlights.slice(0, 3).map((highlight, index) => (
                  <li key={index} className="flex items-start gap-2 text-muted-foreground">
                    <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-signature" />
                    <span className="line-clamp-2">{highlight}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Styling tip */}
        {pairing.style_notes && (
          <StinkyTip className="mt-3 bg-panel">
            <span className="break-words">{pairing.style_notes}</span>
          </StinkyTip>
        )}

        {/* Feedback button */}
        {pairing.status === 'accepted' && onFeedback && (
          <div className="mt-auto pt-3">
            <Button
              variant="secondary"
              className="w-full"
              onClick={onFeedback}
            >
              <Star className="h-4 w-4" strokeWidth={1.75} />
              {pairing.feedback?.rating ? t('updateRating') : t('ratePairing')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
