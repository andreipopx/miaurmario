'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { OCCASIONS } from '@/lib/types';
import { Chip, type PopColor } from '@/components/chip';

/** Fixed pop colour per occasion (dot when idle, fill when selected). */
export const OCCASION_COLOR: Record<string, PopColor> = {
  casual: 'amber',
  office: 'sky',
  date: 'pink',
  formal: 'mint',
  sporty: 'amber',
  outdoor: 'mint',
};

interface OccasionChipsProps {
  selected: string | null;
  onSelect: (occasion: string) => void;
  disabled?: boolean;
  /** Single scrollable row (mobile) instead of wrapping. */
  scroll?: boolean;
  className?: string;
}

export function OccasionChips({ selected, onSelect, disabled, scroll = false, className }: OccasionChipsProps) {
  const t = useTranslations('suggest.occasions');
  return (
    <div
      className={cn(
        'flex gap-2',
        scroll ? '-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0' : 'flex-wrap',
        className
      )}
    >
      {OCCASIONS.map((occasion) => (
        <Chip
          key={occasion.value}
          active={selected === occasion.value}
          dot={OCCASION_COLOR[occasion.value] ?? 'amber'}
          activeStyle="pop"
          disabled={disabled}
          onClick={() => onSelect(occasion.value)}
        >
          {t(occasion.value)}
        </Chip>
      ))}
    </div>
  );
}
