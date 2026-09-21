'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type PopColor = 'amber' | 'pink' | 'sky' | 'mint';

/** Background class for a pop colour dot / tile. Always pair with ink text. */
export const POP_BG: Record<PopColor, string> = {
  amber: 'bg-pop-amber',
  pink: 'bg-pop-pink',
  sky: 'bg-pop-sky',
  mint: 'bg-pop-mint',
};

const POP_ORDER: PopColor[] = ['amber', 'sky', 'pink', 'mint'];
/** Stable pop colour for the n-th category/occasion. */
export const popColorAt = (i: number): PopColor => POP_ORDER[((i % 4) + 4) % 4];

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** Colour dot shown before the label when inactive. */
  dot?: PopColor;
  /**
   * How the active state looks: `ink` (black pill, white text — filters) or
   * `pop` (filled with the dot colour, ink text — occasions).
   */
  activeStyle?: 'ink' | 'pop';
}

/** Pill filter/occasion chip. Toggle state is exposed via aria-pressed. */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ active = false, dot, activeStyle = 'ink', className, children, ...props }, ref) => {
    const popActive = active && activeStyle === 'pop' && dot;
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={active}
        className={cn(
          'inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50',
          active
            ? popActive
              ? cn(POP_BG[dot], 'font-bold text-pop-foreground')
              : 'bg-primary font-semibold text-primary-foreground'
            : 'border-[1.5px] border-border bg-background font-medium text-foreground hover:bg-accent',
          className
        )}
        {...props}
      >
        {dot && !popActive && <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', POP_BG[dot])} />}
        {children}
      </button>
    );
  }
);
Chip.displayName = 'Chip';
