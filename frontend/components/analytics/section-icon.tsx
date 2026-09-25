'use client';

import { type LucideIcon } from 'lucide-react';

import { POP_BG, type PopColor } from '@/components/chip';
import { cn } from '@/lib/utils';

/** The round coloured badge that heads a section of the analytics page. */
export function SectionIcon({ icon: Icon, color }: { icon: LucideIcon; color: PopColor }) {
  return (
    <span
      aria-hidden
      className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-pop-foreground', POP_BG[color])}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </span>
  );
}
