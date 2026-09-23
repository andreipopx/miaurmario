'use client';

import { useTranslations } from 'next-intl';
import type { StyleCard } from '@/lib/style-quiz/cards';
import { STYLE_CARD_IDS } from '@/lib/style-quiz/cards';
import { cn } from '@/lib/utils';

/**
 * One style card: a text tile on a pop tint, with real colour swatches for the
 * palette cards. Nothing is fetched or embedded — no third-party imagery.
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
        'flex h-full w-full flex-col justify-center gap-2 overflow-hidden rounded-tile px-4 py-4 text-left',
        tintFor(card.id),
        className
      )}
    >
      <span className="eyebrow">{t(`categories.${card.category}`)}</span>
      <div className="min-w-0">
        <p className={cn('break-words font-extrabold leading-tight tracking-[-0.02em]', compact ? 'text-base' : 'text-xl')}>
          {t(`cards.${card.id}.title`)}
        </p>
        <p className={cn('mt-1 break-words leading-snug text-muted-foreground', compact ? 'text-[13px]' : 'text-sm')}>
          {t(`cards.${card.id}.body`)}
        </p>
      </div>
      {card.swatches && (
        <div className="flex gap-1.5" aria-hidden>
          {card.swatches.map((hex) => (
            <span
              key={hex}
              style={{ backgroundColor: hex }}
              className={cn('rounded-full ring-1 ring-black/10', compact ? 'h-4 w-4' : 'h-6 w-6')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
