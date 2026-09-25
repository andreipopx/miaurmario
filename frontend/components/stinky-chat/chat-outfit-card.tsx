'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { Bookmark, ChevronRight, Loader2, Shirt } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ChatOutfitCard } from '@/lib/stinky-chat';

interface ChatOutfitCardProps {
  card: ChatOutfitCard;
  onSave?: () => void;
  saving?: boolean;
}

/** Outfit card rendered inside a Stinky bubble: item thumbnails + "Guardar" / "Ver". */
export function ChatOutfitCardView({ card, onSave, saving }: ChatOutfitCardProps) {
  const t = useTranslations('stinkyChat');
  const tOccasions = useTranslations('suggest.occasions');
  const typeLabel = useClothingTypeLabel();
  const visible = card.items.slice(0, 4);
  const overflow = card.items.length - visible.length;
  const occasion =
    card.occasion && tOccasions.has(card.occasion as never)
      ? tOccasions(card.occasion as never)
      : card.occasion;
  const saved = card.kind === 'created' && !!card.outfit_id;

  return (
    <div className="mt-2 w-full max-w-[320px] rounded-[18px] bg-background p-2 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="grid grid-cols-4 gap-1.5">
        {visible.map((item, i) => (
          <div key={item.id} className="relative aspect-square overflow-hidden rounded-[12px] bg-panel">
            {item.thumbnail_url || item.image_url ? (
              <Image
                src={(item.thumbnail_url || item.image_url) as string}
                alt={item.name || (item.type ? typeLabel(item.type) : '')}
                fill
                sizes="80px"
                className="object-contain p-1 mix-blend-multiply dark:mix-blend-normal"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Shirt className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              </div>
            )}
            {overflow > 0 && i === visible.length - 1 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-bold text-white">
                {t('itemsMore', { count: overflow + 1 })}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 px-1 pb-0.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold leading-tight">{card.name || occasion || t('cardProposed')}</p>
          <p className="truncate text-xs text-muted-foreground">
            {saved ? t('cardCreated') : t('cardProposed')}
            {occasion && card.name ? ` · ${occasion}` : ''}
          </p>
        </div>
        {saved ? (
          <Button asChild size="sm" variant="secondary" className="h-9 shrink-0 px-3.5">
            <Link href={`/dashboard/outfits/${card.outfit_id}`}>
              {t('view')}
              <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="signature"
            className="h-9 shrink-0 px-3.5"
            onClick={onSave}
            disabled={!onSave || saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Bookmark className="h-4 w-4" strokeWidth={2} aria-hidden />
            )}
            {t('save')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function cardKey(card: ChatOutfitCard, index: number) {
  return card.outfit_id || `${index}-${card.items.map((i) => i.id).join('.')}`;
}
