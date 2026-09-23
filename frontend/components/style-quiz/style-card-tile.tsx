'use client';

import { useTranslations } from 'next-intl';
import type { StyleCard } from '@/lib/style-quiz/cards';
import { STYLE_CARD_IDS } from '@/lib/style-quiz/cards';
import { StyleCardArt } from '@/components/style-quiz/style-card-art';
import { cn } from '@/lib/utils';

/**
 * One style card: a little illustrated flat-lay on a pop tint, with the name,
 * what it means and two or three concrete examples underneath — and the real
 * colours for the palette cards.
 *
 * Nothing is fetched or embedded: the art is inline SVG drawn from the shared
 * silhouettes in `garment-shapes.tsx`, and it is decorative (`aria-hidden`),
 * because the text is what carries the meaning.
 */

/** Tints rotate through the pop palette so the deck never looks monotonous. */
const TINTS = [
  'bg-[color-mix(in_srgb,var(--pop-amber)_28%,var(--background))]',
  'bg-[color-mix(in_srgb,var(--pop-sky)_28%,var(--background))]',
  'bg-signature-soft',
  'bg-[color-mix(in_srgb,var(--pop-mint)_28%,var(--background))]',
];

export function tintFor(cardId: string): string {
  const i = STYLE_CARD_IDS.indexOf(cardId);
  return TINTS[((i % TINTS.length) + TINTS.length) % TINTS.length];
}

export interface StyleCardTileProps {
  card: StyleCard;
  /** Compact tiles are used in the Ajustes grid; the deck uses the big one. */
  compact?: boolean;
  className?: string;
}

export function StyleCardTile({ card, compact = false, className }: StyleCardTileProps) {
  const t = useTranslations('firstRun.styleQuiz');

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col gap-2 overflow-hidden rounded-tile px-3 py-3 text-left',
        tintFor(card.id),
        className
      )}
    >
      <span className="eyebrow shrink-0">{t(`categories.${card.category}`)}</span>

      {/* The illustration takes whatever room the text leaves, and shrinks
          instead of pushing the words out on a narrow screen or at 125%. */}
      <div className={cn('min-w-0 shrink-0', compact ? 'h-14' : 'min-h-[44px] flex-1 shrink')}>
        <StyleCardArt card={card} />
      </div>

      {card.swatches && (
        <div className="flex shrink-0 gap-1.5" aria-hidden>
          {card.swatches.map((hex) => (
            <span
              key={hex}
              style={{ backgroundColor: hex }}
              className={cn(
                'rounded-full ring-1 ring-[color-mix(in_srgb,var(--foreground)_22%,transparent)]',
                compact ? 'h-3 w-3' : 'h-3.5 w-3.5'
              )}
            />
          ))}
        </div>
      )}

      <div className="min-w-0 shrink-0">
        <p className={cn('break-words font-extrabold leading-tight tracking-[-0.02em]', compact ? 'text-base' : 'text-lg')}>
          {t(`cards.${card.id}.title`)}
        </p>
        <p className={cn('mt-0.5 break-words leading-snug text-muted-foreground', compact ? 'text-[13px]' : 'text-[13px]')}>
          {t(`cards.${card.id}.body`)}
        </p>
        {!compact && (
          <p className="mt-1 break-words text-[12px] font-semibold leading-snug text-foreground/75">
            {t(`cards.${card.id}.examples`)}
          </p>
        )}
      </div>
    </div>
  );
}
