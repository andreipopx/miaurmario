'use client';

import { cn } from '@/lib/utils';
import { LazyStinky } from '@/components/native/lazy-stinky';
import type { StinkyStateInput } from '@/components/stinky/stinky-states';

/**
 * Empty / error state: a short title, at most one line under it, and the action.
 *
 * Quiet by default — an empty list is not an event, and Stinky only appears where
 * he is saying something. `mascot` brings him back, small and without the pink
 * circle, for the few places where he is the point (his own pages).
 */
export function EmptyState({
  title,
  description,
  action,
  state = 'sleepy',
  mascot = false,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  state?: StinkyStateInput;
  mascot?: boolean;
  /** @deprecated kept for callers; the quiet state has one size. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-8 text-center', className)}>
      {mascot && <LazyStinky state={state} size={72} label="" />}
      <h2 className={cn('text-[17px] font-bold tracking-tight', mascot && 'mt-3')}>{title}</h2>
      {description && (
        <p className="mt-1 max-w-xs text-[14px] leading-snug text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
